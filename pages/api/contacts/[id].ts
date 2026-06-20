/**
 * GET    /api/contacts/:id  — fetch contact + call history
 * PUT    /api/contacts/:id  — update contact fields
 * DELETE /api/contacts/:id  — delete contact
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/lib/supabase';
import { requireApiKey } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireApiKey(req, res)) return;

  const { id } = req.query as { id: string };

  /* ── GET ── */
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('contacts')
      .select('*, calls(id,direction,status,started_at,ended_at,duration_seconds)')
      .eq('id', id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Contact not found' });
    return res.status(200).json({ contact: data });
  }

  /* ── UPDATE ── */
  if (req.method === 'PUT') {
    const { phone_number, name, email, company, notes, tags, custom_data } = req.body ?? {};

    const { data, error } = await supabase
      .from('contacts')
      .update({ phone_number, name, email, company, notes, tags, custom_data })
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Contact not found' });
    return res.status(200).json({ contact: data });
  }

  /* ── DELETE ── */
  if (req.method === 'DELETE') {
    const { error } = await supabase.from('contacts').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
