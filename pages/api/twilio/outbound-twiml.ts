/**
 * POST /api/twilio/outbound-twiml
 *
 * Twilio calls this URL when an outbound call is answered.
 * Returns TwiML that connects the call to our Media Stream WebSocket.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { initWss } from '@/lib/ws-server';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const server = (res.socket as any)?.server;
  if (server) initWss(server);

  // Twilio provides these in the POST body when the callee answers
  const to: string = req.body?.To || '';
  const callSid: string = req.body?.CallSid || '';

  const baseUrl = process.env.BASE_URL || `https://${req.headers.host}`;
  const wsHost = new URL(baseUrl).host;
  const streamUrl = `wss://${wsHost}/api/twilio/stream`;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}">
      <Parameter name="phoneNumber" value="${to}"/>
      <Parameter name="direction" value="outbound"/>
      <Parameter name="callSid" value="${callSid}"/>
    </Stream>
  </Connect>
</Response>`;

  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml);
}
