/**
 * GET /api/calls
 *
 * List call history with optional filters.
 *
 * Query params:
 *   page       number  (default 1)
 *   limit      number  (default 20, max 100)
 *   direction  inbound | outbound
 *   status     string
 *   contact_id uuid
 *
 * Headers:
 *   x-api-key
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/lib/supabase';
import { requireApiKey } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireApiKey(req, res)) return;

  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '20', 10)));
  const offset = (page - 1) * limit;

  let query = supabase
    .from('calls')
    .select('*, contact:contacts(id,name,phone_number,email,company)', { count: 'exact' })
    .order('started_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (req.query.direction) query = query.eq('direction', req.query.direction as string);
  if (req.query.status) query = query.eq('status', req.query.status as string);
  if (req.query.contact_id) query = query.eq('contact_id', req.query.contact_id as string);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ calls: data, total: count, page, limit });
}
