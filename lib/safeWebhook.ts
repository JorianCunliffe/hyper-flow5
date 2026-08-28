import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 64 * 1024;
const TIMEOUT_MS = 15_000;

const isPrivateIpv4 = (address: string): boolean => {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224;
};

export const isPrivateAddress = (address: string): boolean => {
  const normalized = address.toLowerCase().split('%')[0];
  if (isIP(normalized) === 4) return isPrivateIpv4(normalized);
  if (isIP(normalized) !== 6) return true;
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe') ||
      normalized.startsWith('ff') || normalized.startsWith('100:') || normalized.startsWith('2001:db8:') ||
      normalized.startsWith('2001:10:') || normalized.startsWith('2001:20:')) return true;
  if (normalized.startsWith('::ffff:')) return isPrivateIpv4(normalized.slice(7));
  return false;
};

const allowedHosts = (): Set<string> => new Set(
  String(process.env.WEBHOOK_ALLOWED_HOSTS || '')
    .split(',')
    .map(host => host.trim().toLowerCase())
    .filter(Boolean)
);

export const validateWebhookUrl = async (value: string): Promise<URL> => {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Webhook URL must be an absolute HTTPS URL'); }
  if (url.protocol !== 'https:') throw new Error('Webhook URL must use HTTPS');
  if (url.username || url.password) throw new Error('Webhook URL must not contain credentials');
  if (url.port && url.port !== '443') throw new Error('Webhook URL must use the standard HTTPS port');
  const allowlist = allowedHosts();
  if (allowlist.size && !allowlist.has(url.hostname.toLowerCase())) {
    throw new Error('Webhook host is not in WEBHOOK_ALLOWED_HOSTS');
  }
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) {
    throw new Error('Webhook host resolves to a private, local, reserved, or multicast address');
  }
  return url;
};

const readLimitedText = async (response: Response): Promise<string> => {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error('Webhook response exceeded 64 KiB');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('Webhook response exceeded 64 KiB');
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(merged);
};

export interface SafeWebhookResponse {
  ok: boolean;
  status: number;
  text: string;
  url: string;
}

export const safeWebhookFetch = async (
  rawUrl: string,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch
): Promise<SafeWebhookResponse> => {
  let current = await validateWebhookUrl(rawUrl);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchImpl(current, { ...init, redirect: 'manual', signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects === MAX_REDIRECTS) throw new Error('Webhook exceeded the redirect limit');
      const location = response.headers.get('location');
      if (!location) throw new Error('Webhook redirect did not include a location');
      current = await validateWebhookUrl(new URL(location, current).toString());
      continue;
    }
    return { ok: response.ok, status: response.status, text: await readLimitedText(response), url: current.toString() };
  }
  throw new Error('Webhook redirect handling failed');
};
