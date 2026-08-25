import { parseSignedJsonBody, verifyCommunicationsSignature } from '../lib/communications/webhook.js';
import { receiveExternalEvent } from '../lib/externalEvents.js';
import { serverStoreStatus } from '../lib/serverStore.js';

const json = (body: unknown, status: number): Response => Response.json(body, { status });

type ExternalEventOutcome = {
  ok: boolean;
  retryable?: boolean;
};

export const externalEventHttpStatus = (outcome: ExternalEventOutcome): number => {
  if (outcome.ok) return 200;
  return outcome.retryable ? 503 : 422;
};

// Vercel's Web Request handler exposes the untouched body stream. Reading it as
// an ArrayBuffer preserves the exact bytes Communications signed; reconstructing
// JSON from VercelRequest.body would change whitespace and invalidate the HMAC.
export const POST = async (request: Request): Promise<Response> => {
  const secret = process.env.COMMUNICATIONS_WEBHOOK_SECRET;
  if (!secret) return json({ error: 'COMMUNICATIONS_WEBHOOK_SECRET is not configured' }, 503);

  const rawBody = Buffer.from(await request.arrayBuffer());
  const signature = request.headers.get('x-communications-signature') || undefined;
  if (!verifyCommunicationsSignature(rawBody, signature, secret)) {
    return json({ error: 'Invalid or missing Communications signature' }, 401);
  }

  const storeStatus = serverStoreStatus();
  if (!storeStatus.ok) {
    console.error('External event inbox unavailable:', storeStatus.reason);
    return json({ error: 'Server-side persistence is not configured' }, 503);
  }

  try {
    const body = parseSignedJsonBody(rawBody);
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
    if (/required|JSON object|valid JSON/.test(error?.message || '')) return json({ error: error.message }, 400);
    console.error('External event handler failed', error);
    return json({ error: 'Handler failed' }, 500);
  }
};

export const GET = async (): Promise<Response> => json({ error: 'Method not allowed' }, 405);
