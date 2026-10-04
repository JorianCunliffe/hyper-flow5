import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleSetup, prepareProposal, effectPreview, setupEnabled, setupDependencies } from '../lib/setupAssistant/service.js';
import { scopedChanges, scopedExtras, redact, noSecrets } from '../lib/setupAssistant/safety.js';
import { readTools } from '../lib/setupAssistant/adapter.js';
import { handleConfiguration } from '../lib/configuration/api.js';
import { handleTestRuns } from '../lib/configuration/testRuns.js';
import { planConfiguration, applyConfiguration } from '../lib/configuration/model.js';
import { buildOpenApi } from '../lib/http/openapi.js';
import { requestScope } from '../lib/tenantControl/clients.js';
import type { SetupSession } from '../lib/setupAssistant/types.js';

const member = { uid: 'human', orgId: 'tenant-a', role: 'admin' };
const node = (id: string, type = 'report', deps: string[] = [], template = '{"prompt":"Hello"}') => ({ id, name: id, nodeType: type, dependsOn: deps, subtasks: [], actionConfig: { template, resultVariable: `${id}_result`, autoExecute: true } });
function harness() {
  let workspace: any = { projects: [], settings: {}, dataRevision: 0 };
  let rows: Record<string, SetupSession> = {}, tests: any = {}, schedules: any[] = [], runs: any[] = [];
  const calls: any[] = []; let modelReply: any = { message: 'Draft ready.' }; let loseApply = false; let failSchedule = false; let loseLive = false;
  const clone = (v: any) => structuredClone(v);
  const store: typeof setupDependencies.store = {
    id: () => `session_${Object.keys(rows).length}`,
    async list(org, uid) { return Object.values(rows).filter(r => r.orgId === org && r.actor === uid).map(clone); },
    async get(org, uid, id) { const s = rows[id]; return s?.orgId === org && s.actor === uid ? clone(s) : null; },
    async create(s) { rows[s.id] = clone(s); return clone(s); },
    async update(org, uid, id, fn) { const row = await store.get(org, uid, id); if (!row) throw Object.assign(new Error('Setup session not found'), { status: 404 }); const next = fn(row); next.revision++; rows[id] = clone(next); return clone(next); },
    async remove(org, uid, id) { if (await store.get(org, uid, id)) delete rows[id]; },
  };
  const configurationDeps = { read: async () => clone(workspace), transact: async (_org: string, fn: any) => { workspace = fn(clone(workspace)); return clone(workspace); } };
  const api = async (method: string, path: string, body?: any, query?: any) => {
    calls.push({ method, path, body, query });
    if (path === '/api/configuration') {
      if (body?.operation === 'validate') { const p = planConfiguration(workspace, body); return { ...p, preflight: { ready: true, checks: [], providerAvailability: 'not_checked' } }; }
      const result = await handleConfiguration({ method, body, query }, member, configurationDeps);
      if (body?.operation === 'apply' && loseApply) { loseApply = false; throw new Error('Lost response after commit'); }
      return result;
    }
    if (path === '/api/discovery') return { schemas: {}, nodeTypes: ['report', 'wait', 'phone_call'], taskContracts: {} };
    if (path === '/api/integrations') return { people: [{ id: 'person-1', name: 'Jorian', phone: '+61000000000', email: 'test@example.com' }], mailboxes: [], workspaces: [] };
    if (path === '/api/workspace/resources') return { resources: [] };
    if (path === '/api/service-projects/status') return { status: 'configured' };
    if (path === '/api/flow/advance') return { runs };
    if (path === '/api/test-runs') return handleTestRuns({ method, body }, member, { workspace: async () => clone(workspace), read: async () => clone(tests), transact: async (_org, fn) => { tests = fn(clone(tests)); return clone(tests); } });
    if (path === '/api/schedules/run') {
      if (loseLive) { loseLive = false; throw new Error('Provider response lost'); }
      runs.push({ id: 'run-1', triggerId: body.id, status: 'waiting' }); return { result: { status: 'deferred', runId: 'owning-schedule-run' } };
    }
    if (path === '/api/schedules') {
      if (method === 'GET') return { data: clone(schedules) };
      if (failSchedule && body?.id === 'daily') throw new Error('Schedule unavailable');
      const i = schedules.findIndex(s => s.id === body.id); if (i < 0) schedules.push(clone(body)); else schedules[i] = clone(body); return { schedule: clone(body) };
    }
    throw new Error(`Unexpected API ${path}`);
  };
  const deps = { store, enabled: () => true, now: () => 1000, conversation: async () => clone(modelReply) };
  const create = async (scope: any = { kind: 'new' }) => (await handleSetup({ method: 'POST', body: { scope } }, member, api, deps)).session as SetupSession;
  let serial = 0;
  const command = async (s: SetupSession, operation: string, extra: any = {}) => (await handleSetup({ method: 'POST', body: { id: s.id, operation, expectedSessionRevision: s.revision, requestId: `command_${++serial}`, ...extra } }, member, api, deps)).session as SetupSession;
  const draft = async (s: SetupSession, milestones = [node('report')], extras: any = {}) => {
    modelReply = { message: 'Draft ready.', proposal: { changes: [{ resource: 'project', operation: 'create', value: { id: s.scope.projectId, name: 'Fixture workflow', milestones } }], extras, fixtures: Object.fromEntries(milestones.map(n => [n.id, { status: 'success', output: { text: 'Fixture' } }])), assertions: [{ path: `data.${milestones[0].id}_result`, operator: 'exists' }], inputs: {} } };
    return command(s, 'turn', { message: 'Prepare a workflow.' });
  };
  return { api, deps, store, calls, create, command, draft,
    get workspace() { return workspace; }, set workspace(v) { workspace = v; },
    set reply(v: any) { modelReply = v; }, set loseApply(v: boolean) { loseApply = v; }, set loseLive(v: boolean) { loseLive = v; },
    get schedules() { return schedules; }, set schedules(v: any[]) { schedules = v; }, set runs(v: any[]) { runs = v; }, set failSchedule(v: boolean) { failSchedule = v; },
  };
}

test('setup proposal simulates before apply without changing workspace or calling providers', async () => {
  const h = harness(); let s = await h.draft(await h.create());
  assert.equal(s.proposal?.valid, true); assert.equal(h.workspace.projects.length, 0);
  s = await h.command(s, 'simulate');
  assert.equal(s.simulation.item.result.providerCalls, 0); assert.equal(s.simulation.item.result.status, 'passed');
  assert.equal(h.workspace.projects.length, 0);
  s = await h.command(s, 'apply', { reviewHash: s.proposal!.reviewHash });
  assert.equal(s.proposal!.applied, true); assert.equal(h.workspace.projects.length, 1);
  assert.equal(h.calls.filter(c => c.path.endsWith('/run')).length, 0);
});
test('private sessions cannot be read or commanded by another user or tenant', async () => {
  const h = harness(), s = await h.create();
  for (const other of [{ ...member, uid: 'other' }, { ...member, orgId: 'tenant-b' }]) {
    await assert.rejects(handleSetup({ method: 'GET', query: { id: s.id } }, other, h.api, h.deps), /not found/);
    await assert.rejects(handleSetup({ method: 'POST', body: { id: s.id, operation: 'inspect', requestId: 'private_001', expectedSessionRevision: 0 } }, other, h.api, h.deps), /not found/);
  }
});
test('machine principals cannot create sessions or approve changes', async () => {
  const h = harness();
  await assert.rejects(handleSetup({ method: 'POST', body: { scope: { kind: 'new' } } }, { ...member, apiClientId: 'machine' }, h.api, h.deps), /human session/);
  assert.throws(() => requestScope({ url: '/api/setup-assistant/sessions', method: 'POST' }), /human session/);
});
test('element scope blocks other nodes, project fields, deletion and schedules until human expansion', async () => {
  const scope: any = { kind: 'element', projectId: 'p', nodeId: 'call' };
  scopedChanges(scope, [{ resource: 'node', operation: 'update', projectId: 'p', id: 'call', value: { actionConfig: { template: '{"prompt":"Ask one question at a time"}' } } }]);
  for (const change of [{ resource: 'node', operation: 'update', projectId: 'p', id: 'other' }, { resource: 'project', operation: 'update', id: 'p' }, { resource: 'node', operation: 'delete', projectId: 'p', id: 'call' }, { resource: 'settings', operation: 'update' }]) assert.throws(() => scopedChanges(scope, [change as any]), /scope|workflow/);
  assert.throws(() => scopedExtras(scope, { schedules: [{}] }), /Expand/);
});
test('selected element prompt update preserves unrelated nodes and runtime fields', async () => {
  const h = harness(); h.workspace = { dataRevision: 0, settings: {}, projects: [{ id: 'p', name: 'Sharehouse', milestones: [node('call', 'phone_call'), node('other')] }] };
  let s = await h.create({ kind: 'element', projectId: 'p', nodeId: 'call' });
  h.reply = { message: 'Prompt updated.', proposal: { changes: [{ resource: 'node', operation: 'update', projectId: 'p', id: 'call', value: { actionConfig: { template: '{"to":"+61000000000","prompt":"Ask one question, then wait."}' } } }] } };
  s = await h.command(s, 'turn', { message: 'Ask one question at a time.' }); s = await h.command(s, 'apply', { reviewHash: s.proposal!.reviewHash });
  assert.match(h.workspace.projects[0].milestones[0].actionConfig.template, /then wait/);
  assert.equal(h.workspace.projects[0].milestones[1].actionConfig.template, '{"prompt":"Hello"}');
});
test('stale workspace revisions block save before pausing or any writes', async () => {
  const h = harness(); const s = await h.draft(await h.create()); h.workspace.dataRevision++;
  await assert.rejects(h.command(s, 'apply', { reviewHash: s.proposal!.reviewHash }), /Configuration changed/);
  assert.equal(h.workspace.projects.length, 0);
});
test('exact reviewed hash is required for apply', async () => {
  const h = harness(), s = await h.draft(await h.create());
  await assert.rejects(h.command(s, 'apply', { reviewHash: 'wrong' }), /Review/);
  assert.equal(h.workspace.projects.length, 0);
});
test('lost apply response is reconciled through original receipt without duplicate writes', async () => {
  const h = harness(); let s = await h.draft(await h.create()); h.loseApply = true;
  await assert.rejects(h.command(s, 'apply', { reviewHash: s.proposal!.reviewHash }), /Lost response/);
  s = (await h.store.get(member.orgId, member.uid, s.id))!;
  s = await h.command(s, 'apply', { reviewHash: s.proposal!.reviewHash });
  assert.equal(s.proposal!.applied, true); assert.equal(h.workspace.dataRevision, 1);
  assert.equal(h.calls.filter(c => c.body?.operation === 'apply').length, 1);
});
test('partial schedule save can resume without replaying committed configuration', async () => {
  const h = harness(); let s = await h.create();
  s = await h.draft(s, undefined, { schedules: [{ id: 'daily', projectId: s.scope.projectId, name: 'Daily', activity: 'flow_start', enabled: false, timezone: 'Australia/Brisbane', recurrence: { kind: 'daily', localTime: '09:00' } }] });
  h.failSchedule = true; await assert.rejects(h.command(s, 'apply', { reviewHash: s.proposal!.reviewHash }), /Schedule unavailable/);
  s = (await h.store.get(member.orgId, member.uid, s.id))!;
  await assert.rejects(h.command(s, 'prepare'), /partially completed/);
  s = (await h.store.get(member.orgId, member.uid, s.id))!; h.failSchedule = false;
  s = await h.command(s, 'apply', { reviewHash: s.proposal!.reviewHash });
  assert.equal(s.proposal!.applied, true); assert.equal(h.workspace.dataRevision, 1); assert.equal(h.schedules[0].enabled, false);
});
test('active workflow schedules pause first and waiting runs block the edit', async () => {
  const h = harness(); h.workspace = { dataRevision: 0, projects: [{ id: 'p', name: 'P', milestones: [node('call')] }], settings: {} };
  h.schedules = [{ id: 'daily', projectId: 'p', enabled: true }]; h.runs = [{ id: 'running', status: 'waiting' }];
  let s = await h.create({ kind: 'workflow', projectId: 'p' }); h.reply = { message: 'Change', proposal: { changes: [{ resource: 'node', operation: 'update', projectId: 'p', id: 'call', value: { name: 'Changed' } }] } };
  s = await h.command(s, 'turn', { message: 'Change the call.' });
  await assert.rejects(h.command(s, 'apply', { reviewHash: s.proposal!.reviewHash }), /active execution/);
  assert.equal(h.schedules[0].enabled, false); assert.equal(h.workspace.projects[0].milestones[0].name, 'call');
});
test('model cannot call apply, live execution, arbitrary HTTP, shell or scope-expansion tools', async () => {
  const h = harness(), tool = readTools(h.api, { kind: 'new', projectId: 'p' });
  for (const name of ['apply', 'execute', 'fetch', 'shell', 'expand_scope', 'approve_live']) await assert.rejects(tool(name), /read-only/);
});
test('secret-bearing chat/configuration is rejected and returned errors are redacted', () => {
  assert.throws(() => noSecrets('https://example.com?zapikey=private-key'), /credentials/);
  assert.throws(() => noSecrets({ apiKey: 'private' }), /credentials/);
  assert.equal(redact({ token: 'private', url: 'https://example.com?zapikey=private' }).token, '[redacted]');
  assert.doesNotMatch(redact('Bearer abc https://x/?access_token=secret'), /abc|=secret/);
});
test('schedules must remain disabled, use known recurrence and retain scope', () => {
  const scope: any = { kind: 'workflow', projectId: 'p' };
  for (const schedule of [{ projectId: 'other', activity: 'flow_start' }, { projectId: 'p', activity: 'flow_start', enabled: true }, { projectId: 'p', activity: 'flow_start', recurrence: { kind: 'invented' } }]) assert.throws(() => scopedExtras(scope, { schedules: [schedule] }));
});
test('live approval is separate, uncertainty is never replayed and completion reconciles owning run', async () => {
  const h = harness(); let s = await h.draft(await h.create()); s = await h.command(s, 'apply', { reviewHash: s.proposal!.reviewHash });
  await assert.rejects(h.command(s, 'approve_live', { reviewHash: 'none' }), /Review/);
  s = (await h.store.get(member.orgId, member.uid, s.id))!; s = await h.command(s, 'review_live'); h.loseLive = true;
  await assert.rejects(h.command(s, 'approve_live', { reviewHash: s.liveReview.hash }), /response lost/);
  s = (await h.store.get(member.orgId, member.uid, s.id))!;
  await assert.rejects(h.command(s, 'approve_live', { reviewHash: s.liveReview.hash }), /changed|already been attempted/);
  assert.equal(h.calls.filter(c => c.path === '/api/schedules/run').length, 1);
});
test('live dispatch waiting result is not presented as completion', async () => {
  const h = harness(); let s = await h.draft(await h.create()); s = await h.command(s, 'apply', { reviewHash: s.proposal!.reviewHash }); s = await h.command(s, 'review_live');
  s = await h.command(s, 'approve_live', { reviewHash: s.liveReview.hash }); assert.equal(s.liveReview.completion, 'not_verified');
  s = await h.command(s, 'inspect'); assert.equal(s.liveReview.completion, 'waiting');
  h.runs = [{ id: 'run-1', triggerId: s.liveReview.scheduleId, status: 'completed' }]; s = await h.command(s, 'inspect'); assert.equal(s.liveReview.completion, 'completed');
});
test('fixture Sharehouse sequence covers intake, availability, call, drafts, booking and SMS without provider calls', async () => {
  const h = harness(); let s = await h.create();
  const nodes = [node('intake', 'email_triage'), node('rooms', 'webhook', ['intake'], '{"url":"https://example.com/rooms","method":"GET"}'), node('call', 'phone_call', ['rooms'], '{"to":"+61000000000","prompt":"Ask one question at a time."}'), node('draft', 'email', ['call'], '{"to":"test@example.com","subject":"TEST ONLY","body":"Inspection details"}'), node('booking', 'webhook', ['draft'], '{"url":"https://example.com/diary","method":"POST"}'), node('sms', 'sms', ['booking'], '{"to":"+61000000000","body":"TEST ONLY inspection confirmation"}')];
  s = await h.draft(s, nodes); s = await h.command(s, 'simulate');
  assert.equal(s.simulation.item.result.status, 'passed'); assert.equal(s.simulation.item.result.providerCalls, 0);
  assert.equal(s.simulation.item.result.dispatches.length, 6);
});
test('invalid graph and unsupported configuration fail before applying', async () => {
  const h = harness(); const s = await h.create(); const draft: any = { changes: [{ resource: 'project', operation: 'create', value: { id: s.scope.projectId, name: 'Bad', milestones: [node('a', 'report', ['b']), node('b', 'report', ['a'])] } }] };
  const p = await prepareProposal(s, draft, h.api); assert.equal(p.valid, false);
  assert.equal(h.workspace.projects.length, 0);
});
test('resuming preserves decisions and rejects concurrent/stale session commands', async () => {
  const h = harness(); const s = await h.create(); h.reply = { message: 'Which mailbox?', question: { text: 'Which mailbox?', resourceKind: 'mailboxes' } };
  const current = await h.command(s, 'turn', { message: 'Read mail each morning.' });
  const resumed = (await handleSetup({ method: 'GET', query: { id: s.id } }, member, h.api, h.deps)).session!;
  assert.equal(resumed.question!.resourceKind, 'mailboxes'); assert.equal(resumed.messages[1].text, 'Read mail each morning.');
  await assert.rejects(h.command(s, 'turn', { message: 'stale' }), /conversation changed/);
  assert.ok(current.revision > s.revision);
});
test('rollout defaults off and manual API/editor paths remain available', async () => {
  const old = process.env.SETUP_ASSISTANT_ENABLED; delete process.env.SETUP_ASSISTANT_ENABLED;
  assert.equal(setupEnabled('any'), false); if (old !== undefined) process.env.SETUP_ASSISTANT_ENABLED = old;
  const h = harness(); await assert.rejects(handleSetup({ method: 'POST', body: { scope: { kind: 'new' } } }, member, h.api, { ...h.deps, enabled: () => false }), /disabled/);
});
test('API contract and database rules expose human-only sessions and deny browser access', () => {
  const op: any = buildOpenApi().paths['/api/setup-assistant/sessions']; assert.ok(op.get && op.post && op.delete);
  assert.deepEqual(op.post.security, [{ FirebaseBearer: [] }]);
  const rules = JSON.parse(readFileSync('database.rules.json', 'utf8')).rules.setup_assistant_sessions;
  assert.equal(rules['.read'], false); assert.equal(rules['.write'], false); assert.match(rules.$orgId['.read'], /hyperflow_runtime/);
});

test('unknown contact identifiers produce an actionable prerequisite and block save', async () => {
  const h = harness(); let s = await h.create();
  h.reply = { message: 'Contact setup', proposal: { changes: [{ resource: 'project', operation: 'create', value: { id: s.scope.projectId, name: 'Unknown contact', milestones: [node('call', 'phone_call', [], '{"to":"+61999999999","prompt":"Availability?"}')] } }] } };
  s = await h.command(s, 'turn', { message: 'Ask my configured contact.' });
  assert.match(s.proposal!.preflight.bindingIssues[0], /select or explicitly supply recipient/);
  await assert.rejects(h.command(s, 'apply', { reviewHash: s.proposal!.reviewHash }), /recipient/);
  assert.equal(h.workspace.projects.length, 0);
});
test('model outage preserves the user turn and prior proposal', async () => {
  const h = harness(); const s = await h.draft(await h.create());
  await assert.rejects(handleSetup({ method: 'POST', body: { id: s.id, operation: 'turn', message: 'Keep the previous proposal.', expectedSessionRevision: s.revision, requestId: 'outage_turn_001' } }, member, h.api, { ...h.deps, conversation: async () => { throw new Error('Provider credit failure'); } }), /Provider credit failure/);
  const saved = (await h.store.get(member.orgId, member.uid, s.id))!;
  assert.equal(saved.messages.at(-1)!.text, 'Keep the previous proposal.'); assert.equal(saved.proposal!.reviewHash, s.proposal!.reviewHash);
});
test('completed command replay is idempotent and changed inputs conflict', async () => {
  const h = harness(); const s = await h.draft(await h.create());
  const body = { id: s.id, operation: 'apply', expectedSessionRevision: s.revision, requestId: 'stable_apply_001', reviewHash: s.proposal!.reviewHash };
  await handleSetup({ method: 'POST', body }, member, h.api, h.deps);
  const again = await handleSetup({ method: 'POST', body }, member, h.api, h.deps); assert.equal(again.duplicate, true);
  assert.equal(h.workspace.dataRevision, 1);
  await assert.rejects(handleSetup({ method: 'POST', body: { ...body, reviewHash: 'changed' } }, member, h.api, h.deps), /identity conflict/);
});
test('activation requires a fresh independent review and leaves test schedules disabled', async () => {
  const h = harness(); let s = await h.create();
  s = await h.draft(s, undefined, { schedules: [{ id: 'daily', projectId: s.scope.projectId, name: 'Daily', activity: 'flow_start', enabled: false, timezone: 'Australia/Brisbane', recurrence: { kind: 'daily', localTime: '09:00' } }] });
  s = await h.command(s, 'apply', { reviewHash: s.proposal!.reviewHash });
  assert.equal(h.schedules[0].enabled, false);
  await assert.rejects(h.command(s, 'approve_activation', { reviewHash: s.proposal!.reviewHash }), /Review/);
  s = (await h.store.get(member.orgId, member.uid, s.id))!;
  h.schedules = [...h.schedules, { id: 'setup_live_fake', name: 'TEST ONLY', projectId: s.scope.projectId, enabled: false }];
  s = await h.command(s, 'review_activation'); s = await h.command(s, 'approve_activation', { reviewHash: s.activationReview.hash });
  assert.equal(h.schedules.find(x => x.id === 'daily').enabled, true); assert.equal(h.schedules.find(x => x.id === 'setup_live_fake').enabled, false);
});
test('old active executions outside the history page still block edits', async () => {
  const h = harness(); h.workspace = { projects: [{ id: 'p', name: 'P', milestones: [node('a')] }], settings: {}, dataRevision: 0 };
  let s = await h.create({ kind: 'workflow', projectId: 'p' }); h.reply = { message: 'Edit', proposal: { changes: [{ resource: 'node', operation: 'update', projectId: 'p', id: 'a', value: { name: 'Changed' } }] } };
  s = await h.command(s, 'turn', { message: 'Change the name.' });
  const api = async (method: string, path: string, body?: any, query?: any) => path === '/api/flow/advance' ? { runs: [], hasActiveRuns: true } : h.api(method, path, body, query);
  await assert.rejects(handleSetup({ method: 'POST', body: { id: s.id, operation: 'apply', expectedSessionRevision: s.revision, requestId: 'old_active_001', reviewHash: s.proposal!.reviewHash } }, member, api, h.deps), /active execution/);
});
test('human Ask and timer holds remain held in proposal simulation', async () => {
  const h = harness(); let s = await h.create();
  const nodes: any[] = [node('report'), { id: 'ask', name: 'Confirm time', nodeType: 'wait', dependsOn: ['report'], subtasks: [], holdConfig: { kind: 'human', human: { kind: 'question', prompt: 'What inspection time?', assignees: ['person-1'], channels: ['web'] } } }];
  s = await h.draft(s, nodes); s = await h.command(s, 'simulate');
  assert.equal(s.simulation.item.result.status, 'held'); assert.equal(s.simulation.item.result.providerCalls, 0);
});
