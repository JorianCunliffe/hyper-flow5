import type { VercelRequest, VercelResponse } from '@vercel/node';
import { resolveCallbackAndAdvance } from '../../../lib/serverFlow.js';
import { claimWebhookEvent, releaseWebhookEvent, serverStoreStatus } from '../../../lib/serverStore.js';
import { normalizeBlandCallback } from '../../../lib/inboundVoice.js';

/**
 * Bland AI call-completion webhook.
 *
 * This replaces the browser-side setTimeout poll: the call result now lands here
 * regardless of whether anyone has the app open, resolves the pending action run,
 * and advances the flow so downstream decisions branch on what the human said.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const expected = process.env.WEBHOOK_SECRET;
  if (expected) {
    const provided = typeof req.query.secret === 'string' ? req.query.secret : '';
    // Length-independent compare is unnecessary here (the secret is in the URL the
    // provider echoes back), but reject early and without detail either way.
    if (provided !== expected) return res.status(403).json({ error: 'Forbidden' });
  }

  const storeStatus = serverStoreStatus();
  if (!storeStatus.ok) {
    // 200 so the provider does not retry a request that can never succeed, but
    // log the specific misconfiguration rather than a generic "not configured".
    console.error('Bland webhook rejected — server store unusable:', storeStatus.reason);
    return res.status(200).json({ ok: false, reason: 'server_store_not_configured', detail: storeStatus.reason });
  }

  const event = normalizeBlandCallback(req.body);
  if (!event.eventId) return res.status(400).json({ error: 'Missing call_id' });
  if (!event.orgId || !event.projectId) {
    console.error('Bland webhook missing correlation metadata', { callId: event.eventId });
    return res.status(200).json({ ok: false, reason: 'missing_correlation' });
  }

  // Bland retries on non-2xx and on timeout. Replaying an advance can re-run
  // actions and reset loop bodies, so claim the event before doing any work.
  const claimed = await claimWebhookEvent('bland', event.eventId);
  if (!claimed) return res.status(200).json({ ok: true, duplicate: true });

  try {
    const outcome = await resolveCallbackAndAdvance(
      event.orgId,
      event.projectId,
      { runId: event.runId, externalId: event.eventId },
      {
        status: event.status,
        output: event.output,
        logs: event.logs,
        error: event.error,
        resolvedBy: 'webhook:bland'
      }
    );

    if (!outcome.ok) {
      // Nothing to resolve (already handled, or the run vanished). Keep the claim
      // so retries stay idempotent, and don't ask the provider to try again.
      console.warn('Bland webhook could not be applied', { callId: event.eventId, reason: outcome.reason });
      return res.status(200).json({ ok: false, reason: outcome.reason });
    }

    return res.status(200).json({ ok: true, log: outcome.log, pending: outcome.pending });
  } catch (e: any) {
    // Release so the provider's retry can have another go at a transient failure.
    await releaseWebhookEvent('bland', event.eventId);
    console.error('Bland webhook handler failed', e);
    return res.status(500).json({ error: 'Handler failed' });
  }
}
