import { BadRequestException, ParseUUIDPipe } from '@nestjs/common';

/**
 * Route ids reach SQL casts. Without this, a malformed id surfaces as a 500 from
 * Postgres instead of a 400 that names the problem, and it makes error responses
 * distinguish "bad input" from "server bug" for the client.
 */
export const UuidParamPipe = new ParseUUIDPipe({
  exceptionFactory: () =>
    new BadRequestException({
      code: 'INVALID_ID',
      title: 'ID tidak valid',
      detail: 'ID pada alamat harus berupa UUID.',
    }),
});
