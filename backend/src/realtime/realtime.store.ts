import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import type { PresenceRecord, RealtimeTicket, StoredEvent, StoredPosition } from './realtime.types.js';

export interface RealtimeStore {
  saveTicket(ticket: RealtimeTicket, ttlSeconds: number): Promise<void>;
  takeTicket(ticketHash: string): Promise<RealtimeTicket | null>;
  setPosition(convoyId: string, position: StoredPosition, ttlSeconds: number): Promise<void>;
  getPosition(convoyId: string, userId: string): Promise<StoredPosition | null>;
  getPositions(convoyId: string): Promise<StoredPosition[]>;
  deletePosition(convoyId: string, userId: string): Promise<void>;
  clearConvoy(convoyId: string): Promise<void>;
  setPresence(convoyId: string, presence: PresenceRecord, ttlSeconds: number): Promise<void>;
  getPresence(convoyId: string): Promise<PresenceRecord[]>;
  deletePresence(convoyId: string, userId: string): Promise<void>;
  nextSeq(convoyId: string): Promise<number>;
  appendEvent(convoyId: string, event: StoredEvent): Promise<void>;
  eventsSince(convoyId: string, sinceSeq: number, limit: number): Promise<StoredEvent[]>;
  hasEventsBefore(convoyId: string, seq: number): Promise<boolean>;
  incrementRateLimit(key: string, ttlSeconds: number): Promise<number>;
  kind(): 'redis' | 'memory';
}

export const REALTIME_STORE = Symbol('REALTIME_STORE');

type MemoryEntry<T> = { value: T; expiresAt: number };

class MemoryMap<T> {
  private readonly values = new Map<string, MemoryEntry<T>>();

  get(key: string): T | null {
    const entry = this.values.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.values.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlSeconds: number): void {
    this.values.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  delete(key: string): void {
    this.values.delete(key);
  }

  entries(): Array<[string, T]> {
    const out: Array<[string, T]> = [];
    const now = Date.now();
    for (const [key, entry] of this.values) {
      if (entry.expiresAt <= now) this.values.delete(key);
      else out.push([key, entry.value]);
    }
    return out;
  }
}

export class MemoryRealtimeStore implements RealtimeStore {
  private readonly tickets = new MemoryMap<RealtimeTicket>();
  private readonly positions = new MemoryMap<StoredPosition>();
  private readonly presence = new MemoryMap<PresenceRecord>();
  private readonly seqs = new MemoryMap<number>();
  private readonly events = new MemoryMap<StoredEvent[]>();
  private readonly rates = new MemoryMap<number>();
  private readonly eventTtl = 86_400;

  async saveTicket(ticket: RealtimeTicket, ttlSeconds: number): Promise<void> {
    this.tickets.set(ticket.hash, ticket, ttlSeconds);
  }

  async takeTicket(ticketHash: string): Promise<RealtimeTicket | null> {
    const ticket = this.tickets.get(ticketHash);
    this.tickets.delete(ticketHash);
    return ticket;
  }

  async setPosition(convoyId: string, position: StoredPosition, ttlSeconds: number): Promise<void> {
    this.positions.set(`${convoyId}:${position.userId}`, position, ttlSeconds);
  }

  async getPosition(convoyId: string, userId: string): Promise<StoredPosition | null> {
    return this.positions.get(`${convoyId}:${userId}`);
  }

  async getPositions(convoyId: string): Promise<StoredPosition[]> {
    return this.positions
      .entries()
      .filter(([key]) => key.startsWith(`${convoyId}:`))
      .map(([, value]) => value);
  }

  async deletePosition(convoyId: string, userId: string): Promise<void> {
    this.positions.delete(`${convoyId}:${userId}`);
  }

  async clearConvoy(convoyId: string): Promise<void> {
    for (const [key] of this.positions.entries()) {
      if (key.startsWith(`${convoyId}:`)) this.positions.delete(key);
    }
    for (const [key] of this.presence.entries()) {
      if (key.startsWith(`${convoyId}:`)) this.presence.delete(key);
    }
  }

  async setPresence(convoyId: string, presence: PresenceRecord, ttlSeconds: number): Promise<void> {
    this.presence.set(`${convoyId}:${presence.userId}`, presence, ttlSeconds);
  }

  async getPresence(convoyId: string): Promise<PresenceRecord[]> {
    return this.presence
      .entries()
      .filter(([key]) => key.startsWith(`${convoyId}:`))
      .map(([, value]) => value);
  }

  async deletePresence(convoyId: string, userId: string): Promise<void> {
    this.presence.delete(`${convoyId}:${userId}`);
  }

  async nextSeq(convoyId: string): Promise<number> {
    const next = (this.seqs.get(convoyId) ?? 0) + 1;
    this.seqs.set(convoyId, next, this.eventTtl);
    return next;
  }

  async appendEvent(convoyId: string, event: StoredEvent): Promise<void> {
    const current = this.events.get(convoyId) ?? [];
    current.push(event);
    this.events.set(convoyId, current.slice(-2000), this.eventTtl);
  }

  async eventsSince(convoyId: string, sinceSeq: number, limit: number): Promise<StoredEvent[]> {
    const current = this.events.get(convoyId) ?? [];
    return current.filter((event) => event.seq > sinceSeq).slice(-limit);
  }

  async hasEventsBefore(convoyId: string, seq: number): Promise<boolean> {
    const current = this.events.get(convoyId) ?? [];
    return current.length > 0 && current[0].seq < seq;
  }

  async incrementRateLimit(key: string, ttlSeconds: number): Promise<number> {
    const next = (this.rates.get(key) ?? 0) + 1;
    this.rates.set(key, next, ttlSeconds);
    return next;
  }

  kind(): 'redis' | 'memory' {
    return 'memory';
  }
}

export class RedisRealtimeStore implements RealtimeStore, OnModuleDestroy {
  private readonly positionTtl = 300;
  constructor(private readonly redis: Redis) {}

  private posKey(convoyId: string, userId: string): string {
    return `convoy:${convoyId}:pos:${userId}`;
  }

  private presenceKey(convoyId: string): string {
    return `convoy:${convoyId}:presence`;
  }

  private eventsKey(convoyId: string): string {
    return `convoy:${convoyId}:events`;
  }

  async saveTicket(ticket: RealtimeTicket, ttlSeconds: number): Promise<void> {
    await this.redis.set(`ws:ticket:${ticket.hash}`, JSON.stringify(ticket), 'EX', ttlSeconds, 'NX');
  }

  async takeTicket(ticketHash: string): Promise<RealtimeTicket | null> {
    const key = `ws:ticket:${ticketHash}`;
    const raw = await this.redis.eval(
      "local v=redis.call('GET',KEYS[1]); if v then redis.call('DEL',KEYS[1]) end; return v",
      1,
      key,
    );
    if (typeof raw !== 'string') return null;
    return JSON.parse(raw) as RealtimeTicket;
  }

  async setPosition(convoyId: string, position: StoredPosition, ttlSeconds = this.positionTtl): Promise<void> {
    const key = this.posKey(convoyId, position.userId);
    await this.redis
      .multi()
      .set(key, JSON.stringify(position), 'EX', ttlSeconds)
      .hset(this.presenceKey(convoyId), position.userId, JSON.stringify({ userId: position.userId, lastSeenAt: position.lastSeenAt, connections: 1 }))
      .expire(this.presenceKey(convoyId), ttlSeconds)
      .exec();
  }

  async getPosition(convoyId: string, userId: string): Promise<StoredPosition | null> {
    const raw = await this.redis.get(this.posKey(convoyId, userId));
    return raw ? (JSON.parse(raw) as StoredPosition) : null;
  }

  async getPositions(convoyId: string): Promise<StoredPosition[]> {
    const keys = await this.redis.keys(this.posKey(convoyId, '*'));
    if (keys.length === 0) return [];
    const values = await this.redis.mget(...keys);
    return values
      .filter((value: string | null): value is string => Boolean(value))
      .map((value: string) => JSON.parse(value) as StoredPosition);
  }

  async deletePosition(convoyId: string, userId: string): Promise<void> {
    await this.redis.multi().del(this.posKey(convoyId, userId)).hdel(this.presenceKey(convoyId), userId).exec();
  }

  async clearConvoy(convoyId: string): Promise<void> {
    const keys = await this.redis.keys(`convoy:${convoyId}:*`);
    if (keys.length > 0) await this.redis.del(...keys);
  }

  async setPresence(convoyId: string, presence: PresenceRecord, ttlSeconds: number): Promise<void> {
    await this.redis
      .multi()
      .hset(this.presenceKey(convoyId), presence.userId, JSON.stringify(presence))
      .expire(this.presenceKey(convoyId), ttlSeconds)
      .exec();
  }

  async getPresence(convoyId: string): Promise<PresenceRecord[]> {
    const values = await this.redis.hgetall(this.presenceKey(convoyId));
    return Object.values(values).map((value) => JSON.parse(value) as PresenceRecord);
  }

  async deletePresence(convoyId: string, userId: string): Promise<void> {
    await this.redis.hdel(this.presenceKey(convoyId), userId);
  }

  async nextSeq(convoyId: string): Promise<number> {
    const key = `convoy:${convoyId}:seq`;
    const seq = await this.redis.incr(key);
    await this.redis.expire(key, 86_400);
    return seq;
  }

  async appendEvent(convoyId: string, event: StoredEvent): Promise<void> {
    const key = this.eventsKey(convoyId);
    await this.redis.multi().rpush(key, JSON.stringify(event)).ltrim(key, -2000, -1).expire(key, 86_400).exec();
  }

  async eventsSince(convoyId: string, sinceSeq: number, limit: number): Promise<StoredEvent[]> {
    const raw = await this.redis.lrange(this.eventsKey(convoyId), -2000, -1);
    return raw
      .map((value: string) => JSON.parse(value) as StoredEvent)
      .filter((event: StoredEvent) => event.seq > sinceSeq)
      .slice(-limit);
  }

  async hasEventsBefore(convoyId: string, seq: number): Promise<boolean> {
    const first = await this.redis.lindex(this.eventsKey(convoyId), 0);
    if (!first) return false;
    return (JSON.parse(first) as StoredEvent).seq < seq;
  }

  async incrementRateLimit(key: string, ttlSeconds: number): Promise<number> {
    const value = await this.redis.incr(`rate:${key}`);
    if (value === 1) await this.redis.expire(`rate:${key}`, ttlSeconds);
    return value;
  }

  kind(): 'redis' | 'memory' {
    return 'redis';
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}

@Injectable()
export class RealtimeStoreProvider {
  static create(config: AppConfig): RealtimeStore {
    if (config.redisUrl) {
      return new RedisRealtimeStore(new Redis(config.redisUrl, { maxRetriesPerRequest: 2, lazyConnect: false }));
    }
    if (config.nodeEnv === 'production') {
      throw new Error('REDIS_URL is required in production for convoy realtime');
    }
    Logger.warn('REDIS_URL not set; using in-process realtime store (development/test only).', 'RealtimeStore');
    return new MemoryRealtimeStore();
  }
}

export function createRealtimeStore(config: AppConfig): RealtimeStore {
  return RealtimeStoreProvider.create(config);
}

export const realtimeStoreFactory = {
  provide: REALTIME_STORE,
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig): RealtimeStore => createRealtimeStore(config),
};
