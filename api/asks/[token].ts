import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readAskByToken, respondToAsk } from '../../lib/serverFlow.js';
import { deleteStoredAskAttachments, isServerStoreConfigured, resolveReviewerActor, storeAskUploads } from '../../lib/serverStore.js';
import { renderAskForm } from '../../lib/askForm.js';
import { ApiAuthError, bearerToken, requireAppMember } from '../../lib/apiAuth.js';

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
      if (String(req.headers.accept || '').includes('text/html')) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).send(renderAskForm({ ask, nodeName, projectName }));
      }
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
      const { decision, text, values, uploads } = req.body || {};
      if (typeof text === 'string' && text.length > MAX_TEXT) {
        return res.status(413).json({ error: 'Comment is too long' });
      }

      const found = await readAskByToken(orgId, projectId, token);
      if (!found) return res.status(404).json({ error: 'Not found' });
      const authenticated = bearerToken(req) ? await requireAppMember(req, orgId) : null;
      const allowedUploadFields = (found.ask.fields || []).filter(field => field.type === 'file').map(field => field.name);
      const attachments = Array.isArray(uploads) && uploads.length
        ? await storeAskUploads({ orgId, projectId, askId: found.ask.id, allowedFields: allowedUploadFields, uploads })
        : [];
      const verifiedActor = authenticated
        ? await resolveReviewerActor(orgId, authenticated.email, authenticated.uid)
        : null;
      const outcome = await respondToAsk({
        orgId,
        projectId,
        askToken: token,
        channel: 'web',
        response: {
          actor: verifiedActor || 'via link',
          decision,
          text,
          structured: values,
          attachments
        },
        actorVerified: Boolean(authenticated)
      });
      if (!outcome.ok) {
        await deleteStoredAskAttachments(attachments);
        const status = outcome.reason === 'already_answered' ? 409
          : outcome.reason === 'ask_not_found' || outcome.reason === 'project_not_found' ? 404
          : 400;
        return res.status(status).json({ error: outcome.reason });
      }

      return res.status(200).json({
        ok: true,
        askStatus: outcome.askStatus,
        log: outcome.log,
        needsInterpretation: outcome.response?.needsInterpretation ?? false
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e: any) {
    console.error('Ask endpoint failed', e);
    return res.status(e instanceof ApiAuthError ? e.status : 500).json({ error: e instanceof ApiAuthError ? e.message : 'Request failed' });
  }
}
