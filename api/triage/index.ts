import {reviewAgentProposal} from '../../lib/triage/agentProposalReview.js';
import { TenantControlError } from '../../lib/tenantControl/model.js';
import { assertHumanDecision } from '../../lib/http/authority.js';
import type { VercelRequest, VercelResponse } from '../../lib/http/vercelTypes.js';
import { ApiAuthError, requireAppMember, requireProjectInTenant } from '../../lib/apiAuth.js';
import { readTriageDraftPreview, adoptTriageDraftBaseline, recoverReviewedTriageDraft } from '../../lib/triage/draftPreview.js';
import { recoverTriageDraft } from '../../lib/triage/recoverDraft.js';
import {
  listTenantTriageItems,
  listTenantTriageDigests,
  patchTenantTriageItem,
  readTenantTriageItem,
  setTenantTriageDisposition
} from '../../lib/serverStore.js';
import type { TriageDisposition } from '../../types.js';
import { respondToAsk } from '../../lib/asks/respondToAsk.js';
import { readTenantCapabilityPolicy, saveTenantCapabilityPolicy } from '../../lib/capabilityPolicyStore.js';
import { readProjectWorkspaceResources, saveProjectWorkspaceResources } from '../../lib/workspaceResourceCatalog.js';

const dispositions: TriageDisposition[] = [
  'new', 'linked_workflow', 'awaiting_interpretation', 'draft_prepared',
  'needs_review', 'ignored', 'resolved', 'spam_automatic', 'delivery_failure'
];

const requestScope = (req: VercelRequest): string =>
  String(req.query.scope || req.body?.scope || '').trim();

const isAdmin = (role: string): boolean => ['owner', 'admin'].includes(role);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const member = await requireAppMember(req);
    assertHumanDecision(member, 'triage', req.body);
    const scope = requestScope(req);

    if (scope === 'draft') {
      res.setHeader('Cache-Control', 'no-store');
      if (req.method === 'POST' && req.body?.action === 'recover_update') {
        if (!isAdmin(member.role)) throw new ApiAuthError(403, 'Administrator membership required');
        return res.status(200).json(await recoverReviewedTriageDraft(member.orgId, req.body?.id,
          { contentHash: req.body?.contentHash, revision: req.body?.revision, failedReceiptId: req.body?.failedReceiptId }, `${member.role}:${member.uid}`));
      }
      if (req.method === 'POST' && req.body?.action === 'adopt_baseline') {
        return res.status(200).json(await adoptTriageDraftBaseline(member.orgId, req.body?.id,
          { contentHash: req.body?.contentHash, revision: req.body?.revision }, `${member.role}:${member.uid}`));
      }
      if (req.method === 'POST') {
        return res.status(200).json({ item: await recoverTriageDraft(member.orgId, req.body?.id, `${member.role}:${member.uid}`) });
      }
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      return res.status(200).json({ draft: await readTriageDraftPreview(member.orgId, req.query.id) });
    }

    // These are configuration surfaces, not triage semantics. They share this
    // Vercel function only to stay within the deployment function budget.
    if (scope === 'capabilities') {
      if (req.method === 'GET') {
        return res.status(200).json({ policy: await readTenantCapabilityPolicy(member.orgId) });
      }
      if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
      if (!isAdmin(member.role)) return res.status(403).json({ error: 'Administrator membership required' });
      return res.status(200).json({
        policy: await saveTenantCapabilityPolicy(member.orgId, req.body?.policy ?? req.body ?? {})
      });
    }

    if (scope === 'workspace_resources') {
      const projectId = String(req.method === 'GET' ? req.query.projectId || '' : req.body?.projectId || '').trim();
      await requireProjectInTenant(member.orgId, projectId);
      if (req.method === 'GET') {
        return res.status(200).json({ resources: await readProjectWorkspaceResources(member.orgId, projectId) });
      }
      if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
      if (!isAdmin(member.role)) return res.status(403).json({ error: 'Administrator membership required' });
      return res.status(200).json({
        resources: await saveProjectWorkspaceResources(member.orgId, projectId, req.body?.resources || [])
      });
    }

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

    if (action === 'reject_agent_proposal' || action === 'approve_agent_proposal') {
      try { return res.status(200).json(await reviewAgentProposal(member,id,action === 'approve_agent_proposal'?'approve':'reject',actor)); }
      catch(error:any) { return res.status(error.status || 409).json({error:String(error.message || error).slice(0,1000)}); }
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
    if (error instanceof ApiAuthError || error instanceof TenantControlError) return res.status(error.status).json({ error: error.message });
    const message = String(error?.message || error);
    if (/invalid capability|invalid policy|workspace resource|google sheet range/i.test(message)) {
      return res.status(400).json({ error: message });
    }
    return res.status(500).json({ error: message });
  }
}
