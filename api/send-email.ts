import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';
import { ApiAuthError, requireAppMember } from '../lib/apiAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    await requireAppMember(req);
    const { to, subject, html } = req.body || {};
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY environment variable is required');
    }
    const resendClient = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await resendClient.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'HyperFlow <automation@projectflow.online>',
      to,
      subject,
      html
    });

    if (error) {
      return res.status(400).json({ error });
    }

    res.status(200).json({ data });
  } catch (error: any) {
    console.error(error);
    res.status(error instanceof ApiAuthError ? error.status : 500).json({ error: error?.message || String(error) });
  }
}
