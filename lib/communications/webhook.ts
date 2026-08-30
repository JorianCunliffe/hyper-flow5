import { createHmac, timingSafeEqual } from 'node:crypto';

export const signCommunicationsBody = (rawBody: Buffer | string, secret: string): string =>
  `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;

export const signCommunicationsBodyV2 = (timestamp: string, rawBody: Buffer | string, secret: string): string =>
  `sha256=${createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex')}`;

export const verifyCommunicationsSignature = (
  rawBody: Buffer | string,
  signature: string | string[] | undefined,
  secret: string
): boolean => {
  const supplied = Array.isArray(signature) ? signature[0] : signature;
  if (!supplied || !/^sha256=[a-f0-9]{64}$/i.test(supplied)) return false;
  const expected = signCommunicationsBody(rawBody, secret);
  const actualBuffer = Buffer.from(supplied.toLowerCase());
  const expectedBuffer = Buffer.from(expected.toLowerCase());
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
};

export const verifyCommunicationsSignatureV2 = (
  rawBody: Buffer | string,
  signature: string | string[] | undefined,
  timestamp: string | string[] | undefined,
  secret: string,
  now = Date.now(),
  maxSkewMs = 5 * 60_000
): boolean => {
  const supplied = Array.isArray(signature) ? signature[0] : signature;
  const signedAt = Array.isArray(timestamp) ? timestamp[0] : timestamp;
  if (!supplied || !/^sha256=[a-f0-9]{64}$/i.test(supplied) || !/^\d{10}$/.test(String(signedAt || ''))) return false;
  const timestampMs = Number(signedAt) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > maxSkewMs) return false;
  const expected = signCommunicationsBodyV2(String(signedAt), rawBody, secret);
  const actualBuffer = Buffer.from(supplied.toLowerCase());
  const expectedBuffer = Buffer.from(expected.toLowerCase());
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
};

export const communicationsSignatureV2Required = (): boolean => {
  const configured = String(process.env.COMMUNICATIONS_REQUIRE_SIGNATURE_V2 || '').trim().toLowerCase();
  if (configured === 'true') return true;
  if (configured === 'false') return false;
  return process.env.NODE_ENV === 'production';
};

export const verifyIncomingCommunicationsSignature = (
  rawBody: Buffer | string,
  headers: { signature?: string | string[]; signatureV2?: string | string[]; timestamp?: string | string[] },
  secret: string,
  requireV2 = communicationsSignatureV2Required()
): boolean => {
  if (requireV2 || headers.signatureV2 || headers.timestamp) {
    return verifyCommunicationsSignatureV2(rawBody, headers.signatureV2, headers.timestamp, secret);
  }
  return verifyCommunicationsSignature(rawBody, headers.signature, secret);
};

export const parseSignedJsonBody = (rawBody: Buffer | string): any => {
  const text = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
  if (!text.trim()) throw new Error('Event body must be a JSON object');
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { throw new Error('Event body must be valid JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Event body must be a JSON object');
  }
  return parsed;
};
