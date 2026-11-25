import { PGlite } from '@electric-sql/pglite';
import { postgis } from '@electric-sql/pglite-postgis';
import type { Database, Row } from '../db/database.js';

export class PGliteDatabase implements Database {
  readonly kind = 'pglite' as const;
  private constructor(private readonly db: PGlite) {}

  static async create(): Promise<PGliteDatabase> {
    const db = new PGlite({ extensions: { postgis } });
    await db.waitReady;
    return new PGliteDatabase(db);
  }

  async query<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.db.query<T>(sql, params);
    return result.rows;
  }

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }

  async transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T> {
    await this.db.exec('BEGIN');
    try {
      const result = await fn(this);
      await this.db.exec('COMMIT');
      return result;
    } catch (error) {
      await this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}
