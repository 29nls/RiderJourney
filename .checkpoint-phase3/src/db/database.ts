import pg from 'pg';

export type Row = Record<string, unknown>;

export interface Database {
  readonly kind: 'postgres' | 'pglite';
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

class PgTx implements Database {
  readonly kind = 'postgres' as const;
  constructor(private readonly client: pg.PoolClient) {}
  async query<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.client.query(sql, params);
    return result.rows as T[];
  }
  async exec(sql: string): Promise<void> {
    await this.client.query(sql);
  }
  async transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async close(): Promise<void> {
    this.client.release();
  }
}

export class PgDatabase implements Database {
  readonly kind = 'postgres' as const;
  private readonly pool: pg.Pool;
  constructor(connectionString: string, ssl: boolean) {
    this.pool = new pg.Pool({
      connectionString,
      ssl: ssl ? { rejectUnauthorized: true } : undefined,
      max: 10,
      idleTimeoutMillis: 30_000,
    });
  }
  async query<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.pool.query(sql, params);
    return result.rows as T[];
  }
  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }
  async transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const tx = new PgTx(client);
    try {
      await client.query('BEGIN');
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
}

export const DATABASE = Symbol('DATABASE');
