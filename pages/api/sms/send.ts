/**
 * POST /api/sms/send
 *
 * Send an outbound SMS directly via Twilio REST.
 *
 * Body:
 *   to           string — recipient E.164 number (required)
 *   from         string — your Twilio number (required unless phone_config_id given)
 *   message      string — SMS body (required)
 *   phone_config_id string — use this config's twilio_number as from (optional)
 *
 * Headers:
 *   x-api-key — must match API_SECRET_KEY env var
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import twilio from 'twilio';
import { supabase } from '@/lib/supabase';
import { requireApiKey } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireApiKey(req, res)) return;

  const { to, from: fromParam, message, phone_config_id } = req.body ?? {};
  if (!to) return res.status(400).json({ error: '`to` is required' });
  if (!message) return res.status(400).json({ error: '`message` is required' });

  let fromNumber = fromParam || process.env.TWILIO_PHONE_NUMBER;

  if (phone_config_id) {
    const { data: cfg } = await supabase
      .from('phone_configs')
      .select('twilio_number, sms_enabled')
      .eq('id', phone_config_id)
      .single();
    if (cfg) {
      if (!cfg.sms_enabled) return res.status(403).json({ error: 'SMS disabled for this config' });
      fromNumber = cfg.twilio_number;
    }
  }

  if (!fromNumber) return res.status(400).json({ error: '`from` number is required' });

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    return res.status(500).json({ error: 'Twilio env vars not configured' });
  }

  try {
    const client = twilio(accountSid, authToken);
    const msg = await client.messages.create({ to, from: fromNumber, body: message });

    // Persist to DB if we can find the thread
    const { data: thread } = await supabase
      .from('sms_threads')
      .select('id')
      .eq('phone_number', to)
      .eq('twilio_number', fromNumber)
      .single();

    if (thread) {
      await Promise.all([
        supabase.from('sms_messages').insert({
          thread_id: thread.id,
          twilio_message_sid: msg.sid,
          direction: 'outbound',
          role: 'assistant',
          content: message,
          status: 'sent',
        }),
        supabase
          .from('sms_threads')
          .update({ last_message_at: new Date().toISOString() })
          .eq('id', thread.id),
      ]);
    }

    return res.status(200).json({ success: true, messageSid: msg.sid });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: msg });
  }
}
