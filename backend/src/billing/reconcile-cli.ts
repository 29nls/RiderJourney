import 'reflect-metadata';
import { loadConfig } from '../config/env.js';
import { PgDatabase } from '../db/database.js';
import { PlanService } from '../entitlements/plan.service.js';
import { BillingService } from './billing.service.js';
import { GooglePlayVerifier } from './google-play.verifier.js';

const config = loadConfig();
const db = new PgDatabase(config.databaseUrl, config.databaseSsl);
const plans = new PlanService(db, config);
const billing = new BillingService(config, db, new GooglePlayVerifier(config), plans);

try {
  console.log(JSON.stringify({ ok: true, result: await billing.reconcile(100) }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
} finally {
  await db.close();
}
