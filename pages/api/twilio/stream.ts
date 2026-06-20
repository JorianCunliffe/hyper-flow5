/**
 * GET /api/twilio/stream  (WebSocket upgrade endpoint)
 *
 * Twilio opens a Media Streams WebSocket to this URL.  The actual upgrade is
 * handled by the `upgrade` event listener attached to the underlying Node.js
 * HTTP server in `lib/ws-server.ts`.  This HTTP handler exists to:
 *   1. Initialise the WebSocket server on first request.
 *   2. Provide a health-check response for regular HTTP GETs.
 *
 * Vercel config: maxDuration = 300 (5 min) keeps the instance alive.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { initWss } from '@/lib/ws-server';

export const config = { api: { bodyParser: false } };

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const server = (res.socket as any)?.server;
  if (server) initWss(server);

  res.status(200).json({ status: 'WebSocket server ready', path: '/api/twilio/stream' });
}
