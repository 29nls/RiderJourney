const SECRET_KEYS = /token|secret|password|authorization|cookie|api[-_]?key|signature/i;
const SECRET_TEXT = /(purchaseToken|access_token|refreshToken|refresh_token|password|secret|authorization|apiKey|api_key)=([^&\s"']+)/gi;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const TOKEN_PATH = /\/tokens\/[^/?#\s]+/gi;

/** Best-effort redaction for operational logs. Never used to build responses. */
export function redact(value: string): string {
  return value
    .replace(SECRET_TEXT, '$1=[REDACTED]')
    .replace(BEARER, 'Bearer [REDACTED]')
    .replace(TOKEN_PATH, '/tokens/[REDACTED]');
}

export function redactObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactObject);
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SECRET_KEYS.test(key) ? '[REDACTED]' : redactObject(entry);
    }
    return output;
  }
  if (typeof value === 'string') return redact(value);
  return value;
}
