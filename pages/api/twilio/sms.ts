/**
 * POST /api/twilio/sms
 *
 * Twilio webhook for inbound SMS messages.
 * Set this URL as the SMS webhook in the Twilio console for each number.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { handleIncomingSms } from '@/lib/sms-handler';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const from: string = req.body?.From || '';
  const to: string = req.body?.To || '';
  const body: string = req.body?.Body || '';
  const messageSid: string = req.body?.MessageSid || '';

  if (!from || !to || !body) {
    return res.status(400).end();
  }

  const reply = await handleIncomingSms({ from, to, body, messageSid });

  // If reply is empty (SMS disabled for this number), return empty TwiML
  const twiml = reply
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${reply}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;

  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml);
}
