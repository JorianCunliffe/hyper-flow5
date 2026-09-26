import { requireProjectInTenant } from '../apiAuth.js';
import { readFlowRun } from '../flowRunStore.js';
import { CaptureError, text, unresolved } from './model.js';
import { captureWorkItem, listCaptures, mutateCapture, readCapture } from './store.js';
export const capturedWorkDependencies = { requireProjectInTenant, readFlowRun, captureWorkItem, listCaptures, mutateCapture, readCapture };
export async function handleCapturedWork(req: { method?: string; query?: any; body?: any }, member: { orgId: string; uid: string }, deps = capturedWorkDependencies) {
  const body = req.body || {};
  const query = req.query || {};
  // Identity always comes from authentication; no caller-supplied tenant or owner.
  if (req.method === 'GET') {
    if (query.id) {
      const item = await deps.readCapture(member.orgId, member.uid, text(query.id, 'id', 200));
      if (!item) throw new CaptureError(404, 'Captured item not found');
      return { item };
    }
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 100));
    const items = (await deps.listCaptures(member.orgId, member.uid)).filter(item =>
      (!query.status || query.status === 'all' || (query.status === 'unresolved' ? unresolved(item) : item.status === query.status)) &&
      (!query.sourceRunId || item.sourceRunId === query.sourceRunId));
    items.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    const start = query.after ? items.findIndex(item => item.id === query.after) + 1 : 0;
    if (query.after && start === 0) throw new CaptureError(409, 'The list changed; refresh before loading more');
    const page = items.slice(start, start + limit);
    return { items: page, total: items.length, nextCursor: start + page.length < items.length ? page.at(-1)?.id : null };
  }
  if (!['POST', 'PATCH'].includes(req.method || '')) throw new CaptureError(405, 'Method not allowed');
  for (const projectId of [body.sourceProjectId, body.proposedProjectId, body.intent?.projectId]) if (projectId) await deps.requireProjectInTenant(member.orgId, projectId);
  if (req.method === 'POST' && (!body.operation || body.operation === 'capture')) {
    if (body.sourceRunId || body.sourceNodeId) {
      if (!body.sourceProjectId || !body.sourceRunId) throw new CaptureError(422, 'Source node/run requires a source project and run');
      const run = await deps.readFlowRun(member.orgId, body.sourceProjectId, body.sourceRunId);
      if (!run || (body.sourceNodeId && !run.state.milestones.some(node => node.id === body.sourceNodeId))) throw new CaptureError(403, 'Source run/node is outside this project');
    }
    return { item: await deps.captureWorkItem(member.orgId, member.uid, body), acknowledgement: 'Captured. We can review that later.' };
  }
  return { item: await deps.mutateCapture(member.orgId, member.uid, text(body.id, 'id', 200), req.method === 'PATCH' ? 'update' : body.operation, body) };
}
