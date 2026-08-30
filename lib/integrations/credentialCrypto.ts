import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export interface SealedCredential {
  version: 1;
  algorithm: 'aes-256-gcm';
  iv: string;
  tag: string;
  ciphertext: string;
}

const credentialKey = (): Buffer => {
  const raw = String(process.env.INTEGRATION_ENCRYPTION_KEY || '').trim();
  if (!raw) throw new Error('INTEGRATION_ENCRYPTION_KEY is not configured');
  if (/^[a-f\d]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  if (/^[A-Za-z0-9+/_-]{43,44}={0,2}$/.test(raw)) {
    const decoded = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (decoded.length === 32) return decoded;
  }
  // Deliberately do not silently hash a human password into a key. Requiring
  // 32 random bytes makes weak or truncated deployment values fail closed.
  throw new Error('INTEGRATION_ENCRYPTION_KEY must be 32 random bytes encoded as 64 hex characters or base64');
};

export const sealCredential = (value: unknown): SealedCredential => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', credentialKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url')
  };
};

export const openCredential = <T>(sealed: SealedCredential): T => {
  if (sealed?.version !== 1 || sealed?.algorithm !== 'aes-256-gcm') throw new Error('Unsupported credential envelope');
  const decipher = createDecipheriv('aes-256-gcm', credentialKey(), Buffer.from(sealed.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, 'base64url')),
    decipher.final()
  ]).toString('utf8');
  return JSON.parse(plaintext) as T;
};

export const credentialFingerprint = (value: string): string =>
  createHash('sha256').update(value).digest('hex').slice(0, 16);
