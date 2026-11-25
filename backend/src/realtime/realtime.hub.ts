import { Inject, Injectable, Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import WebSocket from 'ws';
import { REALTIME_STORE, type RealtimeStore } from './realtime.store.js';
import type { StoredEvent, TicketCapabilities } from './realtime.types.js';

export type RealtimeClient = {
  socket: WebSocket;
  userId: string;
  convoyId: string;
  role: 'leader' | 'co_leader' | 'member';
  capabilities: TicketCapabilities;
  connectedAt: number;
  lastLocationAt: number;
  lastStaleNotice: number;
  pending: Promise<void>;
};

@Injectable()
export class RealtimeHub {
  private readonly logger = new Logger(RealtimeHub.name);
  private readonly rooms = new Map<string, Set<RealtimeClient>>();

  constructor(@Inject(REALTIME_STORE) private readonly store: RealtimeStore) {}

  add(client: RealtimeClient): void {
    let room = this.rooms.get(client.convoyId);
    if (!room) {
      room = new Set();
      this.rooms.set(client.convoyId, room);
    }
    room.add(client);
  }

  remove(client: RealtimeClient): void {
    const room = this.rooms.get(client.convoyId);
    if (!room) return;
    room.delete(client);
    if (room.size === 0) this.rooms.delete(client.convoyId);
  }

  hasConnections(convoyId: string, userId?: string): boolean {
    const room = this.rooms.get(convoyId);
    if (!room) return false;
    if (!userId) return room.size > 0;
    return [...room].some((client) => client.userId === userId);
  }

  /** Whose sockets are open right now, for presence lists and join receipts. */
  onlineUsers(convoyId: string): string[] {
    return [...new Set((this.rooms.get(convoyId) ? [...this.rooms.get(convoyId)!] : []).map((client) => client.userId))];
  }

  connections(convoyId: string): number {
    return this.rooms.get(convoyId)?.size ?? 0;
  }

  roomIds(): string[] {
    return [...this.rooms.keys()];
  }

  async publish(convoyId: string, type: string, data: Record<string, unknown>): Promise<StoredEvent> {
    const seq = await this.store.nextSeq(convoyId);
    const event: StoredEvent = {
      v: 1,
      id: uuidv7(),
      type,
      room: `convoy:${convoyId}`,
      seq,
      ts: new Date().toISOString(),
      data,
    };
    await this.store.appendEvent(convoyId, event);
    const room = this.rooms.get(convoyId);
    if (room) {
      const encoded = JSON.stringify(event);
      for (const client of room) {
        if (client.socket.readyState === WebSocket.OPEN) client.socket.send(encoded);
      }
    }
    return event;
  }

  send(client: RealtimeClient, type: string, data: Record<string, unknown>, seq = 0): void {
    if (client.socket.readyState !== WebSocket.OPEN) return;
    client.socket.send(
      JSON.stringify({
        v: 1,
        id: uuidv7(),
        type,
        room: `convoy:${client.convoyId}`,
        seq,
        ts: new Date().toISOString(),
        data,
      }),
    );
  }

  disconnectUser(convoyId: string, userId: string, reason = 'access_revoked'): void {
    const room = this.rooms.get(convoyId);
    if (!room) return;
    for (const client of [...room]) {
      if (client.userId !== userId) continue;
      room.delete(client);
      client.socket.close(4003, reason.slice(0, 120));
    }
    if (room.size === 0) this.rooms.delete(convoyId);
  }

  closeConvoy(convoyId: string, reason = 'convoy_ended'): void {
    const room = this.rooms.get(convoyId);
    if (!room) return;
    this.rooms.delete(convoyId);
    for (const client of room) client.socket.close(4003, reason.slice(0, 120));
  }

  clients(convoyId: string): RealtimeClient[] {
    return [...(this.rooms.get(convoyId) ?? [])];
  }

  logError(message: string, error: unknown): void {
    this.logger.warn(`${message}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
