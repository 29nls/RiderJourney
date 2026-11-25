import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { DATABASE, type Database } from '../db/database.js';
import { toPublicUser, type UserRow } from '../auth/auth.types.js';
import type { ConsentDto, UpdateProfileDto, UpdateSettingsDto } from './users.dto.js';

type SettingsRow = {
  location_sharing_default: boolean;
  trip_history_visibility: string;
  notification_preferences: Record<string, unknown>;
  audio_preferences: Record<string, unknown>;
  map_preferences: Record<string, unknown>;
};

function settingsDto(row: SettingsRow) {
  return {
    locationSharingDefault: row.location_sharing_default,
    tripHistoryVisibility: row.trip_history_visibility,
    notificationPreferences: row.notification_preferences,
    audioPreferences: row.audio_preferences,
    mapPreferences: row.map_preferences,
  };
}

@Injectable()
export class UsersService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async me(userId: string) {
    const rows = await this.db.query<UserRow>('SELECT * FROM users WHERE id = $1', [userId]);
    const user = rows[0];
    if (!user) throw new NotFoundException({ code: 'NOT_FOUND', title: 'Profil tidak ditemukan', detail: 'Pengguna tidak ditemukan.' });
    const settings = await this.settings(userId);
    const active = await this.db.query<{ id: string }>(
      `SELECT id FROM trips WHERE user_id = $1 AND status IN ('active', 'paused') LIMIT 1`,
      [userId],
    );
    return { ...toPublicUser(user), settings, activeTripId: active[0]?.id ?? null };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const sets: string[] = [];
    const values: unknown[] = [];
    const map: Array<[keyof UpdateProfileDto, string]> = [
      ['displayName', 'display_name'],
      ['bio', 'bio'],
      ['city', 'city'],
      ['avatarUrl', 'avatar_url'],
      ['visibility', 'visibility'],
    ];
    for (const [key, column] of map) {
      if (dto[key] !== undefined) {
        values.push(key === 'avatarUrl' && dto[key] === '' ? null : dto[key]);
        sets.push(`${column} = $${values.length}`);
      }
    }
    if (sets.length > 0) {
      values.push(userId);
      await this.db.query(`UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length}`, values);
    }
    return this.me(userId);
  }

  async settings(userId: string) {
    const rows = await this.db.query<SettingsRow>('SELECT * FROM user_settings WHERE user_id = $1', [userId]);
    if (!rows[0]) throw new NotFoundException({ code: 'NOT_FOUND', title: 'Pengaturan tidak ditemukan', detail: 'Pengaturan pengguna tidak ditemukan.' });
    return settingsDto(rows[0]);
  }

  async updateSettings(userId: string, dto: UpdateSettingsDto) {
    await this.db.query(
      `INSERT INTO user_settings (
         user_id, location_sharing_default, trip_history_visibility,
         notification_preferences, audio_preferences, map_preferences, updated_at
       ) VALUES ($1, COALESCE($2, false), COALESCE($3, 'private'),
         COALESCE($4::jsonb, '{}'::jsonb), COALESCE($5::jsonb, '{}'::jsonb), COALESCE($6::jsonb, '{}'::jsonb), now())
       ON CONFLICT (user_id) DO UPDATE SET
         location_sharing_default = COALESCE($2, user_settings.location_sharing_default),
         trip_history_visibility = COALESCE($3, user_settings.trip_history_visibility),
         notification_preferences = COALESCE($4::jsonb, user_settings.notification_preferences),
         audio_preferences = COALESCE($5::jsonb, user_settings.audio_preferences),
         map_preferences = COALESCE($6::jsonb, user_settings.map_preferences),
         updated_at = now()`,
      [
        userId,
        dto.locationSharingDefault ?? null,
        dto.tripHistoryVisibility ?? null,
        dto.notificationPreferences ? JSON.stringify(dto.notificationPreferences) : null,
        dto.audioPreferences ? JSON.stringify(dto.audioPreferences) : null,
        dto.mapPreferences ? JSON.stringify(dto.mapPreferences) : null,
      ],
    );
    return this.settings(userId);
  }

  async addConsent(userId: string, dto: ConsentDto) {
    const row = { id: uuidv7(), ...dto };
    await this.db.query(
      `INSERT INTO user_consents (id, user_id, kind, version, context) VALUES ($1, $2, $3, $4, $5)`,
      [row.id, userId, dto.kind, dto.version, dto.context ?? null],
    );
    return { id: row.id, kind: dto.kind, version: dto.version, context: dto.context ?? null, grantedAt: new Date().toISOString() };
  }
}
