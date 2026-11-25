import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { redact } from './redact.js';
import type { Request, Response } from 'express';

type ProblemBody = {
  type?: string;
  title?: string;
  detail?: string;
  code?: string;
  errors?: unknown[];
  retryAfterSeconds?: number;
  [key: string]: unknown;
};

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();
    const requestId = request.requestId ?? 'unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ProblemBody = {
      code: 'INTERNAL_ERROR',
      title: 'Terjadi kesalahan internal',
      detail: 'Permintaan tidak dapat diproses.',
    };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const raw = exception.getResponse();
      if (typeof raw === 'string') {
        body = { code: 'HTTP_ERROR', title: exception.name, detail: raw };
      } else if (raw && typeof raw === 'object') {
        body = raw as ProblemBody;
      }
    } else if (exception instanceof Error) {
      this.logger.error(JSON.stringify({ message: redact(exception.message), requestId, stack: exception.stack ? redact(exception.stack) : undefined }));
    }

    const { type: _type, title: _title, detail: _detail, code: _code, errors: _errors, retryAfterSeconds: _retry, ...extra } = body;
    response.status(status).json({
      ...extra,
      type: `https://errors.riderjourney.example/${(body.code ?? 'error').toLowerCase()}`,
      title: body.title ?? 'Permintaan gagal',
      status,
      code: body.code ?? 'INTERNAL_ERROR',
      detail: body.detail ?? 'Permintaan tidak dapat diproses.',
      requestId,
      ...(body.errors ? { errors: body.errors } : {}),
      ...(body.retryAfterSeconds ? { retryAfterSeconds: body.retryAfterSeconds } : {}),
    });
  }
}
