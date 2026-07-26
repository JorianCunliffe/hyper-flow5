/**
 * GET    /api/phone-configs/:id  — get a phone config
 * PUT    /api/phone-configs/:id  — update a phone config
 * DELETE /api/phone-configs/:id  — delete a phone config
 *
 * Headers:
 *   x-api-key — must match API_SECRET_KEY env var
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/lib/supabase';
import { requireApiKey } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireApiKey(req, res)) return;

  const { id } = req.query;
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Missing id' });

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('phone_configs')
      .select('*')
      .eq('id', id)
      .single();
    if (error) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json(data);
  }

  if (req.method === 'PUT') {
    const allowed = [
      'name', 'description',
      'call_enabled', 'call_system_prompt', 'call_voice', 'call_greeting',
      'sms_enabled', 'sms_system_prompt',
      'enabled_tools', 'metadata',
    ];
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const key of allowed) {
      if (key in (req.body ?? {})) updates[key] = req.body[key];
    }

    const { data, error } = await supabase
      .from('phone_configs')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === 'DELETE') {
    const { error } = await supabase.from('phone_configs').delete().eq('id', id);
    if (error) return res.status(400).json({ error: error.message });
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
