import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ApiAuthError, requireAppMember } from '../../lib/apiAuth.js';
import {
  claimTriageAgentProposal,
  findProject,
  finishTriageAgentProposal,
  listTenantTriageItems,
  listTenantTriageDigests,
  patchTenantTriageItem,
  readTenantTriageItem,
  setTenantTriageDisposition,
  writeProject
} from '../../lib/serverStore.js';
import type { TriageDisposition } from '../../types.js';
import { respondToAsk } from '../../lib/asks/respondToAsk.js';
import { appendGrantedGoogleSheet } from '../../lib/integrations/googleWorkspace.js';
import { advanceScheduledServerFlow } from '../../lib/serverFlow.js';
import { COACHING_TRANSIENT_KEYS } from '../../lib/projectTemplates.js';

const dispositions: TriageDisposition[] = [
  'new', 'linked_workflow', 'awaiting_interpretation', 'draft_prepared',
  'needs_review', 'ignored', 'resolved', 'spam_automatic', 'delivery_failure'
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const member = await requireAppMember(req);
    if (req.method === 'GET') {
      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
      const [data, digests] = await Promise.all([
        listTenantTriageItems(member.orgId, limit),
        listTenantTriageDigests(member.orgId, 30)
      ]);
      return res.status(200).json({ data, digests });
    }
    if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

    const { id, action, disposition, projectId, askId, proposedAction, decision, values, text } = req.body || {};
    if (typeof id !== 'string' || !id) return res.status(400).json({ error: 'id is required' });
    const actor = `${member.role}:${member.uid}`;

    if (action === 'reject_agent_proposal') {
      const item = await finishTriageAgentProposal(member.orgId, id, 'rejected', actor);
      return item ? res.status(200).json({ item }) : res.status(409).json({ error: 'Agent proposal is not awaiting review' });
    }

    if (action === 'approve_agent_proposal') {
      const claimed = await claimTriageAgentProposal(member.orgId, id, actor);
      if (!claimed?.agentProposal) return res.status(409).json({ error: 'Agent proposal is not awaiting review' });
      const proposal = claimed.agentProposal;
      try {
        const located = await findProject(member.orgId, proposal.projectId);
        if (!located || located.project.projectData?.project_template !== 'daily_coaching') {
          throw new Error('Agent proposal is not linked to a Daily Coaching project');
        }
        if (proposal.kind === 'request_coaching_call') {
          const scheduledFor = proposal.requestedAt;
          const outcome = await advanceScheduledServerFlow(member.orgId, proposal.projectId, {
            scheduleId: `agent_request:${id}`,
            scheduleRunId: `agent_request:${id}:${scheduledFor}`,
            scheduledFor,
            flowId: 'coaching',
            resetPolicy: 'flow',
            clearProjectDataKeys: COACHING_TRANSIENT_KEYS,
            input: { coaching_trigger: 'approved_agent_request', coaching_request_communication_id: claimed.communicationId }
          });
          if (!outcome.ok) throw new Error(outcome.reason || 'Coaching call could not be started');
        } else {
          const value = String(proposal.value || '').trim();
          if (!value) throw new Error('Coaching proposal has no value');
          const isCommitment = proposal.kind === 'coaching_commitment';
          const when = new Date(proposal.requestedAt).toISOString();
          await appendGrantedGoogleSheet(
            member.orgId,
            proposal.projectId,
            `agent-proposal:${member.orgId}:${id}:sheet:v1`,
            [[when, '', '', isCommitment ? value : '', isCommitment ? '' : value, proposal.summary, proposal.confidence]]
          );
          const key = isCommitment ? 'coaching_commitments' : 'coaching_next_actions';
          const existing = String(located.project.projectData?.[key] || '').trim();
          const combined = existing && !existing.split('\n').includes(value) ? `${existing}\n${value}` : existing || value;
          const priorUpdates = Array.isArray(located.project.projectData?.coaching_manual_updates)
            ? located.project.projectData.coaching_manual_updates.slice(-99) : [];
          await writeProject(member.orgId, located.index, {
            ...located.project,
            projectData: {
              ...(located.project.projectData || {}),
              [key]: combined,
              coaching_manual_updates: [...priorUpdates, {
                at: when, kind: proposal.kind, value, sourceCommunicationId: claimed.communicationId, actor
              }]
            }
          });
        }
        const item = await finishTriageAgentProposal(member.orgId, id, 'applied', actor);
        return res.status(200).json({ item });
      } catch (error: any) {
        const message = String(error?.message || error).slice(0, 1_000);
        await finishTriageAgentProposal(member.orgId, id, 'failed', actor, message);
        return res.status(409).json({ error: message });
      }
    }

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
