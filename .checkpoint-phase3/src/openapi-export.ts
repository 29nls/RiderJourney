import 'reflect-metadata';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { APP_CONFIG, type AppConfig } from './config/env.js';
import { configureApp } from './app.setup.js';

const app = await NestFactory.create(AppModule, { logger: false });
const config = app.get<AppConfig>(APP_CONFIG);
configureApp(app, config);
const document = SwaggerModule.createDocument(
  app,
  new DocumentBuilder().setTitle('RiderJourney API').setVersion('1.0').addBearerAuth().build(),
);
const target = resolve(process.cwd(), '..', 'docs', 'openapi.json');
await writeFile(target, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
await app.close();
console.log(JSON.stringify({ ok: true, target, paths: Object.keys(document.paths ?? {}).length }));
