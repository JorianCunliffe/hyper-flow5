import type { VercelRequest, VercelResponse } from '@vercel/node';
import { buildResponse, validateResponse } from '../../lib/askResponses.js';
import { readAskByToken, respondToAsk } from '../../lib/serverFlow.js';
import { isServerStoreConfigured } from '../../lib/serverStore.js';

/**
 * Read or answer a single ask, authorised by its token.
 *
 * The token is a capability scoped to this one ask: it never authenticates a
 * session and never grants access to the surrounding project. orgId and
 * projectId are routing hints — we mint every link ourselves, so we always know
 * them, and knowing them without the token grants nothing.
 */

const MAX_TEXT = 20_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isServerStoreConfigured()) {
    return res.status(503).json({ error: 'Server-side persistence is not configured' });
  }

  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const orgId = typeof req.query.org === 'string' ? req.query.org : '';
  const projectId = typeof req.query.project === 'string' ? req.query.project : '';

  if (!token || !orgId || !projectId) {
    return res.status(400).json({ error: 'token, org and project are required' });
  }

  try {
    if (req.method === 'GET') {
      const found = await readAskByToken(orgId, projectId, token);
      // Same response for a bad token and a missing ask — do not confirm which.
      if (!found) return res.status(404).json({ error: 'Not found' });

      const { ask, nodeName, projectName } = found;
      return res.status(200).json({
        projectName,
        nodeName,
        ask: {
          id: ask.id,
          kind: ask.kind,
          status: ask.status,
          prompt: ask.prompt,
          fields: ask.fields,
          artifact: ask.artifact,
          createdAt: ask.createdAt,
          dueAt: ask.dueAt,
          // Responses are echoed without their raw provider payloads.
          responses: ask.responses.map(r => ({
            at: r.at,
            via: r.via,
            actor: r.actor,
            decision: r.decision,
            text: r.text,
            attachments: r.attachments,
            needsInterpretation: r.needsInterpretation
          }))
        }
      });
    }

    if (req.method === 'POST') {
      const found = await readAskByToken(orgId, projectId, token);
      if (!found) return res.status(404).json({ error: 'Not found' });

      const { decision, text, values, attachments, actor } = req.body || {};
      if (typeof text === 'string' && text.length > MAX_TEXT) {
        return res.status(413).json({ error: 'Comment is too long' });
      }

      const response = buildResponse(found.ask, {
        via: 'web',
        // Holding the token is the authorisation; the display name is not trusted
        // as identity, so it is recorded as claimed rather than verified.
        actor: typeof actor === 'string' && actor.trim() ? actor.trim() : 'via link',
        decision,
        text,
        values,
        attachments
      });

      const invalid = validateResponse(found.ask, response);
      if (invalid) return res.status(400).json({ error: invalid });

      const outcome = await respondToAsk(orgId, projectId, token, response);
      if (!outcome.ok) {
        const status = outcome.reason === 'already_answered' ? 409 : 404;
        return res.status(status).json({ error: outcome.reason });
      }

      return res.status(200).json({
        ok: true,
        askStatus: outcome.askStatus,
        log: outcome.log,
        needsInterpretation: response.needsInterpretation ?? false
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e: any) {
    console.error('Ask endpoint failed', e);
    return res.status(500).json({ error: 'Request failed' });
  }
}
