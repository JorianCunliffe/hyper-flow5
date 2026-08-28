import { timingSafeEqual } from 'node:crypto';
import {
  isServerStoreConfigured,
  requireOrganizationMember,
  verifyFirebaseIdToken,
  type AuthenticatedMember
} from './serverStore.js';

export class ApiAuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type RequestLike = { headers: Record<string, string | string[] | undefined> };

const firstHeader = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? String(value[0] || '') : String(value || '');

export const bearerToken = (req: RequestLike): string => {
  const value = firstHeader(req.headers.authorization);
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
};

export const requireAppMember = async (req: RequestLike, requestedOrgId?: string): Promise<AuthenticatedMember> => {
  if (!isServerStoreConfigured()) throw new ApiAuthError(503, 'Server-side authentication is not configured');
  const token = bearerToken(req);
  if (!token) throw new ApiAuthError(401, 'Firebase authentication required');
  try {
    const identity = await verifyFirebaseIdToken(token);
    return await requireOrganizationMember(identity.uid, requestedOrgId);
  } catch (error: any) {
    if (error instanceof ApiAuthError) throw error;
    const message = /membership/i.test(error?.message || '')
      ? 'Organization membership required'
      : 'Invalid or expired Firebase authentication';
    throw new ApiAuthError(message.startsWith('Organization') ? 403 : 401, message);
  }
};

export const requireFirebaseIdentity = async (req: RequestLike): Promise<{ uid: string; email?: string }> => {
  if (!isServerStoreConfigured()) throw new ApiAuthError(503, 'Server-side authentication is not configured');
  const token = bearerToken(req);
  if (!token) throw new ApiAuthError(401, 'Firebase authentication required');
  try {
    return await verifyFirebaseIdToken(token);
  } catch {
    throw new ApiAuthError(401, 'Invalid or expired Firebase authentication');
  }
};

export const hasSharedSecret = (provided: string | string[] | undefined, expected: string | undefined): boolean => {
  if (!expected) return false;
  const actual = firstHeader(provided);
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
};

