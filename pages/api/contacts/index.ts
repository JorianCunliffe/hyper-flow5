/**
 * GET  /api/contacts   — list contacts (paginated, optional search)
 * POST /api/contacts   — create a contact
 *
 * Query params (GET):
 *   page    number (default 1)
 *   limit   number (default 20, max 100)
 *   search  string — fuzzy match on name, phone, email
 *
 * Body (POST):
 *   phone_number  string  (required, E.164)
 *   name          string
 *   email         string
 *   company       string
 *   notes         string
 *   tags          string[]
 *   custom_data   object
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/lib/supabase';
import { requireApiKey } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireApiKey(req, res)) return;

  /* ── LIST ── */
  if (req.method === 'GET') {
    const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '20', 10)));
    const offset = (page - 1) * limit;
    const search = (req.query.search as string) || '';

    let query = supabase
      .from('contacts')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (search) {
      query = query.or(
        `name.ilike.%${search}%,phone_number.ilike.%${search}%,email.ilike.%${search}%,company.ilike.%${search}%`,
      );
    }

    const { data, error, count } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ contacts: data, total: count, page, limit });
  }

  /* ── CREATE ── */
  if (req.method === 'POST') {
    const { phone_number, name, email, company, notes, tags, custom_data } = req.body ?? {};

    if (!phone_number) return res.status(400).json({ error: '`phone_number` is required' });

    const { data, error } = await supabase
      .from('contacts')
      .insert({ phone_number, name, email, company, notes, tags, custom_data })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'A contact with that phone number already exists' });
      }
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json({ contact: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
