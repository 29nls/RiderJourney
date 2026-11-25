import { ForbiddenException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DATABASE, type Database } from '../db/database.js';
import { requireLiveConvoyMember } from '../convoys/convoy-access.js';

/**
 * Voice is authorized per convoy membership, not per community role: co-leaders
 * get moderation powers later by a separate matrix, and today nobody may publish
 * audio into a room they cannot see in their list.
 */
@Injectable()
export class VoiceService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  private assertConfigured(): void {
    if (!this.config.livekitUrl || !this.config.livekitApiKey || !this.config.livekitApiSecret) {
      throw new ServiceUnavailableException({
        code: 'VOICE_UNAVAILABLE',
        title: 'Voice belum dikonfigurasi',
        detail: 'LIVEKIT_URL, LIVEKIT_API_KEY, dan LIVEKIT_API_SECRET harus diisi di server.',
      });
    }
  }

  /**
   * LiveKit join token. The subject is the rider id and the room is derived from
   * the convoy, so the same signed claims cannot be replayed into another room.
   */
  async token(userId: string, convoyId: string) {
    const member = await requireLiveConvoyMember(this.db, convoyId, userId, 'Voice room tidak tersedia');
    this.assertConfigured();
    const now = Math.floor(Date.now() / 1000);
    const ttl = this.config.voiceTokenTtlSeconds;
    const roomName = `convoy-${convoyId}`;
    const token = this.sign({
      iss: this.config.livekitApiKey,
      sub: userId,
      iat: now,
      nbf: now - 5,
      exp: now + ttl,
      name: member.display_name,
      metadata: JSON.stringify({ convoyId, role: member.role }),
      video: { roomJoin: true, room: roomName, canPublish: true, canSubscribe: true },
    });
    return {
      token,
      url: this.config.livekitUrl,
      roomName,
      role: member.role,
      expiresIn: ttl,
      audio: {
        // No server-side auto-talk: the client must call `setMicrophoneEnabled(true)`
        // on WebSocket connect and again on every reconnect, so any mute is re-applied.
        microphoneDefault: false,
      },
    };
  }

  /**
   * Leave records intent only — the server cannot kick a room client through the
   * LiveKit HTTP API itself. The next token request still runs the convoy check,
   * which is what revokes access after leave, removal, or completion.
   */
  async leave(convoyId: string, userId: string) {
    await requireLiveConvoyMember(this.db, convoyId, userId, 'Voice room tidak tersedia');
    return { left: true };
  }

  private sign(payload: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', this.config.livekitApiSecret).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${signature}`;
  }
}
