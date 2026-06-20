import type { NextApiRequest, NextApiResponse } from 'next';

export function requireApiKey(req: NextApiRequest, res: NextApiResponse): boolean {
  const secret = process.env.API_SECRET_KEY;
  if (!secret) return true; // not configured — allow in dev

  const provided = req.headers['x-api-key'];
  if (!provided || provided !== secret) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}
