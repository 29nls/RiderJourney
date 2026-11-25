import { createHmac, randomBytes } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateInviteCode(length = 10): string {
  const bytes = randomBytes(length);
  let out = '';
  for (const byte of bytes) out += CROCKFORD[byte & 31];
  return out;
}

export function normalizeInviteCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V');
}

export function hashInviteCode(code: string, pepper: string): string {
  return createHmac('sha256', pepper).update(normalizeInviteCode(code)).digest('hex');
}
