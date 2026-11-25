import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from './config/env.js';
import { DATABASE } from './db/database.js';
import { PgDatabase } from './db/database.js';

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    {
      provide: DATABASE,
      inject: [APP_CONFIG],
      useFactory: (config: ReturnType<typeof loadConfig>) => new PgDatabase(config.databaseUrl, config.databaseSsl),
    },
  ],
  exports: [APP_CONFIG, DATABASE],
})
export class CoreModule {}
