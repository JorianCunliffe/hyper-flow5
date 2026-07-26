/**
 * GET /api/sms/threads
 *
 * List SMS threads with pagination.
 * Query params: page, limit, twilio_number, phone_number
 *
 * Headers:
 *   x-api-key — must match API_SECRET_KEY env var
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/lib/supabase';
import { requireApiKey } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireApiKey(req, res)) return;

  const page = Math.max(1, parseInt(String(req.query.page ?? '1')));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'))));
  const offset = (page - 1) * limit;

  let query = supabase
    .from('sms_threads')
    .select('*, contact:contacts(id,name,phone_number)', { count: 'exact' })
    .order('last_message_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (req.query.twilio_number) query = query.eq('twilio_number', req.query.twilio_number);
  if (req.query.phone_number) query = query.eq('phone_number', req.query.phone_number);

  const { data, count, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ threads: data, total: count, page, limit });
}
