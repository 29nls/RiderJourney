import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { DATABASE, type Database } from '../db/database.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { ReportContentDto, UpdateProfileDto } from './social.dto.js';

type UserRow = {
  id: string;
  username: string;
  display_name: string;
  bio: string | null;
  city: string | null;
  avatar_url: string | null;
  visibility: string;
  created_at: Date;
};

type RiderProfileRow = {
  headline: string | null;
  home_region: string | null;
  bio: string | null;
  avatar_media_id: string | null;
  cover_media_id: string | null;
  feed_visibility: string;
  leaderboard_opt_in: boolean;
  updated_at: Date | null;
};

@Injectable()
export class SocialService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly notifications: NotificationsService,
  ) {}

  private async user(id: string): Promise<UserRow> {
    const rows = await this.db.query<UserRow>(
      `SELECT id, username, display_name, bio, city, avatar_url, visibility, created_at
       FROM users WHERE id = $1 AND status = 'active'`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException({ code: 'USER_NOT_FOUND', title: 'Pengguna tidak ditemukan', detail: 'Akun tidak tersedia.' });
    return rows[0];
  }

  private async profileRow(userId: string): Promise<RiderProfileRow | undefined> {
    const rows = await this.db.query<RiderProfileRow>(
      `SELECT headline, home_region, bio, avatar_media_id, cover_media_id, feed_visibility, leaderboard_opt_in, updated_at
       FROM rider_profiles WHERE user_id = $1`,
      [userId],
    );
    return rows[0];
  }

  private async blocked(a: string, b: string): Promise<boolean> {
    const rows = await this.db.query<{ blocker_id: string }>(
      `SELECT blocker_id FROM user_blocks
       WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1) LIMIT 1`,
      [a, b],
    );
    return rows.length > 0;
  }

  async me(userId: string) {
    const user = await this.user(userId);
    const profile = await this.profileRow(userId);
    const counts = await this.db.query<{ followers: number; following: number; posts: number }>(
      `SELECT
         (SELECT count(*) FROM follows WHERE followee_id = $1)::int AS followers,
         (SELECT count(*) FROM follows WHERE follower_id = $1)::int AS following,
         (SELECT count(*) FROM posts WHERE author_id = $1 AND status = 'published' AND deleted_at IS NULL)::int AS posts`,
      [userId],
    );
    return {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      city: user.city,
      headline: profile?.headline ?? null,
      homeRegion: profile?.home_region ?? null,
      bio: profile?.bio ?? user.bio,
      avatarMediaId: profile?.avatar_media_id ?? null,
      coverMediaId: profile?.cover_media_id ?? null,
      feedVisibility: profile?.feed_visibility ?? 'followers',
      leaderboardOptIn: profile?.leaderboard_opt_in ?? false,
      counts: counts[0] ?? { followers: 0, following: 0, posts: 0 },
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    await this.user(userId);
    const requestedVisibility = dto.feedVisibility ?? dto.visibility;
    await this.db.query(
      `INSERT INTO rider_profiles (user_id, headline, home_region, bio, feed_visibility, leaderboard_opt_in, updated_at)
       VALUES ($1, $2, $3, $4, COALESCE($5, 'followers'), COALESCE($6, false), now())
       ON CONFLICT (user_id) DO UPDATE SET
         headline = COALESCE($2, rider_profiles.headline),
         home_region = COALESCE($3, rider_profiles.home_region),
         bio = COALESCE($4, rider_profiles.bio),
         feed_visibility = COALESCE($5, rider_profiles.feed_visibility),
         leaderboard_opt_in = COALESCE($6, rider_profiles.leaderboard_opt_in),
         updated_at = now()`,
      [userId, dto.headline ?? null, dto.homeRegion ?? null, dto.bio ?? null, requestedVisibility ?? null, dto.leaderboardOptIn ?? null],
    );
    // The legacy users.bio stays in step so older clients keep seeing the same text.
    if (dto.bio !== undefined) await this.db.query(`UPDATE users SET bio = $2, updated_at = now() WHERE id = $1`, [userId, dto.bio]);
    return this.me(userId);
  }

  async publicProfile(viewerId: string, targetId: string) {
    if (await this.blocked(viewerId, targetId)) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', title: 'Pengguna tidak ditemukan', detail: 'Akun tidak tersedia.' });
    }
    const user = await this.user(targetId);
    const profile = await this.profileRow(targetId);
    const relation = await this.db.query<{ following: boolean; requested: boolean; muted: boolean }>(
      `SELECT
         EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2) AS following,
         EXISTS (SELECT 1 FROM follow_requests WHERE requester_id = $1 AND target_id = $2 AND status = 'pending') AS requested,
         EXISTS (SELECT 1 FROM user_mutes WHERE muter_id = $1 AND muted_id = $2) AS muted`,
      [viewerId, targetId],
    );
    const counts = await this.db.query<{ followers: number; following: number; posts: number }>(
      `SELECT
         (SELECT count(*) FROM follows WHERE followee_id = $1)::int AS followers,
         (SELECT count(*) FROM follows WHERE follower_id = $1)::int AS following,
         (SELECT count(*) FROM posts WHERE author_id = $1 AND status = 'published' AND deleted_at IS NULL
            AND audience IN ('public', 'followers'))::int AS posts`,
      [targetId],
    );
    const feedVisibility = profile?.feed_visibility ?? 'followers';
    return {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      city: user.city,
      headline: profile?.headline ?? null,
      homeRegion: profile?.home_region ?? null,
      bio: profile?.bio ?? user.bio,
      avatarMediaId: profile?.avatar_media_id ?? null,
      feedVisibility,
      counts: counts[0] ?? { followers: 0, following: 0, posts: 0 },
      relation: {
        following: relation[0]?.following ?? false,
        requested: relation[0]?.requested ?? false,
        muted: relation[0]?.muted ?? false,
        isSelf: viewerId === targetId,
      },
    };
  }

  async follow(viewerId: string, targetId: string) {
    if (viewerId === targetId) {
      throw new UnprocessableEntityException({ code: 'CANNOT_FOLLOW_SELF', title: 'Tidak dapat mengikuti diri sendiri', detail: 'Pilih akun lain.' });
    }
    const target = await this.user(targetId);
    if (await this.blocked(viewerId, targetId)) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', title: 'Pengguna tidak ditemukan', detail: 'Akun tidak tersedia.' });
    }
    const profile = await this.profileRow(targetId);
    const feedVisibility = profile?.feed_visibility ?? 'followers';
    const actor = await this.user(viewerId);

    const existing = await this.db.query<{ following: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2) AS following`,
      [viewerId, targetId],
    );
    if (existing[0]?.following) return { following: true, requested: false, duplicate: true };

    if (feedVisibility === 'private') {
      const request = await this.db.query<{ status: string }>(
        `INSERT INTO follow_requests (requester_id, target_id) VALUES ($1, $2)
         ON CONFLICT (requester_id, target_id) DO UPDATE
           SET status = CASE WHEN follow_requests.status = 'accepted' THEN 'accepted' ELSE 'pending' END,
               responded_at = NULL
         RETURNING status`,
        [viewerId, targetId],
      );
      if (request[0]?.status === 'accepted') {
        await this.db.query(`INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [viewerId, targetId]);
        return { following: true, requested: false, duplicate: false };
      }
      await this.notifications.create({
        userId: targetId,
        kind: 'follow_request',
        threadKey: `follow_request:${viewerId}`,
        sourceUserId: viewerId,
        payload: { message: `${actor.username} meminta mengikuti akunmu`, username: actor.username },
      });
      return { following: false, requested: true, duplicate: false };
    }

    await this.db.query(`INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [viewerId, targetId]);
    await this.notifications.create({
      userId: targetId,
      kind: 'follow',
      threadKey: `follow:${viewerId}`,
      sourceUserId: viewerId,
      payload: { message: `${actor.username} mulai mengikuti akunmu`, username: actor.username },
    });
    return { following: true, requested: false, duplicate: false };
  }

  async unfollow(viewerId: string, targetId: string) {
    await this.user(targetId);
    await this.db.query(`DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2`, [viewerId, targetId]);
    await this.db.query(
      `UPDATE follow_requests SET status = 'cancelled', responded_at = now()
       WHERE requester_id = $1 AND target_id = $2 AND status = 'pending'`,
      [viewerId, targetId],
    );
    return { following: false, requested: false };
  }

  async followRequests(userId: string) {
    const rows = await this.db.query<{ requester_id: string; username: string; display_name: string; created_at: Date }>(
      `SELECT r.requester_id, u.username, u.display_name, r.created_at
       FROM follow_requests r JOIN users u ON u.id = r.requester_id
       WHERE r.target_id = $1 AND r.status = 'pending'
       ORDER BY r.created_at DESC`,
      [userId],
    );
    return {
      items: rows.map((row) => ({
        requesterId: row.requester_id,
        username: row.username,
        displayName: row.display_name,
        createdAt: new Date(row.created_at).toISOString(),
      })),
    };
  }

  async respondToRequest(userId: string, requesterId: string, accept: boolean) {
    const rows = await this.db.query<{ requester_id: string }>(
      `UPDATE follow_requests SET status = $3, responded_at = now()
       WHERE requester_id = $1 AND target_id = $2 AND status = 'pending'
       RETURNING requester_id`,
      [requesterId, userId, accept ? 'accepted' : 'declined'],
    );
    if (!rows[0]) {
      throw new NotFoundException({ code: 'REQUEST_NOT_FOUND', title: 'Permintaan tidak ditemukan', detail: 'Permintaan mengikuti sudah tidak aktif.' });
    }
    if (accept) {
      await this.db.query(`INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [requesterId, userId]);
      const actor = await this.user(userId);
      await this.notifications.create({
        userId: requesterId,
        kind: 'follow_accepted',
        threadKey: `follow_accepted:${userId}`,
        sourceUserId: userId,
        payload: { message: `${actor.username} menerima permintaanmu`, username: actor.username },
      });
    }
    return { requesterId, accepted: accept };
  }

  async block(userId: string, targetId: string) {
    if (userId === targetId) {
      throw new UnprocessableEntityException({ code: 'CANNOT_BLOCK_SELF', title: 'Tidak dapat memblokir diri sendiri', detail: 'Pilih akun lain.' });
    }
    await this.user(targetId);
    await this.db.transaction(async (tx) => {
      await tx.query(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [userId, targetId]);
      await tx.query(
        `DELETE FROM follows WHERE (follower_id = $1 AND followee_id = $2) OR (follower_id = $2 AND followee_id = $1)`,
        [userId, targetId],
      );
      await tx.query(
        `DELETE FROM follow_requests WHERE (requester_id = $1 AND target_id = $2) OR (requester_id = $2 AND target_id = $1)`,
        [userId, targetId],
      );
      await tx.query(
        `DELETE FROM user_mutes WHERE (muter_id = $1 AND muted_id = $2) OR (muter_id = $2 AND muted_id = $1)`,
        [userId, targetId],
      );
    });
    return { blocked: true };
  }

  async unblock(userId: string, targetId: string) {
    await this.db.query(`DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2`, [userId, targetId]);
    return { blocked: false };
  }

  async blockList(userId: string) {
    const rows = await this.db.query<{ id: string; username: string; display_name: string; created_at: Date }>(
      `SELECT b.blocked_id AS id, u.username, u.display_name, b.created_at
       FROM user_blocks b JOIN users u ON u.id = b.blocked_id
       WHERE b.blocker_id = $1 ORDER BY b.created_at DESC`,
      [userId],
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        blockedAt: new Date(row.created_at).toISOString(),
      })),
    };
  }

  async mute(userId: string, targetId: string) {
    if (userId === targetId) {
      throw new UnprocessableEntityException({ code: 'CANNOT_MUTE_SELF', title: 'Tidak dapat membisukan diri sendiri', detail: 'Pilih akun lain.' });
    }
    await this.user(targetId);
    await this.db.query(`INSERT INTO user_mutes (muter_id, muted_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [userId, targetId]);
    return { muted: true };
  }

  async unmute(userId: string, targetId: string) {
    await this.db.query(`DELETE FROM user_mutes WHERE muter_id = $1 AND muted_id = $2`, [userId, targetId]);
    return { muted: false };
  }

  async report(userId: string, dto: ReportContentDto) {
    const table = {
      post: 'posts', comment: 'comments', user: 'users', album: 'albums', media: 'media_assets',
      message: 'convoy_messages', hazard: 'hazard_reports', community_event: 'community_events',
    }[dto.targetType];
    const exists = await this.db.query<{ id: string }>(`SELECT id FROM ${table} WHERE id = $1`, [dto.targetId]);
    if (!exists[0]) {
      throw new NotFoundException({ code: 'REPORT_TARGET_NOT_FOUND', title: 'Konten tidak ditemukan', detail: 'Konten yang dilaporkan tidak tersedia.' });
    }
    const existing = await this.db.query<{ id: string }>(
      `SELECT id FROM content_reports WHERE reporter_id = $1 AND client_report_id = $2`,
      [userId, dto.clientReportId],
    );
    if (existing[0]) return { id: existing[0].id, duplicate: true, status: 'pending' };
    const rows = await this.db.query<{ id: string }>(
      `INSERT INTO content_reports (id, reporter_id, target_type, target_id, reason, note, detail, client_report_id)
       VALUES ($1, $2, $3, $4, $5, $6, $6, $7)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [uuidv7(), userId, dto.targetType, dto.targetId, dto.reason, dto.detail ?? null, dto.clientReportId],
    );
    return { id: rows[0]?.id ?? null, duplicate: rows.length === 0, status: 'pending' };
  }

  /**
   * Removes a user's social content without deleting the account. Object keys
   * are returned so the storage lifecycle job can delete the bytes; the database
   * only ever held metadata.
   */
  async purgeSocialData(userId: string) {
    const result = await this.db.transaction(async (tx) => {
      const media = await tx.query<{ object_key: string }>(`SELECT object_key FROM media_assets WHERE owner_id = $1`, [userId]);
      // Trip photos restrict media deletion, so detach them before the objects.
      await tx.query(
        `DELETE FROM trip_photos WHERE owner_id = $1 OR trip_id IN (SELECT id FROM trips WHERE user_id = $1)`,
        [userId],
      );
      // Authored interactions on other people's content are part of the same
      // deletion request; leaving them behind would keep the profile traceable.
      await tx.query(`DELETE FROM comment_reactions WHERE user_id = $1`, [userId]);
      await tx.query(`DELETE FROM reactions WHERE user_id = $1`, [userId]);
      await tx.query(`DELETE FROM post_saves WHERE user_id = $1`, [userId]);
      await tx.query(`DELETE FROM comments WHERE author_id = $1`, [userId]);
      await tx.query(`DELETE FROM mentions WHERE mentioned_id = $1`, [userId]);
      await tx.query(`DELETE FROM trip_comments WHERE author_id = $1`, [userId]);
      await tx.query(`DELETE FROM trip_reactions WHERE user_id = $1`, [userId]);
      await tx.query(`DELETE FROM posters WHERE owner_id = $1`, [userId]);
      await tx.query(`DELETE FROM feed_read_cursors WHERE user_id = $1`, [userId]);
      await tx.query(`DELETE FROM follows WHERE follower_id = $1 OR followee_id = $1`, [userId]);
      await tx.query(`DELETE FROM follow_requests WHERE requester_id = $1 OR target_id = $1`, [userId]);
      await tx.query(`DELETE FROM user_mutes WHERE muter_id = $1 OR muted_id = $1`, [userId]);
      await tx.query(`DELETE FROM user_blocks WHERE blocker_id = $1 OR blocked_id = $1`, [userId]);
      const posts = await tx.query<{ id: string }>(`DELETE FROM posts WHERE author_id = $1 RETURNING id`, [userId]);
      const albums = await tx.query<{ id: string }>(`DELETE FROM albums WHERE owner_id = $1 RETURNING id`, [userId]);
      const assets = await tx.query<{ id: string }>(`DELETE FROM media_assets WHERE owner_id = $1 RETURNING id`, [userId]);
      const notifications = await tx.query<{ id: string }>(`DELETE FROM notifications WHERE user_id = $1 RETURNING id`, [userId]);
      await tx.query(`DELETE FROM push_devices WHERE user_id = $1`, [userId]);
      await tx.query(`DELETE FROM point_ledger WHERE user_id = $1`, [userId]);
      await tx.query(`DELETE FROM user_badges WHERE user_id = $1`, [userId]);
      await tx.query(`DELETE FROM rider_profiles WHERE user_id = $1`, [userId]);
      await tx.query(`DELETE FROM content_reports WHERE reporter_id = $1`, [userId]);
      await tx.query(`DELETE FROM notifications WHERE source_user_id = $1`, [userId]);
      return {
        posts: posts.length,
        albums: albums.length,
        media: assets.length,
        notifications: notifications.length,
        objectKeys: media.map((row) => row.object_key),
      };
    });
    if (result.posts === 0 && result.albums === 0 && result.media === 0 && result.notifications === 0) {
      throw new ConflictException({ code: 'NOTHING_TO_DELETE', title: 'Tidak ada data sosial', detail: 'Tidak ada konten sosial yang perlu dihapus.' });
    }
    return { deleted: true, ...result };
  }
}
