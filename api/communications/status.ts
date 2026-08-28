import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ApiAuthError, requireAppMember } from '../../lib/apiAuth.js';
import { createCommunicationsClient } from '../../lib/communications/client.js';
import { readTenantCommunicationsSettings } from '../../lib/serverStore.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const member = await requireAppMember(req);
    const settings = await readTenantCommunicationsSettings(member.orgId);
    try {
      await createCommunicationsClient().listCommunications(member.orgId, { limit: 1 });
      return res.status(200).json({
        connected: true,
        emailReady: Boolean(settings.defaultEmailIdentity),
        connectionId: settings.connectionId || null,
        emailIdentity: settings.defaultEmailIdentity || null,
        replyIdentity: settings.replyServiceIdentity || null
      });
    } catch (error: any) {
      return res.status(200).json({ connected: false, error: error?.message || 'Communications Service unavailable' });
    }
  } catch (error: any) {
    return res.status(error instanceof ApiAuthError ? error.status : 500).json({ error: error?.message || String(error) });
  }
}
