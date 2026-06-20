/**
 * POST /api/calls/outbound
 *
 * Initiates an outbound call via Twilio.  Creates a call record in the DB
 * immediately so the stream handler can find it by callSid once answered.
 *
 * Body:
 *   to           string  — E.164 phone number to dial (required)
 *   systemPrompt string  — Custom AI instructions (optional)
 *   metadata     object  — Arbitrary data stored on the call record (optional)
 *
 * Headers:
 *   x-api-key  — must match API_SECRET_KEY env var
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import twilio from 'twilio';
import { supabase } from '@/lib/supabase';
import { requireApiKey } from '@/lib/auth';
import { buildContextForNumber, buildSystemPrompt } from '@/lib/prompts';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireApiKey(req, res)) return;

  const { to, systemPrompt: customPrompt, metadata } = req.body ?? {};
  if (!to) return res.status(400).json({ error: '`to` phone number is required' });

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    return res.status(500).json({ error: 'Twilio env vars not configured' });
  }

  const baseUrl = process.env.BASE_URL || `https://${req.headers.host}`;

  // Look up contact and build system prompt
  const { contact, contextBlock } = await buildContextForNumber(to);
  const resolvedPrompt = buildSystemPrompt('outbound', contextBlock, customPrompt);

  const client = twilio(accountSid, authToken);

  let call;
  try {
    call = await client.calls.create({
      to,
      from: fromNumber,
      url: `${baseUrl}/api/twilio/outbound-twiml`,
      method: 'POST',
      statusCallback: `${baseUrl}/api/twilio/status`,
      statusCallbackMethod: 'POST',
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[outbound] Twilio error:', message);
    return res.status(502).json({ error: message });
  }

  // Create the call record *before* the stream handler needs it
  const { data: callRecord, error: dbError } = await supabase
    .from('calls')
    .insert({
      twilio_call_sid: call.sid,
      phone_number: to,
      direction: 'outbound',
      status: call.status,
      contact_id: contact?.id ?? null,
      system_prompt: resolvedPrompt,
      metadata: metadata ?? {},
    })
    .select('id')
    .single();

  if (dbError) console.error('[outbound] DB insert error:', dbError.message);

  return res.status(200).json({
    success: true,
    callSid: call.sid,
    callId: callRecord?.id ?? null,
    status: call.status,
  });
}
