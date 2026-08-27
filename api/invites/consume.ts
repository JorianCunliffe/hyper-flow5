import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ApiAuthError, requireFirebaseIdentity } from '../../lib/apiAuth.js';
import { consumeOrganizationInvite } from '../../lib/serverStore.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const identity = await requireFirebaseIdentity(req);
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    if (!token) return res.status(400).json({ error: 'Invite token is required' });
    const orgId = await consumeOrganizationInvite(identity.uid, identity.email, token);
    return res.status(200).json({ ok: true, orgId });
  } catch (error: any) {
    const status = error instanceof ApiAuthError ? error.status : /Invite/.test(error?.message || '') ? 400 : 500;
    return res.status(status).json({ error: error?.message || 'Request failed' });
  }
}
