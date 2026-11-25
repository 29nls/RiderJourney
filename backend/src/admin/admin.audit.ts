import { Inject, Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { DATABASE, type Database } from '../db/database.js';

export type AuditInput = {
  actorId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  reason: string;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
};

@Injectable()
export class AdminAuditService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async record(input: AuditInput, tx: Database = this.db): Promise<void> {
    await tx.query(
      `INSERT INTO admin_audit_logs (id, actor_id, action, target_type, target_id, reason, before, after, request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)`,
      [
        uuidv7(), input.actorId, input.action, input.targetType, input.targetId ?? null,
        input.reason, input.before === undefined ? null : JSON.stringify(input.before),
        input.after === undefined ? null : JSON.stringify(input.after), input.requestId ?? null,
      ],
    );
  }
}
