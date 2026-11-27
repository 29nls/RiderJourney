import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { DATABASE, type Database } from '../db/database.js';

/**
 * Content moderation is a separate axis from malware scanning.
 *
 *   scan_status        -> is the file dangerous?
 *   moderation_status  -> does the content break community rules?
 *
 * A file can be malware-free and still be rejected, and a rejected item is not
 * "infected". Keeping the columns apart is what makes an appeal or a re-review
 * meaningful: clearing quarantine must not silently approve content.
 */

export const MODERATION_STATUSES = ['not_required', 'pending_review', 'approved', 'rejected', 'hidden'] as const;
export type ModerationStatus = (typeof MODERATION_STATUSES)[number];

/**
 * Purposes that can reach other people. Profile pictures and vehicle photos are
 * personal assets, not community content, so they are not queued.
 */
const MODERATED_PURPOSES = new Set([
  'post_photo', 'post_video', 'album_photo', 'album_video', 'poster', 'hazard_photo',
  'community_logo', 'community_cover',
]);

export type ModerationRow = {
  id: string;
  owner_id: string;
  purpose: string;
  mime_type: string;
  size_bytes: number;
  status: string;
  scan_status: string;
  moderation_status: string;
  moderation_reason: string | null;
  moderation_requested_at: Date | null;
  moderation_reviewed_at: Date | null;
  moderation_reviewer_id: string | null;
  created_at: Date;
};

export type ModerationAction = 'approve' | 'reject' | 'hide';

@Injectable()
export class ModerationService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Purposes that need a human decision before other people may see them. */
  requiresModeration(purpose: string): boolean {
    return MODERATED_PURPOSES.has(purpose);
  }

  /**
   * Called when media becomes ready. Personal purposes are marked
   * 'not_required' so the public policy can treat them as always eligible;
   * community content enters the review queue.
   */
  async enqueueIfRequired(tx: Database, mediaId: string, purpose: string, ownerId: string): Promise<void> {
    const status: ModerationStatus = this.requiresModeration(purpose) ? 'pending_review' : 'not_required';
    if (status === 'not_required') {
      await tx.query(`UPDATE media_assets SET moderation_status = 'not_required' WHERE id = $1`, [mediaId]);
      return;
    }
    const updated = await tx.query<{ id: string }>(
      `UPDATE media_assets
       SET moderation_status = 'pending_review', moderation_requested_at = now()
       WHERE id = $1 AND moderation_status IN ('not_required', 'pending_review')
       RETURNING id`,
      [mediaId],
    );
    if (!updated[0]) return;
    await tx.query(
      `INSERT INTO media_moderation_log (id, media_id, actor_id, action, from_status, to_status, reason)
       VALUES ($1, $2, NULL, 'request', 'not_required', 'pending_review', NULL)`,
      [uuidv7(), mediaId],
    );
    void ownerId;
  }

  /** Paginated review queue. Filters keep the query shaped like the admin list. */
  async queue(params: { status?: string; purpose?: string; limit?: number; before?: string } = {}) {
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
    const values: unknown[] = [];
    const where: string[] = [];
    if (params.status) {
      values.push(params.status);
      where.push(`m.moderation_status = $${values.length}`);
    } else {
      where.push(`m.moderation_status = 'pending_review'`);
    }
    if (params.purpose) {
      values.push(params.purpose);
      where.push(`m.purpose = $${values.length}`);
    }
    if (params.before) {
      values.push(params.before);
      where.push(`m.id < $${values.length}`);
    }
    values.push(limit + 1);
    const rows = await this.db.query<ModerationRow>(
      `SELECT m.id, m.owner_id, m.purpose, m.mime_type, m.size_bytes, m.status, m.scan_status,
              m.moderation_status, m.moderation_reason, m.moderation_requested_at,
              m.moderation_reviewed_at, m.moderation_reviewer_id, m.created_at
       FROM media_assets m
       WHERE ${where.join(' AND ')}
       ORDER BY m.id DESC
       LIMIT $${values.length}`,
      values,
    );
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((row) => this.toItem(row));
    return { items, nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null };
  }

  private toItem(row: ModerationRow) {
    return {
      id: row.id,
      ownerId: row.owner_id,
      purpose: row.purpose,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      status: row.status,
      scanStatus: row.scan_status,
      moderationStatus: row.moderation_status,
      moderationReason: row.moderation_reason,
      requestedAt: row.moderation_requested_at ? new Date(row.moderation_requested_at).toISOString() : null,
      reviewedAt: row.moderation_reviewed_at ? new Date(row.moderation_reviewed_at).toISOString() : null,
      reviewerId: row.moderation_reviewer_id,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  /** Audit trail for one media, newest first. */
  async history(mediaId: string) {
    const rows = await this.db.query<{
      id: string;
      actor_id: string | null;
      action: string;
      from_status: string | null;
      to_status: string;
      reason: string | null;
      created_at: Date;
    }>(
      `SELECT id, actor_id, action, from_status, to_status, reason, created_at
       FROM media_moderation_log WHERE media_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [mediaId],
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        actorId: row.actor_id,
        action: row.action,
        fromStatus: row.from_status,
        toStatus: row.to_status,
        reason: row.reason,
        createdAt: new Date(row.created_at).toISOString(),
      })),
    };
  }

  /**
   * A decision is only valid from a reviewable state. Re-deciding an already
   * rejected item is a 'reopen' + new decision, not a silent overwrite, so the
   * log stays an honest history.
   */
  async decide(actorId: string, mediaId: string, action: ModerationAction, reason?: string) {
    const next: ModerationStatus = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'hidden';
    if ((action === 'reject' || action === 'hide') && !reason?.trim()) {
      throw new BadRequestException({
        code: 'MODERATION_REASON_REQUIRED',
        title: 'Alasan wajib diisi',
        detail: 'Menolak atau menyembunyikan konten harus disertai alasan.',
      });
    }
    return this.db.transaction(async (tx) => {
      const current = await tx.query<{ moderation_status: string; status: string }>(
        `SELECT moderation_status, status FROM media_assets WHERE id = $1 FOR UPDATE`,
        [mediaId],
      );
      const row = current[0];
      if (!row) {
        throw new NotFoundException({ code: 'MEDIA_NOT_FOUND', title: 'Media tidak ditemukan', detail: 'Media tidak ada.' });
      }
      if (row.moderation_status === next) {
        return { id: mediaId, moderationStatus: next, duplicate: true };
      }
      if (!['pending_review', 'approved', 'rejected', 'hidden'].includes(row.moderation_status)) {
        throw new ConflictException({
          code: 'MODERATION_NOT_REVIEWABLE',
          title: 'Media tidak dalam antrean',
          detail: `Status moderasi: ${row.moderation_status}.`,
        });
      }
      await tx.query(
        `UPDATE media_assets
         SET moderation_status = $2, moderation_reason = $3,
             moderation_reviewed_at = now(), moderation_reviewer_id = $4
         WHERE id = $1`,
        [mediaId, next, reason?.trim() ?? null, actorId],
      );
      await tx.query(
        `INSERT INTO media_moderation_log (id, media_id, actor_id, action, from_status, to_status, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [uuidv7(), mediaId, actorId, action, row.moderation_status, next, reason?.trim() ?? null],
      );
      return { id: mediaId, moderationStatus: next, duplicate: false };
    });
  }

  /** Returns a media to the queue after an appeal or a policy change. */
  async reopen(actorId: string, mediaId: string, reason: string) {
    return this.db.transaction(async (tx) => {
      const current = await tx.query<{ moderation_status: string }>(
        `SELECT moderation_status FROM media_assets WHERE id = $1 FOR UPDATE`,
        [mediaId],
      );
      if (!current[0]) {
        throw new NotFoundException({ code: 'MEDIA_NOT_FOUND', title: 'Media tidak ditemukan', detail: 'Media tidak ada.' });
      }
      await tx.query(
        `UPDATE media_assets SET moderation_status = 'pending_review', moderation_requested_at = now(),
           moderation_reviewed_at = NULL, moderation_reviewer_id = NULL, moderation_reason = NULL
         WHERE id = $1`,
        [mediaId],
      );
      await tx.query(
        `INSERT INTO media_moderation_log (id, media_id, actor_id, action, from_status, to_status, reason)
         VALUES ($1, $2, $3, 'reopen', $4, 'pending_review', $5)`,
        [uuidv7(), mediaId, actorId, current[0].moderation_status, reason],
      );
      return { id: mediaId, moderationStatus: 'pending_review' };
    });
  }

  /** Counts for the admin overview; no user data, no keys. */
  async summary() {
    const rows = await this.db.query<{ moderation_status: string; count: number }>(
      `SELECT moderation_status, count(*)::int AS count FROM media_assets GROUP BY moderation_status`,
    );
    const by = (status: string) => rows.find((r) => r.moderation_status === status)?.count ?? 0;
    return {
      pendingReview: by('pending_review'),
      approved: by('approved'),
      rejected: by('rejected'),
      hidden: by('hidden'),
      notRequired: by('not_required'),
    };
  }
}
