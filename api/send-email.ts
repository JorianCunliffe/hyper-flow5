import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createCommunicationsClient } from '../lib/communications/client.js';
import { readTenantCommunicationsSettings } from '../lib/serverStore.js';
import { ApiAuthError, requireAppMember } from '../lib/apiAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const member = await requireAppMember(req);
    const { to, subject, html, text, projectId, taskId, runId } = req.body || {};
    if (!projectId || !taskId || !runId) throw new Error('projectId, taskId and runId are required');
    const settings = await readTenantCommunicationsSettings(member.orgId);
    if (!settings.defaultEmailIdentity) throw new Error('A tenant Communications email identity is required');
    const result = await createCommunicationsClient().sendEmail({
      to: Array.isArray(to) ? to.map(String) : [String(to || '')].filter(Boolean),
      service_identity_id: settings.defaultEmailIdentity,
      provider_connection_id: settings.connectionId,
      reply_to: settings.replyServiceIdentity ? [settings.replyServiceIdentity] : undefined,
      subject: String(subject || 'HyperFlow notification'),
      text: typeof text === 'string' ? text : undefined,
      html: typeof html === 'string' ? html : undefined,
      purpose: { type: 'workflow_notification' },
      correlation: {
        tenant_id: member.orgId,
        external_project_id: String(projectId),
        task_id: String(taskId),
        run_id: String(runId)
      },
      callback_url: process.env.PUBLIC_BASE_URL
        ? `${process.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/api/events`
        : undefined
    });
    res.status(202).json({ communication: result });
  } catch (error: any) {
    console.error(error);
    res.status(error instanceof ApiAuthError ? error.status : 500).json({ error: error?.message || String(error) });
  }
}
