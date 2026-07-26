/**
 * GET /api/sms/threads/:id
 *
 * Get a single SMS thread with its messages.
 * Query params: limit (messages), before (ISO timestamp cursor)
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

  const { id } = req.query;
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Missing id' });

  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '50'))));

  const [{ data: thread, error: threadErr }, { data: messages, error: msgErr }] =
    await Promise.all([
      supabase
        .from('sms_threads')
        .select('*, contact:contacts(*)')
        .eq('id', id)
        .single(),
      supabase
        .from('sms_messages')
        .select('*')
        .eq('thread_id', id)
        .order('created_at', { ascending: true })
        .limit(limit),
    ]);

  if (threadErr) return res.status(404).json({ error: 'Thread not found' });
  if (msgErr) return res.status(500).json({ error: msgErr.message });

  return res.status(200).json({ thread, messages });
}
