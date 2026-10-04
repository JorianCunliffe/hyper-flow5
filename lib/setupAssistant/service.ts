import { randomUUID } from 'node:crypto';
import { planConfiguration, hash } from '../configuration/model.js';
import { renderActionTemplate } from '../flowData.js';
import { reservedDataKey } from '../configuration/schema.js';
import { normalizeWorkspaceNamedResources } from '../workspaceResourceCatalog.js';
import { sessionStore } from './store.js';
import { setupConversation } from './provider.js';
import { readTools, type SetupApi } from './adapter.js';
import { fail, noSecrets, redact, safeError, scopedChanges, scopedExtras } from './safety.js';
import type { SetupScope, SetupSession, SetupReply, SetupProposal } from './types.js';

export const setupEnabled = (orgId: string) => process.env.SETUP_ASSISTANT_ENABLED === 'true' && (!process.env.SETUP_ASSISTANT_ORG_IDS || process.env.SETUP_ASSISTANT_ORG_IDS.split(',').map(x => x.trim()).includes(orgId));
type Member = { orgId: string; uid: string; role: string; apiClientId?: string };
export const setupDependencies = { store: sessionStore, conversation: setupConversation, enabled: setupEnabled, now: Date.now };
const projection = (s: SetupSession) => redact(s);
const scopeId = (id: any) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
const commands = ['turn', 'prepare', 'expand_scope', 'apply', 'simulate', 'review_live', 'approve_live', 'review_activation', 'approve_activation', 'inspect'];

async function bindingIssues(session: SetupSession, project: any, current: any, api: SetupApi) {
  const integrations = await api('GET', '/api/integrations');
  const known = new Set<string>([session.actor, ...(current.settings?.people || [])]);
  for (const row of [...(integrations.people || []), ...(integrations.mailboxes || []), ...(integrations.workspaces || [])]) {
    for (const field of ['id', 'personId', 'connectionId', 'name', 'phone', 'email', 'mailboxAddress']) if (typeof row[field] === 'string') known.add(row[field]);
  }
  const previous = current.projects.find((p: any) => p.id === session.scope.projectId);
  for (const value of Object.values(previous?.projectData || {})) if (typeof value === 'string') known.add(value);
  const humanText = session.messages.filter(m => m.role === 'user').map(m => m.text).join('\n');
  const declared = (value: string) => known.has(value) || (value.length >= 5 && humanText.includes(value));
  const issues: string[] = [];
  for (const n of project.milestones || []) {
    const human = n.holdConfig?.human;
    for (const id of [...(human?.assignees || []), human?.escalation?.primaryPersonId, human?.escalation?.fallbackPersonId].filter(Boolean)) if (!declared(id)) issues.push(`${n.name}: choose the existing person ${id} through the resource picker.`);
    let template: any = {};
    try { template = JSON.parse(n.actionConfig?.template || '{}'); } catch { continue; }
    for (const field of ['person_id', 'connection_id']) {
      let value = template[field];
      if (typeof value !== 'string') continue;
      try { value = renderActionTemplate(JSON.stringify({ value }), project.projectData || {}).templateData.value; } catch { continue; }
      if (typeof value === 'string' && !declared(value)) issues.push(`${n.name}: select an existing ${field.replace('_', ' ')} instead of guessing its identifier.`);
    }
    if (['phone_call', 'sms', 'email'].includes(n.nodeType)) {
      let to = template.to;
      try { to = renderActionTemplate(JSON.stringify({ to }), project.projectData || {}).templateData.to; } catch { continue; }
      for (const recipient of (Array.isArray(to) ? to : [to]).filter(x => typeof x === 'string')) if (!declared(recipient)) issues.push(`${n.name}: select or explicitly supply recipient ${recipient}.`);
    }
  }
  return [...new Set(issues)];
}

export async function prepareProposal(session: SetupSession, draft: NonNullable<SetupReply['proposal']>, api: SetupApi): Promise<SetupProposal> {
  scopedChanges(session.scope, draft.changes); scopedExtras(session.scope, draft.extras);
  noSecrets({ fixtures: draft.fixtures || {}, assertions: draft.assertions || [], inputs: draft.inputs || {} });
  if (Object.keys(draft.inputs || {}).some(k => reservedDataKey(k) || /policy|grant|allowed|budget|permission|authority|enabled/i.test(k))) fail(422, 'Test inputs cannot override runtime or authority fields.');
  const [configuration, scheduleList] = await Promise.all([api('GET', '/api/configuration'), api('GET', '/api/schedules')]);
  const expectedRevision = configuration.revision;
  const plan = await api('POST', '/api/configuration', { operation: 'plan', expectedRevision, changes: draft.changes });
  const validation = await api('POST', '/api/configuration', { operation: 'validate', expectedRevision, changes: draft.changes });
  const proposed = planConfiguration({ ...configuration, dataRevision: expectedRevision }, { expectedRevision, changes: draft.changes });
  const project = proposed.next.projects.find((p: any) => p.id === session.scope.projectId);
  if (!project) fail(422, 'A setup proposal must preserve or create its workflow. Workflow deletion belongs in the existing editor.');
  const bindings = await bindingIssues(session, project, configuration, api);
  const extras = structuredClone(draft.extras || {});
  let resourcesBefore: any[] | undefined;
  if (extras.resources) {
    extras.resources = normalizeWorkspaceNamedResources(extras.resources);
    resourcesBefore = session.scope.kind === 'new' ? [] : (await api('GET', '/api/workspace/resources', undefined, { projectId: session.scope.projectId })).resources;
  }
  // Stable schedule IDs bind all retries to this proposal, never Date.now().
  extras.schedules = (extras.schedules || []).map((s: any, i: number) => ({ ...s, id: s.id || `setup_schedule_${hash({ session: session.id, s, i }).slice(0, 24)}`, enabled: false }));
  const allSchedules = (scheduleList.data || []).filter((s: any) => s.projectId === session.scope.projectId);
  for (const schedule of extras.schedules) {
    const existing = (scheduleList.data || []).find((s: any) => s.id === schedule.id);
    if (existing && existing.projectId !== session.scope.projectId) fail(403, 'Schedule belongs to a different workflow.');
    if (!schedule.timezone || !schedule.recurrence) fail(422, 'Schedule timezone and recurrence are required.');
  }
  const review = { expectedRevision, changes: draft.changes, extras, ...(resourcesBefore ? { resourcesBefore } : {}), pauseSchedules: allSchedules.filter((s: any) => s.enabled), planHash: plan.planHash };
  return {
    ...review, id: `proposal_${hash(review).slice(0, 24)}`, reviewHash: hash(review), valid: Boolean(plan.valid && validation.valid),
    diff: plan.diff, effects: plan.effects, preflight: { ...validation.preflight, ready: !!validation.valid && !!validation.preflight?.ready && !bindings.length, bindingIssues: bindings, structuralIssues: validation.issues || [] },
    preview: redact(project), before: redact(configuration.projects.find((p: any) => p.id === session.scope.projectId) || null),
    ...(draft.fixtures ? { fixtures: draft.fixtures } : {}), ...(draft.assertions ? { assertions: draft.assertions } : {}), ...(draft.inputs ? { inputs: draft.inputs } : {}), operations: {},
  };
}

export function effectPreview(project: any, input: any = {}) {
  const data = { ...project.projectData, ...input };
  return (project.milestones || []).flatMap((n: any) => {
    if (n.actionConfig) {
      let rendered: any;
      try { rendered = renderActionTemplate(n.actionConfig.template || '{}', data).templateData; }
      catch { rendered = { unresolved: true, template: n.actionConfig.template }; }
      return [{ nodeId: n.id, type: n.nodeType, inputs: redact(rendered), autoExecute: !!n.actionConfig.autoExecute, policy: redact(data.email_send_policy || 'existing capability policy') }];
    }
    const human = n.holdConfig?.human;
    return human ? [{ nodeId: n.id, type: 'human_ask', recipients: human.assignees || [], channels: human.channels || ['web'], prompt: human.prompt, escalation: human.escalation || null }] : [];
  });
}

async function configuration(api: SetupApi, projectId: string) {
  const c = await api('GET', '/api/configuration');
  const project = c.projects.find((p: any) => p.id === projectId);
  if (!project) fail(404, 'Workflow not found.');
  return { ...c, project };
}
async function noActiveRun(api: SetupApi, session: SetupSession) {
  const c = await api('GET', '/api/configuration');
  if (!c.projects.some((p: any) => p.id === session.scope.projectId)) return;
  const history = await api('GET', '/api/flow/advance', undefined, { orgId: session.orgId, projectId: session.scope.projectId, limit: 100, includeActive: 'true' });
  if (history.hasActiveRuns || (history.runs || []).some((r: any) => ['running', 'waiting'].includes(r.status))) fail(409, 'This workflow has an active execution. Finish or cancel it through the existing run controls before editing or starting a new test.');
}

export async function handleSetup(req: { method?: string; query?: any; body?: any }, member: Member, api: SetupApi, deps = setupDependencies) {
  if (member.apiClientId) fail(403, 'Setup sessions and approvals require a human session.');
  const enabled = deps.enabled(member.orgId);
  if (req.method === 'GET' && req.query?.view === 'availability') return { enabled };
  if (!enabled) fail(403, 'The setup assistant is disabled for this organization.');
  const body = req.body || {}, id = String(req.query?.id || body.id || '');
  if (Buffer.byteLength(JSON.stringify(body)) > 500000) fail(413, 'Setup request exceeds 500 KB.');
  if (req.method === 'GET') {
    if (!id) return { items: (await deps.store.list(member.orgId, member.uid)).sort((a, b) => b.updatedAt - a.updatedAt).map(s => ({ id: s.id, scope: s.scope, updatedAt: s.updatedAt, revision: s.revision, applied: !!s.proposal?.applied })) };
    const s = await deps.store.get(member.orgId, member.uid, id);
    if (!s || s.actor !== member.uid || s.orgId !== member.orgId) fail(404, 'Setup session not found.');
    return { session: projection(s) };
  }
  if (req.method === 'DELETE') {
    const s = await deps.store.get(member.orgId, member.uid, id);
    if (!s) fail(404, 'Setup session not found.');
    if (s.lease && s.lease.until > deps.now()) fail(409, 'A setup operation is still running.');
    await deps.store.remove(member.orgId, member.uid, id); return { deleted: true };
  }
  if (req.method !== 'POST') fail(405, 'Method not allowed.');
  if (!id) {
    const scope: SetupScope = body.scope?.kind === 'new' ? { kind: 'new', projectId: `workflow_${randomUUID().replace(/-/g, '')}` } : { kind: body.scope?.kind, projectId: body.scope?.projectId, ...(body.scope?.kind === 'element' ? { nodeId: body.scope?.nodeId } : {}) };
    if (!scope || !['new', 'workflow', 'element'].includes(scope.kind) || !scopeId(scope.projectId) || (scope.kind === 'element' && !scopeId(scope.nodeId))) fail(422, 'Select a new workflow, existing workflow or element.');
    if (scope.kind !== 'new') {
      const c = await configuration(api, scope.projectId);
      if (scope.kind === 'element' && !(c.project.milestones || []).some((n: any) => n.id === scope.nodeId)) fail(404, 'Element not found.');
    }
    const session: SetupSession = { id: deps.store.id(), orgId: member.orgId, actor: member.uid, scope, revision: 0, createdAt: deps.now(), updatedAt: deps.now(), messages: [{ role: 'assistant', text: scope.kind === 'new' ? 'What should this workflow accomplish?' : 'What would you like to change?' }], requests: {} };
    await deps.store.create(session); return { session: projection(session) };
  }
  const operation = String(body.operation || '');
  if (!commands.includes(operation)) fail(422, 'Unknown setup command.');
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(body.requestId || '')) fail(422, 'Stable requestId required.');
  const fingerprint = hash(body), leaseId = randomUUID(); let duplicate = false;
  let session = await deps.store.update(member.orgId, member.uid, id, s => {
    if (s.actor !== member.uid || s.orgId !== member.orgId) fail(404, 'Setup session not found.');
    const prior = s.requests[body.requestId];
    if (prior && prior.fingerprint !== fingerprint) fail(409, 'Setup request identity conflict.');
    if (prior?.status === 'completed') { duplicate = true; return s; }
    if (s.lease && s.lease.until > deps.now()) fail(409, 'A setup command is still running. Reload its status.');
    if (s.revision !== body.expectedSessionRevision && !prior) fail(409, 'Setup conversation changed. Reload.');
    if (Object.keys(s.requests).length >= 100 && !prior) fail(409, 'Start a new setup session (100 command limit).');
    s.lease = { id: leaseId, until: deps.now() + 120000 };
    s.requests[body.requestId] = { fingerprint, status: 'started' }; delete s.error;
    return s;
  });
  if (duplicate) return { session: projection(session), duplicate: true };
  const persist = async () => {
    const copy = structuredClone(session);
    session = await deps.store.update(member.orgId, member.uid, id, current => {
      if (current.lease?.id !== leaseId) fail(409, 'Setup operation lease expired. Inspect its receipts.');
      return { ...copy, revision: current.revision };
    });
  };
  const step = async (key: string, execute: () => Promise<any>, uncertain = false) => {
    const p = session.proposal!;
    if (p.operations[key]?.status === 'completed') return p.operations[key].receipt;
    if (uncertain && p.operations[key]) fail(409, 'Live dispatch has already been attempted. Inspect the owning run; it will not be replayed.');
    p.operations[key] = { status: 'started' }; await persist();
    try { const result = redact(await execute()); session.proposal!.operations[key] = { status: 'completed', receipt: result }; await persist(); return result; }
    catch (e) { session.proposal!.operations[key] = { status: uncertain ? 'unknown' : 'failed', error: safeError(e) }; await persist(); throw e; }
  };
  try {
    if (operation === 'expand_scope') {
      if (session.scope.kind !== 'element' || body.projectId !== session.scope.projectId) fail(422, 'Scope expansion can only cover the current workflow.');
      session.scope = { kind: 'workflow', projectId: session.scope.projectId }; delete session.proposal; delete session.liveReview; delete session.activationReview;
      session.messages.push({ role: 'assistant', text: 'The session now covers this entire workflow. I will prepare a new review before saving.' });
    } else if (operation === 'turn') {
      if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 8000) fail(422, 'Enter a message of at most 8,000 characters.');
      noSecrets(body.message);
      session.messages.push({ role: 'user', text: body.message });
      await persist(); // The user turn survives model/provider failures.
      const reply = await deps.conversation(session, readTools(api, session.scope));
      session.messages.push({ role: 'assistant', text: redact(reply.message) });
      if (reply.question) session.question = redact(reply.question); else delete session.question;
      if (reply.proposal) {
        if (session.proposal && Object.values(session.proposal.operations).some(o => o.status === 'completed') && !session.proposal.applied) fail(409, 'A save partially completed. Resume Apply configuration with the original proposal before replacing it.');
        session.proposal = await prepareProposal(session, reply.proposal, api); delete session.simulation; delete session.liveReview; delete session.activationReview;
      }
    } else if (operation === 'prepare') {
      if (!session.proposal) fail(422, 'Ask the assistant to prepare changes first.');
      if (Object.values(session.proposal.operations).some(o => o.status === 'completed') && !session.proposal.applied) fail(409, 'A save partially completed. Resume Apply configuration with the original proposal before preparing another.');
      session.proposal = await prepareProposal(session, session.proposal, api); delete session.liveReview; delete session.activationReview;
    } else if (operation === 'simulate') {
      const p = session.proposal;
      if (!p || !p.valid) fail(422, 'Prepare a valid proposal first.');
      if (!p.fixtures || !p.assertions?.length) fail(422, 'Ask the assistant to supply fixtures and assertions for this workflow.');
      const c = await api('GET', '/api/configuration');
      if (!p.applied && c.revision !== p.expectedRevision) fail(409, 'Configuration changed. Review a new proposal before testing.');
      session.simulation = await api('POST', '/api/test-runs', { projectId: session.scope.projectId, expectedRevision: c.revision, requestId: `setup_test_${hash({ id, p: p.id, rev: c.revision }).slice(0, 32)}`, fixtures: p.fixtures, assertions: p.assertions, inputs: p.inputs || {}, ...(!p.applied ? { changes: p.changes, planHash: p.planHash } : {}) });
    } else if (operation === 'apply') {
      const p = session.proposal;
      if (!p || !p.valid || body.reviewHash !== p.reviewHash) fail(409, 'Review the current proposal before applying.');
      if (p.preflight?.bindingIssues?.length) fail(422, p.preflight.bindingIssues.join(' '));
      scopedChanges(session.scope, p.changes); scopedExtras(session.scope, p.extras);
      const configurationDone = p.operations.configuration?.status === 'completed';
      // Reconcile a lost configuration response using its stable receipt before checking revision.
      const requestId = `setup_apply_${hash({ id, proposal: p.id }).slice(0, 32)}`;
      if (!configurationDone && p.operations.configuration) {
        try { const receipt = await api('GET', '/api/configuration', undefined, { requestId }); p.operations.configuration = { status: 'completed', receipt }; await persist(); } catch (e: any) { if (e.status !== 404) throw e; }
      }
      const current = await api('GET', '/api/configuration');
      if (p.operations.configuration?.status !== 'completed' && current.revision !== p.expectedRevision) fail(409, 'Configuration changed. Review changes again.');
      const latestSchedules = (await api('GET', '/api/schedules')).data || [];
      const expectedSchedules = p.pauseSchedules.map((s: any) => s.id);
      if (latestSchedules.some((s: any) => s.projectId === session.scope.projectId && s.enabled && !expectedSchedules.includes(s.id))) fail(409, 'An enabled schedule changed. Prepare a new review.');
      for (const schedule of p.pauseSchedules) {
        const currentSchedule = latestSchedules.find((s: any) => s.id === schedule.id);
        if (currentSchedule?.enabled && hash(currentSchedule) !== hash(schedule)) fail(409, 'A schedule changed. Prepare a new review.');
        await step(`pause_${schedule.id}`, () => api('PATCH', '/api/schedules', { ...schedule, enabled: false }));
      }
      await noActiveRun(api, session);
      await step('configuration', () => api('POST', '/api/configuration', { operation: 'apply', expectedRevision: p.expectedRevision, planHash: p.planHash, changes: p.changes, requestId }));
      if (p.extras.resources) {
        if (!['owner', 'admin'].includes(member.role)) fail(403, 'A human administrator must approve named-resource bindings.');
        if (session.proposal!.operations.resources?.status !== 'completed') {
          const currentResources = (await api('GET', '/api/workspace/resources', undefined, { projectId: session.scope.projectId })).resources;
          // A lost PATCH response may already contain the exact approved binding.
          if (hash(currentResources) === hash(p.extras.resources)) session.proposal!.operations.resources = { status: 'completed', receipt: { resources: currentResources, reconciled: true } };
          else if (hash(currentResources) !== hash(p.resourcesBefore || [])) fail(409, 'Named resources changed. Inspect the partially saved workflow before replacing bindings.');
        }
        await step('resources', () => api('PATCH', '/api/workspace/resources', { projectId: session.scope.projectId, resources: p.extras.resources }));
      }
      for (const schedule of p.extras.schedules || []) await step(`schedule_${schedule.id}`, () => api('POST', '/api/schedules', { ...schedule, enabled: false }));
      session.proposal!.applied = true;
      session.messages.push({ role: 'assistant', text: 'Configuration saved. Schedules remain paused. Simulation, live testing and activation are separate steps.' });
    } else if (operation === 'review_live' || operation === 'review_activation') {
      if (!session.proposal?.applied) fail(422, 'Apply the configuration before live testing or activation.');
      if (operation === 'review_live' && Object.entries(session.proposal.operations).some(([key, value]) => key.startsWith('live_') && ['started', 'unknown'].includes(value.status))) fail(409, 'A previous live dispatch is uncertain. Inspect its existing review and owning run before starting another test.');
      const c = await configuration(api, session.scope.projectId);
      const schedules = (await api('GET', '/api/schedules')).data.filter((s: any) => s.projectId === session.scope.projectId);
      const validation = await api('POST', '/api/configuration', { operation: 'validate', expectedRevision: c.revision, changes: [{ resource: 'project', operation: 'update', id: session.scope.projectId, value: { name: c.project.name } }] });
      const inputs = operation === 'review_live' ? (session.proposal.inputs || {}) : {};
      const effects = effectPreview(c.project, inputs);
      const review: any = { revision: c.revision, projectId: session.scope.projectId, configurationHash: hash(c.project), schedules, effects, inputs, preflight: validation.preflight, providerReadiness: 'not_checked', note: 'Existing contact hours, budgets, grants and review policies still apply. Paused schedules do not cancel running executions.' };
      review.hash = hash(review);
      if (operation === 'review_live') session.liveReview = review; else session.activationReview = review;
    } else if (operation === 'approve_live' || operation === 'approve_activation') {
      const live = operation === 'approve_live', review = live ? session.liveReview : session.activationReview;
      if (!review || body.reviewHash !== review.hash) fail(409, 'Review the exact current action first.');
      const c = await configuration(api, session.scope.projectId);
      const schedules = (await api('GET', '/api/schedules')).data.filter((s: any) => s.projectId === session.scope.projectId);
      if (c.revision !== review.revision || hash(c.project) !== review.configurationHash || hash(schedules) !== hash(review.schedules)) fail(409, 'Workflow or schedules changed. Review the action again.');
      if (!review.preflight?.ready) fail(422, 'Resolve configuration prerequisites before live testing or activation.');
      if (live) {
        if (Object.entries(session.proposal!.operations).some(([key, value]) => key.startsWith('live_') && ['started', 'unknown'].includes(value.status))) fail(409, 'A previous live dispatch is uncertain. Inspect and reconcile its owning run before another test.');
        await noActiveRun(api, session);
        if (review.effects.some((e: any) => e.inputs?.unresolved || /\{\{/.test(JSON.stringify(e.inputs?.to || e.recipients || '')))) fail(422, 'Resolve test recipients and inputs before approving a live test.');
        const scheduleId = `setup_live_${hash({ id, review: review.hash }).slice(0, 30)}`;
        await step(`test_schedule_${review.hash}`, () => api('POST', '/api/schedules', { id: scheduleId, projectId: session.scope.projectId, name: 'TEST ONLY — setup assistant', activity: 'flow_start', enabled: false, timezone: 'Australia/Brisbane', recurrence: { kind: 'interval', intervalMinutes: 1440 }, input: review.inputs, resetPolicy: 'flow' }));
        const result = await step(`live_${review.hash}`, () => api('POST', '/api/schedules/run', { id: scheduleId }), true);
        session.liveReview = { ...review, scheduleId, dispatch: result, status: 'dispatched', completion: 'not_verified' };
      } else {
        if (!schedules.some((s: any) => !s.id.startsWith('setup_live_') && !s.name?.startsWith('TEST ONLY'))) fail(422, 'Configure a disabled schedule before activating.');
        for (const s of schedules) {
          if (s.id.startsWith('setup_live_') || s.name?.startsWith('TEST ONLY')) continue;
          await step(`activate_${review.hash}_${s.id}`, () => api('PATCH', '/api/schedules', { ...s, enabled: true }));
        }
        session.activationReview = { ...review, status: 'active' };
      }
    } else if (operation === 'inspect') {
      const history = await api('GET', '/api/flow/advance', undefined, { orgId: session.orgId, projectId: session.scope.projectId, limit: 100 });
      if (session.liveReview) {
        const scheduleId = session.liveReview.scheduleId || `setup_live_${hash({ id, review: session.liveReview.hash }).slice(0, 30)}`;
        const matching = (history.runs || []).filter((r: any) => r.triggerId === scheduleId);
        const run = matching.length === 1 ? matching[0] : null;
        session.liveReview = { ...session.liveReview, runs: redact(matching), completion: run?.status === 'completed' ? 'completed' : run?.status || 'not_verified' };
        if (run) session.proposal!.operations[`live_${session.liveReview.hash}`] = { status: 'completed', receipt: { flowRunId: run.id, status: run.status, reconciled: true } };
      }
    }
    session.requests[body.requestId] = { fingerprint, status: 'completed' };
    delete session.lease; await persist();
    console.info('[setup-assistant] command', { operation, status: 'completed' });
    return { session: projection(session) };
  } catch (error: any) {
    session.error = safeError(error); session.requests[body.requestId] = { fingerprint, status: 'failed', error: session.error };
    delete session.lease; await persist();
    console.warn('[setup-assistant] command', { operation, status: 'failed', code: error.status || 503 });
    throw error;
  }
}
