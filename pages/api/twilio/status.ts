/**
 * POST /api/twilio/status
 *
 * Twilio status callback — updates the call record with final status/duration.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/lib/supabase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { CallSid, CallStatus, CallDuration } = req.body ?? {};

  if (CallSid) {
    const terminal = ['completed', 'failed', 'busy', 'no-answer', 'canceled'];
    await supabase
      .from('calls')
      .update({
        status: CallStatus,
        duration_seconds: CallDuration ? parseInt(CallDuration, 10) : null,
        ...(terminal.includes(CallStatus) ? { ended_at: new Date().toISOString() } : {}),
      })
      .eq('twilio_call_sid', CallSid);
  }

  res.status(204).end();
}
