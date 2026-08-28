import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ApiAuthError, requireAppMember } from '../../lib/apiAuth.js';
import {
  listTenantTriageItems,
  patchTenantTriageItem,
  readTenantTriageItem,
  setTenantTriageDisposition
} from '../../lib/serverStore.js';
import type { TriageDisposition } from '../../types.js';
import { respondToAsk } from '../../lib/asks/respondToAsk.js';

const dispositions: TriageDisposition[] = [
  'new', 'linked_workflow', 'awaiting_interpretation', 'draft_prepared',
  'needs_review', 'ignored', 'resolved', 'spam_automatic', 'delivery_failure'
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const member = await requireAppMember(req);
    if (req.method === 'GET') {
      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
      return res.status(200).json({ data: await listTenantTriageItems(member.orgId, limit) });
    }
    if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

    const { id, action, disposition, projectId, askId, proposedAction, decision, values, text } = req.body || {};
    if (typeof id !== 'string' || !id) return res.status(400).json({ error: 'id is required' });
    const actor = `${member.role}:${member.uid}`;

    if (action === 'accept_interpretation') {
      const item = await readTenantTriageItem(member.orgId, id);
      if (!item?.projectId || !item.askId) return res.status(409).json({ error: 'Triage item is not linked to an Ask' });
      const outcome = await respondToAsk({
        orgId: member.orgId,
        projectId: item.projectId,
        askId: item.askId,
        channel: 'web',
        communicationId: item.communicationId,
        actorVerified: true,
        response: {
          actor,
          decision: decision || item.interpretation?.decision,
          text: text || item.interpretation?.evidence,
          structured: values || item.interpretation?.values,
          raw: { triageReview: true, triageItemId: item.id }
        }
      });
      if (!outcome.ok && outcome.reason !== 'already_answered') return res.status(409).json({ error: outcome.reason });
      if (outcome.response?.needsInterpretation) {
        return res.status(409).json({ error: 'A reviewer must supply a valid decision or structured values before accepting this interpretation' });
      }
      const updated = await setTenantTriageDisposition(member.orgId, id, 'resolved', actor, 'Interpretation accepted');
      return res.status(200).json({ item: updated, outcome });
    }

    let item = await patchTenantTriageItem(
      member.orgId,
      id,
      {
        ...(typeof projectId === 'string' ? { projectId } : {}),
        ...(typeof askId === 'string' ? { askId } : {}),
        ...(typeof proposedAction === 'string' ? { proposedAction } : {})
      },
      actor,
      String(action || 'triage_update')
    );
    if (disposition !== undefined) {
      if (!dispositions.includes(disposition)) return res.status(400).json({ error: 'Invalid triage disposition' });
      item = await setTenantTriageDisposition(member.orgId, id, disposition, actor);
    }
    return item ? res.status(200).json({ item }) : res.status(404).json({ error: 'Triage item not found' });
  } catch (error: any) {
    return res.status(error instanceof ApiAuthError ? error.status : 500).json({ error: error?.message || String(error) });
  }
}
