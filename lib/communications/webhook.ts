import { createHmac, timingSafeEqual } from 'node:crypto';

export const signCommunicationsBody = (rawBody: Buffer | string, secret: string): string =>
  `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;

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
