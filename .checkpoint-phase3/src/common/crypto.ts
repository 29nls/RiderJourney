import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export type EncryptedValue = { ciphertext: Buffer; iv: Buffer; tag: Buffer; keyVersion: number };

export function encryptValue(plain: string, key: Buffer, keyVersion = 1): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag(), keyVersion };
}

export function decryptValue(value: EncryptedValue, key: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', key, value.iv);
  decipher.setAuthTag(value.tag);
  return Buffer.concat([decipher.update(value.ciphertext), decipher.final()]).toString('utf8');
}
