import 'reflect-metadata';
import { loadConfig } from '../config/env.js';
import { PgDatabase } from '../db/database.js';
import { AdminBootstrapService } from './admin.bootstrap.js';
import type { AdminRole } from './admin.types.js';

const [command, email, role] = process.argv.slice(2);
if (!command || !email) {
  console.error('Usage: admin:bootstrap grant <email> <support|moderator|admin|superadmin> | disable <email>');
  process.exit(2);
}
const config = loadConfig();
const db = new PgDatabase(config.databaseUrl, config.databaseSsl);
const service = new AdminBootstrapService(db);
try {
  if (command === 'grant') {
    console.log(JSON.stringify(await service.grant(email, (role ?? 'support') as AdminRole)));
  } else if (command === 'disable') {
    console.log(JSON.stringify(await service.disable(email)));
  } else {
    console.error('Perintah tidak dikenal.');
    process.exitCode = 2;
  }
} finally {
  await db.close();
}
