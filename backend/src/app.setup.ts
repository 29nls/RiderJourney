import { INestApplication, UnprocessableEntityException, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { ProblemFilter } from './common/problem.filter.js';
import type { AppConfig } from './config/env.js';

function flatten(errors: ValidationError[], parent = ''): Array<{ field: string; code: string; message: string }> {
  const out: Array<{ field: string; code: string; message: string }> = [];
  for (const error of errors) {
    const field = parent ? `${parent}.${error.property}` : error.property;
    for (const [code, message] of Object.entries(error.constraints ?? {})) {
      out.push({ field, code, message });
    }
    if (error.children?.length) out.push(...flatten(error.children, field));
  }
  return out;
}

export function configureApp(app: INestApplication, config: AppConfig): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new UnprocessableEntityException({
          code: 'VALIDATION_FAILED',
          title: 'Permintaan tidak valid',
          detail: 'Satu atau lebih field tidak valid.',
          errors: flatten(errors),
        }),
    }),
  );
  app.useGlobalFilters(new ProblemFilter());
  app.enableCors({
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.enableShutdownHooks();
}
