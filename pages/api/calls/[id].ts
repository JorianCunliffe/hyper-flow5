/**
 * GET /api/calls/:id
 *
 * Fetch a single call record including full transcript.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/lib/supabase';
import { requireApiKey } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireApiKey(req, res)) return;

  const { id } = req.query as { id: string };

  const { data, error } = await supabase
    .from('calls')
    .select('*, contact:contacts(*)')
    .eq('id', id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Call not found' });

  return res.status(200).json({ call: data });
}
