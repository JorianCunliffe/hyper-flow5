import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ApiAuthError, requireAppMember } from '../../lib/apiAuth.js';
import { readTenantCapabilityPolicy, saveTenantCapabilityPolicy } from '../../lib/capabilityPolicyStore.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const member = await requireAppMember(req);
    if (req.method === 'GET') {
      return res.status(200).json({ policy: await readTenantCapabilityPolicy(member.orgId) });
    }
    if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
    if (!['owner', 'admin'].includes(member.role)) return res.status(403).json({ error: 'Administrator membership required' });
    const policy = await saveTenantCapabilityPolicy(member.orgId, req.body?.policy ?? req.body ?? {});
    return res.status(200).json({ policy });
  } catch (error: any) {
    if (error instanceof ApiAuthError) return res.status(error.status).json({ error: error.message });
    const message = String(error?.message || error);
    if (/invalid capability|invalid policy/i.test(message)) return res.status(400).json({ error: message });
    console.error('Capability policy API failed', error);
    return res.status(500).json({ error: 'Capability policy request failed' });
  }
}
