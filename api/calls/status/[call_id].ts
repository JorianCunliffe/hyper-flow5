import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (!process.env.BLAND_API_KEY) throw new Error('BLAND_API_KEY environment variable is required');
    const callId = req.query.call_id as string;
    const response = await fetch(`https://api.bland.ai/v1/calls/${callId}`, {
      method: 'GET',
      headers: {
        'Authorization': process.env.BLAND_API_KEY
      }
    });
    const data = await response.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
