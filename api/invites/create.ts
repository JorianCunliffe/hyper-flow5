import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ApiAuthError, requireAppMember } from '../../lib/apiAuth.js';
import { createOrganizationInvite } from '../../lib/serverStore.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const member = await requireAppMember(req);
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!EMAIL.test(email)) return res.status(400).json({ error: 'A valid invite email is required' });
    const token = await createOrganizationInvite(member, email);
    return res.status(201).json({ ok: true, token });
  } catch (error: any) {
    return res.status(error instanceof ApiAuthError ? error.status : /Administrator/.test(error?.message || '') ? 403 : 500)
      .json({ error: error?.message || 'Request failed' });
  }
}

