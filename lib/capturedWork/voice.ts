import { createHash } from 'node:crypto';
import { readTenantAgentProfile, requireOrganizationMember } from '../serverStore.js';
import { createCommunicationsClient } from '../communications/client.js';
import { findFlowRunByAction } from '../flowRunStore.js';
import { handleCapturedWork } from './api.js';
import { CaptureError, text } from './model.js';

export const voiceCaptureDependencies = {
  readTenantAgentProfile, requireOrganizationMember, findFlowRunByAction, handleCapturedWork,
  getCommunication: (org: string, id: string) => createCommunicationsClient().getCommunication(org, id)
};

// Called only after the HTTP adapter verifies a timestamped Communications signature.
// The model supplies the thought, never its owner or provenance.
export async function captureVoiceWork(body: any, deps = voiceCaptureDependencies) {
  const orgId = text(body.tenant_id, 'tenant_id', 200);
  const personId = text(body.person_id, 'person_id', 200);
  const communicationId = text(body.communication_id, 'communication_id', 200);
  const threadId = text(body.thread_id, 'thread_id', 200);
  const identity = text(body.service_identity, 'service_identity', 100);
  const profile = await deps.readTenantAgentProfile(orgId);
  if (!profile?.primaryUserId || profile.primaryPersonId !== personId ||
      ![profile.serviceIdentities?.phone, profile.serviceIdentities?.sms].includes(identity)) {
    throw new CaptureError(403, 'Caller is not authorized to capture personal work');
  }
  await deps.requireOrganizationMember(profile.primaryUserId, orgId);
  const communication = await deps.getCommunication(orgId, communicationId);
  if (communication.tenantId !== orgId || communication.personId !== personId ||
      communication.threadId !== threadId || communication.channel !== 'voice') {
    throw new CaptureError(403, 'Communication is not authorized for this caller');
  }
  const args = body.capture || {};
  const source: Record<string, string> = { sourceCommunicationId: communicationId, sourceThreadId: threadId };
  const correlation = communication.correlation;
  const projectId = correlation?.external_project_id || correlation?.project_id;
  if (projectId) {
    source.sourceProjectId = projectId;
    if (correlation?.run_id && correlation?.task_id) {
      const run = await deps.findFlowRunByAction(orgId, projectId, { runId: correlation.run_id, nodeId: correlation.task_id });
      if (run) { source.sourceRunId = run.id; source.sourceNodeId = correlation.task_id; }
    }
  }
  const idempotencyKey = createHash('sha256').update(JSON.stringify([
    communicationId, text(args.idempotencyKey, 'idempotencyKey', 200)
  ])).digest('hex');
  const result = await deps.handleCapturedWork({ method: 'POST', body: {
    rawText: text(args.rawText, 'rawText'), idempotencyKey, ...source,
    ...Object.fromEntries(['title', 'kind', 'proposedProjectName'].filter(key => args[key] !== undefined).map(key => [key, args[key]]))
  } }, { orgId, uid: profile.primaryUserId });
  return { saved: true, id: result.item!.id, acknowledgement: 'Captured. We can review that later.' };
}
