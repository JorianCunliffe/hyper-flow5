import { parseSignedJsonBody, verifyIncomingCommunicationsSignature } from '../lib/communications/webhook.js';
import { externalEventHttpStatus, receiveExternalEvent } from '../lib/externalEvents.js';
import { createHash } from 'node:crypto';
import { readVoiceContextResponse, saveVoiceContextResponse, serverStoreStatus } from '../lib/serverStore.js';
import { buildVoiceAgentContext, type VoiceAgentContextRequest } from '../lib/voiceAgentContext.js';

const json = (body: unknown, status: number): Response => Response.json(body, { status });

// Vercel's Web Request handler exposes the untouched body stream. Reading it as
// an ArrayBuffer preserves the exact bytes Communications signed; reconstructing
// JSON from VercelRequest.body would change whitespace and invalidate the HMAC.
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
  if (!valid) {
    return json({ error: 'Invalid or missing Communications signature' }, 401);
  }

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
      if (existing) return json(existing, 200);
      const response = await buildVoiceAgentContext(input);
      const stored = await saveVoiceContextResponse(input.tenant_id, input.request_id, requestHash, response as unknown as Record<string, unknown>);
      return json(stored, 200);
    }
    const outcome = await receiveExternalEvent({ ...body, source: body.source || 'communications' });
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
