/**
 * GET  /api/phone-configs  — list all phone configs
 * POST /api/phone-configs  — create a new phone config
 *
 * Headers:
 *   x-api-key — must match API_SECRET_KEY env var
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/lib/supabase';
import { requireApiKey } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireApiKey(req, res)) return;

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('phone_configs')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ configs: data });
  }

  if (req.method === 'POST') {
    const {
      twilio_number,
      name,
      description,
      call_enabled,
      call_system_prompt,
      call_voice,
      call_greeting,
      sms_enabled,
      sms_system_prompt,
      enabled_tools,
      metadata,
    } = req.body ?? {};

    if (!twilio_number) return res.status(400).json({ error: '`twilio_number` is required' });
    if (!name) return res.status(400).json({ error: '`name` is required' });

    const { data, error } = await supabase
      .from('phone_configs')
      .insert({
        twilio_number,
        name,
        description,
        call_enabled: call_enabled ?? true,
        call_system_prompt,
        call_voice: call_voice ?? 'alloy',
        call_greeting,
        sms_enabled: sms_enabled ?? true,
        sms_system_prompt,
        enabled_tools: enabled_tools ?? [],
        metadata: metadata ?? {},
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json(data);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
