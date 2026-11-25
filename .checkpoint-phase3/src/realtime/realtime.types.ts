export type TicketCapabilities = {
  subscribe: boolean;
  publishLocation: boolean;
};

export type RealtimeTicket = {
  hash: string;
  userId: string;
  convoyId: string;
  role: 'leader' | 'co_leader' | 'member';
  capabilities: TicketCapabilities;
  expiresAt: number;
};

export type StoredPosition = {
  userId: string;
  lat: number;
  lng: number;
  accuracyM: number;
  headingDeg: number | null;
  speedMps: number | null;
  recordedAt: string;
  lastSeenAt: string;
  clientSeq: number | null;
};

export type StoredEvent = {
  v: 1;
  id: string;
  type: string;
  room: string;
  seq: number;
  ts: string;
  data: Record<string, unknown>;
};

export type PresenceRecord = {
  userId: string;
  lastSeenAt: string;
  connections: number;
};
