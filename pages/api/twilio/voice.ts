/**
 * POST /api/twilio/voice
 *
 * Twilio webhook for incoming calls.  Initialises the WebSocket server on
 * the same Node.js process so it is ready when Twilio immediately opens the
 * Media Stream connection immediately after receiving this TwiML response.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { initWss } from '@/lib/ws-server';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  // Initialise the WebSocket server on the underlying HTTP server of this process.
  // Twilio will open the Media Stream WebSocket right after this response, so this
  // must happen before that upgrade request arrives.
  const server = (res.socket as any)?.server;
  if (server) initWss(server);

  const from: string = req.body?.From || req.body?.from || '';
  const callSid: string = req.body?.CallSid || req.body?.callSid || '';

  const baseUrl = process.env.BASE_URL || `https://${req.headers.host}`;
  const wsHost = new URL(baseUrl).host;
  const streamUrl = `wss://${wsHost}/api/twilio/stream`;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}">
      <Parameter name="phoneNumber" value="${from}"/>
      <Parameter name="direction" value="inbound"/>
      <Parameter name="callSid" value="${callSid}"/>
    </Stream>
  </Connect>
</Response>`;

  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml);
}
