import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ApiAuthError, requireFirebaseIdentity } from '../../lib/apiAuth.js';
import { createOrganizationForUser } from '../../lib/serverStore.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const identity = await requireFirebaseIdentity(req);
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 120) return res.status(400).json({ error: 'A valid organization name is required' });
    const orgId = await createOrganizationForUser(identity.uid, identity.email, name);
    return res.status(201).json({ ok: true, orgId });
  } catch (error: any) {
    return res.status(error instanceof ApiAuthError ? error.status : 500).json({ error: error?.message || 'Request failed' });
  }
}

