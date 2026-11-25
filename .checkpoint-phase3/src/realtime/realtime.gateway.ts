import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { v7 as uuidv7 } from 'uuid';
import WebSocket, { WebSocketServer } from 'ws';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DATABASE, type Database } from '../db/database.js';
import { RealtimeHub, type RealtimeClient } from './realtime.hub.js';
import { REALTIME_STORE, type RealtimeStore } from './realtime.store.js';
import { RealtimeService } from './realtime.service.js';
import type { StoredPosition } from './realtime.types.js';
import { sha256 } from '../common/crypto.js';

function rejectSocket(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

@Injectable()
export class RealtimeGateway implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RealtimeGateway.name);
  private wss: WebSocketServer | null = null;
  private server: Server | null = null;
  private upgradeHandler: ((request: IncomingMessage, socket: Duplex, head: Buffer) => void) | null = null;
  private staleTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private closing = false;
  private readonly staleNotified = new Map<string, string>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(REALTIME_STORE) private readonly store: RealtimeStore,
    @Inject(RealtimeHub) private readonly hub: RealtimeHub,
    private readonly realtime: RealtimeService,
    private readonly adapterHost: HttpAdapterHost,
  ) {}

  onApplicationBootstrap(): void {
    this.server = this.adapterHost.httpAdapter.getHttpServer() as Server;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024, perMessageDeflate: false });
    this.upgradeHandler = (request, socket, head) => {
      void this.handleUpgrade(request, socket, head);
    };
    this.server.on('upgrade', this.upgradeHandler);

    const staleMs = Math.max(500, Math.min(10_000, (this.config.staleAfterSeconds * 1000) / 2));
    this.staleTimer = setInterval(() => void this.checkStale(), staleMs);
    this.staleTimer.unref();
    this.heartbeatTimer = setInterval(() => this.heartbeat(), 30_000);
    this.heartbeatTimer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    this.closing = true;
    if (this.staleTimer) clearInterval(this.staleTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.server && this.upgradeHandler) this.server.off('upgrade', this.upgradeHandler);
    if (this.wss) {
      for (const socket of this.wss.clients) socket.terminate();
      await new Promise<void>((resolve) => this.wss?.close(() => resolve()));
    }
  }

  private async handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname !== '/v1/realtime') {
        rejectSocket(socket, 404, 'Not Found');
        return;
      }
      const origin = request.headers.origin;
      if (origin && this.config.corsOrigins.length > 0 && !this.config.corsOrigins.includes(origin)) {
        rejectSocket(socket, 403, 'Forbidden');
        return;
      }
      const rawTicket = url.searchParams.get('ticket');
      if (!rawTicket) {
        rejectSocket(socket, 401, 'Unauthorized');
        return;
      }
      const ticket = await this.store.takeTicket(sha256(rawTicket));
      if (!ticket || ticket.expiresAt <= Date.now()) {
        rejectSocket(socket, 401, 'Unauthorized');
        return;
      }
      try {
        await this.realtime.activeMember(ticket.convoyId, ticket.userId);
      } catch {
        rejectSocket(socket, 403, 'Forbidden');
        return;
      }
      this.wss!.handleUpgrade(request, socket, head, (ws) => {
        void this.onConnection(ws, url, ticket.userId, ticket.convoyId);
      });
    } catch (error) {
      this.hub.logError('WebSocket upgrade failed', error);
      rejectSocket(socket, 400, 'Bad Request');
    }
  }

  private async onConnection(ws: WebSocket, url: URL, userId: string, convoyId: string): Promise<void> {
    let snapshot;
    try {
      snapshot = await this.realtime.snapshot(convoyId, userId);
    } catch {
      ws.close(4003, 'access_revoked');
      return;
    }
    const access = await this.realtime.activeMember(convoyId, userId).catch(() => null);
    if (!access) {
      ws.close(4003, 'access_revoked');
      return;
    }
    const client: RealtimeClient = {
      socket: ws,
      userId,
      convoyId,
      role: access.role,
      capabilities: {
        subscribe: true,
        publishLocation: access.convoyStatus === 'active' && access.sharingConsent,
      },
      connectedAt: Date.now(),
      lastLocationAt: 0,
      lastStaleNotice: 0,
      pending: Promise.resolve(),
    };
    this.hub.add(client);
    await this.store.setPresence(
      convoyId,
      { userId, lastSeenAt: new Date().toISOString(), connections: 1 },
      this.config.positionTtlSeconds,
    );

    const sinceSeq = Number(url.searchParams.get('sinceSeq') ?? '0');
    const snapshotData = snapshot as unknown as Record<string, unknown>;
    if (Number.isFinite(sinceSeq) && sinceSeq > 0) {
      const events = await this.store.eventsSince(convoyId, sinceSeq, 200);
      // A sequence gap means the buffer no longer contains every event after sinceSeq.
      const truncated = await this.store.hasEventsBefore(convoyId, sinceSeq) ||
        (events.length > 0 && events[0].seq > sinceSeq + 1);
      for (const event of events) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
      }
      snapshotData.replayTruncated = truncated;
    }
    this.hub.send(client, 'convoy.snapshot', snapshotData, snapshot.lastSeq);

    ws.on('message', (data) => {
      client.pending = client.pending
        .then(() => this.onMessage(client, data.toString()))
        .catch((error) => this.hub.logError('Realtime message failed', error));
    });
    ws.on('close', () => {
      this.hub.remove(client);
      this.staleNotified.delete(`${convoyId}:${userId}`);
      if (this.hub.hasConnections(convoyId, userId)) {
        void this.store
          .setPresence(
            convoyId,
            { userId, lastSeenAt: new Date().toISOString(), connections: this.hub.connections(convoyId) },
            this.config.positionTtlSeconds,
          )
          .catch(() => undefined);
      } else {
        void this.store.deletePresence(convoyId, userId).catch(() => undefined);
      }
      void this.handleLeaderDisconnect(client).catch((error) => this.hub.logError('Leader handoff failed', error));
    });
    ws.on('error', () => this.hub.remove(client));
    ws.send(JSON.stringify({ v: 1, id: uuidv7(), type: 'convoy.ready', room: `convoy:${convoyId}`, seq: 0, ts: new Date().toISOString(), data: { userId, convoyId } }));
  }

  private async onMessage(client: RealtimeClient, raw: string): Promise<void> {
    let message: { type?: unknown; data?: unknown };
    try {
      message = JSON.parse(raw) as { type?: unknown; data?: unknown };
    } catch {
      this.sendError(client, 'INVALID_JSON', 'Pesan bukan JSON yang valid.');
      return;
    }
    if (message.type === 'ping') {
      this.hub.send(client, 'pong', { ts: new Date().toISOString() });
      return;
    }
    if (message.type !== 'convoy.location.updated') {
      this.sendError(client, 'UNSUPPORTED_EVENT', 'Jenis pesan tidak didukung pada kanal ini.');
      return;
    }
    await this.handleLocation(client, message.data);
  }

  private async handleLocation(client: RealtimeClient, raw: unknown): Promise<void> {
    if (!raw || typeof raw !== 'object') {
      this.sendError(client, 'INVALID_PAYLOAD', 'Payload lokasi tidak valid.');
      return;
    }
    const payload = raw as Record<string, unknown>;
    const access = await this.realtime.activeMember(client.convoyId, client.userId).catch(() => null);
    if (!access || access.convoyStatus !== 'active' || !access.sharingConsent) {
      this.sendError(client, 'SHARING_DISABLED', 'Berbagi lokasi tidak aktif atau konvoi tidak berjalan.');
      return;
    }
    const now = Date.now();
    if (now - client.lastLocationAt < 1000) {
      this.sendError(client, 'RATE_LIMITED', 'Kirim posisi maksimal satu kali per detik.');
      return;
    }
    const lat = Number(payload.lat);
    const lng = Number(payload.lng);
    const accuracyM = Number(payload.accuracyM);
    const heading = payload.headingDeg === null || payload.headingDeg === undefined ? null : Number(payload.headingDeg);
    const speed = payload.speedMps === null || payload.speedMps === undefined ? null : Number(payload.speedMps);
    const recordedAt = typeof payload.recordedAt === 'string' ? new Date(payload.recordedAt) : new Date(Number.NaN);
    if (
      !Number.isFinite(lat) || lat < -90 || lat > 90 ||
      !Number.isFinite(lng) || lng < -180 || lng > 180 ||
      !Number.isFinite(accuracyM) || accuracyM < 0 || accuracyM > 1000 ||
      (heading !== null && (!Number.isFinite(heading) || heading < 0 || heading > 360)) ||
      (speed !== null && (!Number.isFinite(speed) || speed < 0 || speed > 100)) ||
      Number.isNaN(recordedAt.getTime()) ||
      recordedAt.getTime() > now + 30_000 ||
      recordedAt.getTime() < now - 300_000
    ) {
      this.sendError(client, 'INVALID_LOCATION', 'Koordinat, akurasi, atau waktu lokasi tidak valid.');
      return;
    }
    const existing = await this.store.getPosition(client.convoyId, client.userId);
    if (existing && new Date(existing.recordedAt).getTime() >= recordedAt.getTime()) {
      this.sendError(client, 'OUT_OF_ORDER', 'Lokasi duplikat atau lebih lama dari posisi terakhir.');
      return;
    }
    client.lastLocationAt = now;
    const clientSeq = Number.isInteger(payload.clientSeq) ? (payload.clientSeq as number) : null;
    const position: StoredPosition = {
      userId: client.userId,
      lat,
      lng,
      accuracyM,
      headingDeg: heading,
      speedMps: speed,
      recordedAt: recordedAt.toISOString(),
      lastSeenAt: new Date(now).toISOString(),
      clientSeq,
    };
    await this.store.setPosition(client.convoyId, position, this.config.positionTtlSeconds);
    await this.store.setPresence(
      client.convoyId,
      { userId: client.userId, lastSeenAt: position.lastSeenAt, connections: 1 },
      this.config.positionTtlSeconds,
    );
    this.staleNotified.delete(`${client.convoyId}:${client.userId}`);
    await this.hub.publish(client.convoyId, 'convoy.location.updated', {
      convoyId: client.convoyId,
      userId: client.userId,
      lat,
      lng,
      accuracyM,
      headingDeg: heading,
      speedMps: speed,
      recordedAt: position.recordedAt,
      stale: false,
    });
  }

  private sendError(client: RealtimeClient, code: string, detail: string): void {
    this.hub.send(client, 'error', { code, detail });
  }

  private async checkStale(): Promise<void> {
    for (const convoyId of this.hub.roomIds()) {
      const positions = await this.store.getPositions(convoyId).catch(() => []);
      const active = new Set(this.hub.clients(convoyId).map((client) => client.userId));
      for (const position of positions) {
        if (!active.has(position.userId)) continue;
        const age = Date.now() - new Date(position.lastSeenAt).getTime();
        if (age <= this.config.staleAfterSeconds * 1000) continue;
        const key = `${convoyId}:${position.userId}`;
        if (this.staleNotified.get(key) === position.lastSeenAt) continue;
        this.staleNotified.set(key, position.lastSeenAt);
        await this.hub.publish(convoyId, 'convoy.location.stale', {
          convoyId,
          userId: position.userId,
          lastSeenAt: position.lastSeenAt,
          stale: true,
        });
      }
    }
  }

  private heartbeat(): void {
    for (const client of this.wss?.clients ?? []) {
      if (client.readyState === WebSocket.OPEN) client.ping();
    }
  }

  private async handleLeaderDisconnect(client: RealtimeClient): Promise<void> {
    if (this.closing) return;
    if (this.hub.hasConnections(client.convoyId, client.userId)) return;
    const rows = await this.db.query<{ role: string; status: string; version: number }>(
      `SELECT m.role, c.status, c.version
       FROM convoys c JOIN convoy_members m ON m.convoy_id = c.id
       WHERE c.id = $1 AND m.user_id = $2 AND m.status = 'active'`,
      [client.convoyId, client.userId],
    );
    const current = rows[0];
    if (!current || current.role !== 'leader') return;
    if (!['lobby', 'active', 'paused'].includes(current.status)) return;

    const handoff = await this.db.transaction(async (tx) => {
      const locked = await tx.query<{ version: number }>('SELECT version FROM convoys WHERE id = $1 FOR UPDATE', [client.convoyId]);
      const candidates = await tx.query<{ user_id: string; role: string }>(
        `SELECT user_id, role FROM convoy_members
         WHERE convoy_id = $1 AND status = 'active' AND user_id <> $2
         ORDER BY CASE role WHEN 'co_leader' THEN 0 ELSE 1 END, joined_at ASC
         LIMIT 1`,
        [client.convoyId, client.userId],
      );
      if (!candidates[0]) return null;
      const next = candidates[0].user_id;
      await tx.query(
        `UPDATE convoy_members SET role = 'leader', updated_at = now() WHERE convoy_id = $1 AND user_id = $2`,
        [client.convoyId, next],
      );
      await tx.query(
        `UPDATE convoy_members SET role = 'co_leader', updated_at = now() WHERE convoy_id = $1 AND user_id = $2`,
        [client.convoyId, client.userId],
      );
      const rows = await tx.query<{ version: number }>(
        `UPDATE convoys SET leader_id = $2, version = version + 1, updated_at = now()
         WHERE id = $1 RETURNING version`,
        [client.convoyId, next],
      );
      await tx.query(
        `INSERT INTO convoy_audit_logs (id, convoy_id, actor_id, action, target_user_id, metadata)
         VALUES ($1, $2, $3, 'leadership.handoff', $4, $5::jsonb)`,
        [uuidv7(), client.convoyId, client.userId, next, JSON.stringify({ reason: 'leader_disconnected', version: rows[0].version })],
      );
      return { next, version: rows[0].version, previousVersion: locked[0]?.version };
    });
    if (!handoff) return;
    await this.hub.publish(client.convoyId, 'convoy.member.updated', {
      convoyId: client.convoyId,
      userId: handoff.next,
      role: 'leader',
      status: 'active',
      previousLeaderId: client.userId,
      reason: 'leader_disconnected',
      version: handoff.version,
    });
  }
}
