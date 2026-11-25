import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Database } from '../db/database.js';

export type ConvoyMemberRow = {
  role: 'leader' | 'co_leader' | 'member';
  status: string;
  convoy_status: string;
  display_name: string;
};

// Statuses where a convoy still holds live conversation, voice, and positions.
export const LIVE_CONVOY_STATUSES = ['lobby', 'active', 'paused'];

/**
 * The membership check shared by chat, voice, and hazards.
 * Outsiders get 404 so they cannot probe whether a convoy exists; insiders whose
 * membership lapsed (left, removed, or convoy finished) get 403 on the spot.
 */
export async function requireLiveConvoyMember(
  db: Database,
  convoyId: string,
  userId: string,
  deniedTitle: string,
): Promise<ConvoyMemberRow> {
  const rows = await db.query<ConvoyMemberRow>(
    `SELECT m.role, m.status, c.status AS convoy_status, u.display_name
     FROM convoys c
     JOIN convoy_members m ON m.convoy_id = c.id
     JOIN users u ON u.id = m.user_id
     WHERE c.id = $1 AND m.user_id = $2`,
    [convoyId, userId],
  );
  const member = rows[0];
  if (!member) {
    throw new NotFoundException({
      code: 'CONVOY_NOT_FOUND',
      title: 'Konvoi tidak ditemukan',
      detail: 'Keanggotaan aktif tidak ditemukan.',
    });
  }
  if (member.status !== 'active') {
    throw new ForbiddenException({
      code: 'CONVOY_ACCESS_DENIED',
      title: deniedTitle,
      detail: 'Anda bukan anggota aktif konvoi ini.',
    });
  }
  if (!LIVE_CONVOY_STATUSES.includes(member.convoy_status)) {
    throw new ForbiddenException({
      code: 'CONVOY_NOT_LIVE',
      title: deniedTitle,
      detail: 'Fitur ini hanya tersedia selama konvoi di lobby, aktif, atau jeda.',
    });
  }
  return member;
}
