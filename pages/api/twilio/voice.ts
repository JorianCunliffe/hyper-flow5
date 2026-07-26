/**
 * POST /api/twilio/voice
 *
 * Twilio webhook for incoming calls.  Looks up the phone_config for the
 * dialled Twilio number, rejects if call_enabled is false, then returns
 * TwiML that connects the call to our Media Stream WebSocket — passing the
 * config id and relevant numbers as custom parameters.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { initWss } from '@/lib/ws-server';
import { supabase } from '@/lib/supabase';
import type { PhoneConfig } from '@/types';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  const server = (res.socket as any)?.server;
  if (server) initWss(server);

  const from: string = req.body?.From || '';
  const to: string = req.body?.To || '';
  const callSid: string = req.body?.CallSid || '';

  // Look up phone config for our Twilio number
  const { data: config } = (await supabase
    .from('phone_configs')
    .select('id, call_enabled')
    .eq('twilio_number', to)
    .single()) as { data: Pick<PhoneConfig, 'id' | 'call_enabled'> | null };

  if (config && !config.call_enabled) {
    // Reject — calls disabled for this number
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>`;
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send(twiml);
  }

  const baseUrl = process.env.BASE_URL || `https://${req.headers.host}`;
  const wsHost = new URL(baseUrl).host;
  const streamUrl = `wss://${wsHost}/api/twilio/stream`;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}">
      <Parameter name="phoneNumber" value="${from}"/>
      <Parameter name="twilioNumber" value="${to}"/>
      <Parameter name="direction" value="inbound"/>
      <Parameter name="callSid" value="${callSid}"/>
      <Parameter name="phoneConfigId" value="${config?.id ?? ''}"/>
    </Stream>
  </Connect>
</Response>`;

  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml);
}
