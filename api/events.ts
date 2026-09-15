import { parseSignedJsonBody, verifyIncomingCommunicationsSignature } from '../lib/communications/webhook.js';
import { externalEventHttpStatus, receiveExternalEvent } from '../lib/externalEvents.js';
import { createHash } from 'node:crypto';
import { readVoiceContextResponse, saveVoiceContextResponse, serverStoreStatus } from '../lib/serverStore.js';
import { buildVoiceAgentContext, type VoiceAgentContextRequest } from '../lib/voiceAgentContext.js';
import { advanceEventServerFlow, type AdvanceOutcome } from '../lib/serverFlow.js';
import { waitUntil } from '@vercel/functions';
import { processAgentInbox } from '../lib/agentRouter.js';

const json = (body: unknown, status: number): Response => Response.json(body, { status });

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const eventFlowTarget = (body: any): { orgId: string; projectId: string } | null => {
  const correlation = body?.correlation && typeof body.correlation === 'object' ? body.correlation : {};
  const orgId = text(correlation.tenant_id || correlation.org_id || correlation.orgId || body?.tenant_id);
  const projectId = text(correlation.external_project_id || correlation.project_id || correlation.projectId);
  if (!orgId || !projectId) return null;
  // Provider callbacks already belong to an in-flight action. Let callback
  // correlation resolve that run rather than resetting the project as a new occurrence.
  if (correlation.run_id || correlation.runId || correlation.task_id || correlation.node_id || correlation.nodeId) return null;
  return { orgId, projectId };
};

const dispatchEventFlow = async (body: any): Promise<AdvanceOutcome | null> => {
  const target = eventFlowTarget(body);
  const eventId = text(body?.event_id);
  const type = text(body?.type);
  if (!target || !eventId || !type) return null;
  const payload = body?.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
    ? body.payload as Record<string, unknown>
    : {};
  const occurred = body?.occurred_at ? new Date(body.occurred_at).getTime() : Date.now();
  const channel = text(body?.channel || payload.channel);
  const direction = text(payload.direction) || (type === 'communication.received' || type === 'sms.received' ? 'inbound' : undefined);
  const personId = text(body?.correlation?.person_id || body?.correlation?.personId);
  const communicationId = text(body?.communication_id);

  return advanceEventServerFlow(target.orgId, target.projectId, {
    id: eventId,
    type,
    occurredAt: Number.isFinite(occurred) ? occurred : Date.now(),
    channel,
    direction,
    personId,
    communicationId,
    payload
  });
};

// Vercel's Web Request handler exposes the untouched body stream. Reading it as
// an ArrayBuffer preserves the exact bytes Communications signed.
export const POST = async (request: Request): Promise<Response> => {
  const secret = process.env.COMMUNICATIONS_WEBHOOK_SECRET;
  if (!secret) return json({ error: 'COMMUNICATIONS_WEBHOOK_SECRET is not configured' }, 503);

  const rawBody = Buffer.from(await request.arrayBuffer());
  const action = new URL(request.url).searchParams.get('action');
  if (action === 'voice_context' && rawBody.length > 64 * 1024) return json({ error: 'Request body is too large' }, 413);
  const signature = request.headers.get('x-communications-signature') || undefined;
  const signatureV2 = request.headers.get('x-communications-signature-v2') || undefined;
  const timestamp = request.headers.get('x-communications-timestamp') || undefined;
  const valid = verifyIncomingCommunicationsSignature(
    rawBody,
    { signature, signatureV2, timestamp },
    secret,
    action === 'voice_context' ? true : undefined
  );
  if (!valid) return json({ error: 'Invalid or missing Communications signature' }, 401);

  const storeStatus = serverStoreStatus();
  if (!storeStatus.ok) {
    console.error('External event inbox unavailable:', storeStatus.reason);
    return json({ error: 'Server-side persistence is not configured' }, 503);
  }

  try {
    const body = parseSignedJsonBody(rawBody);
    if (action === 'voice_context') {
      const requiredText = (value: unknown, name: string, max = 500): string => {
        if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
        return value.trim().slice(0, max);
      };
      const input: VoiceAgentContextRequest = {
        request_id: requiredText(body.request_id, 'request_id', 200),
        tenant_id: requiredText(body.tenant_id, 'tenant_id', 200),
        person_id: requiredText(body.person_id, 'person_id', 200),
        thread_id: requiredText(body.thread_id, 'thread_id', 200),
        communication_id: requiredText(body.communication_id, 'communication_id', 200),
        service_identity: requiredText(body.service_identity, 'service_identity', 100),
        ...(typeof body.utterance === 'string' && body.utterance.trim() ? { utterance: body.utterance.trim().slice(0, 4_000) } : {})
      };
      const requestHash = createHash('sha256').update(rawBody).digest('hex');
      const existing = await readVoiceContextResponse(input.tenant_id, input.request_id, requestHash);
      const response = await buildVoiceAgentContext(input);
      if (existing) return json(response, 200);
      const stored = await saveVoiceContextResponse(input.tenant_id, input.request_id, requestHash, response as unknown as Record<string, unknown>);
      return json(stored, 200);
    }

    const outcome = await receiveExternalEvent({ ...body, source: body.source || 'communications' });

    if (outcome.ok && outcome.reason === 'agent_job_queued') {
      const orgId = String(body.tenant_id || body.correlation?.tenant_id || '');
      const jobId = String(body.communication_id || '');
      if (orgId && jobId) {
        // Preserve ordering inside one background task. A correlated Event flow
        // gets first refusal; the inbox worker then observes flow_trigger_event_id
        // and closes the job without producing a second AI response.
        waitUntil((async () => {
          if (!outcome.duplicate) await dispatchEventFlow(body);
          await processAgentInbox(1, { orgId, jobId });
        })().catch(error => {
          console.error('Event flow / agent inbox processing failed', {
            orgId, jobId, eventId: body.event_id, error: error?.message || String(error)
          });
        }));
      }
    } else if (outcome.ok && !outcome.duplicate) {
      waitUntil(dispatchEventFlow(body).catch(error => {
        console.error('Event-triggered flow failed', {
          eventId: body.event_id,
          type: body.type,
          error: error?.message || String(error)
        });
        return null;
      }));
    }

    if (!outcome.ok) {
      console.warn('External event was not accepted', {
        event_id: body.event_id,
        event_type: body.type,
        reason: outcome.reason,
        retryable: outcome.retryable
      });
    }
    return json(outcome, externalEventHttpStatus(outcome));
  } catch (error: any) {
    if (/required|JSON object|valid JSON|reused|too large/.test(error?.message || '')) return json({ error: error.message }, 400);
    if (/not authorized|service identity/.test(error?.message || '')) return json({ error: error.message }, 403);
    console.error('External event handler failed', error);
    return json({ error: 'Handler failed' }, 500);
  }
};

export const GET = async (): Promise<Response> => json({ error: 'Method not allowed' }, 405);
