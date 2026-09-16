import test from 'node:test';
import assert from 'node:assert/strict';
import { durableActionExecutor, ActionRecoveryRequired, settleActionDispatch, type ActionDispatch, type DispatchStore } from '../lib/actionDispatch.js';
import { actionAttemptIdentity, advanceProjectFlow, resolvePendingRun, type ActionExecutor } from '../lib/flowOrchestrator.js';
import { reconcileDispatchResults } from '../lib/serverFlow.js';
import { createFlowRun, materializeFlowRunProject } from '../lib/flowRun.js';
import { terminalExternalEventResult, normalizeExternalEvent } from '../lib/externalEvents.js';
import { advanceFlow } from '../lib/flowEngine.js';
import { dailyCoachingTemplate, safeCoachingRetryGraph } from '../lib/projectTemplates.js';
import { NodeType } from '../types.js';
import { action, project } from './helpers.js';
import { HttpCommunicationsClient } from '../lib/communications/client.js';
import { serverExecutor } from '../lib/serverExecutor.js';
import { coachingRetryPolicy } from '../lib/coachingRetry.js';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const memoryStore = () => {
  const rows = new Map<string, ActionDispatch>();
  const store: DispatchStore = { async transact(org, id, update) {
    const next = clone(update(rows.get(`${org}/${id}`) || null));
    rows.set(`${org}/${id}`, next); return clone(next);
  } };
  return { store, rows };
};
const context = { orgId: 'tenant', projectId: 'p1', nodeId: 'CALL', runId: 'op:flow:CALL:1', flowRunId: 'flow', occurrenceId: 'today', attempt: 1 };

test('pre-upgrade occurrences cannot dispatch another call without reconciliation', async () => {
  await assert.rejects(serverExecutor('outgoing_call', '{}', { flow_dispatch_version: 0 }, context), /Legacy occurrence requires provider reconciliation/);
});

test('dispatch survives a later FlowRun write failure and concurrent orchestration replay', async () => {
  const { store } = memoryStore();
  let calls = 0;
  const execute = durableActionExecutor(async () => { calls++; return { status: 'pending', externalId: 'comm-one' }; }, store);
  const original = project([action('CALL', NodeType.PHONE_CALL, { actionConfig: { template: '', autoExecute: true } })], { flow_run_id: 'flow', flow_occurrence_id: 'today' });
  await assert.rejects(advanceProjectFlow(original, execute, { orgId: 'tenant', checkpoint: async value => {
    if (value.milestones[0].actionConfig?.lastRun) throw new Error('PERMISSION_DENIED after dispatch');
  } }), /PERMISSION_DENIED/);
  const resumed = await Promise.all([advanceProjectFlow(original, execute, { orgId: 'tenant' }), advanceProjectFlow(original, execute, { orgId: 'tenant' })]);
  assert.equal(calls, 1);
  for (const result of resumed) assert.equal(result.project.milestones[0].actionConfig?.lastRun?.externalId, 'comm-one');
});

test('simultaneous dispatch claims admit one worker; an active claim is recoverable, not business failure', async () => {
  const { store } = memoryStore(); let calls = 0;
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  const execute = durableActionExecutor(async () => { calls++; entered(); await gate; return { status: 'pending', externalId: 'comm' }; }, store);
  const first = execute('outgoing_call', '{}', {}, context);
  await started;
  await assert.rejects(execute('outgoing_call', '{}', {}, context), ActionRecoveryRequired);
  release(); await first; assert.equal(calls, 1);
});

test('death after claim but before dispatch transition is safely resumed', async () => {
  const { store, rows } = memoryStore(); let writes = 0; let calls = 0;
  const failing: DispatchStore = { transact: async (...args) => {
    if (++writes === 2) throw new Error('process died'); return store.transact(...args);
  } };
  const provider: ActionExecutor = async () => { calls++; return { status: 'pending' }; };
  await assert.rejects(durableActionExecutor(provider, failing)('outgoing_call', '{}', {}, context), /process died/);
  assert.equal([...rows.values()][0].state, 'claimed');
  await durableActionExecutor(provider, store)('outgoing_call', '{}', {}, context);
  assert.equal(calls, 1);
});

test('death after provider dispatch replays the same frozen request/key and creates one communication', async () => {
  const { store } = memoryStore(); let clock = 1; let writes = 0;
  const providerIds = new Map<string, string>(); const requests: any[] = [];
  const provider: ActionExecutor = async (_type, template, data, ctx) => {
    requests.push({ template, data, key: ctx.runId });
    if (!providerIds.has(ctx.runId)) providerIds.set(ctx.runId, 'comm-one');
    return { status: 'pending', externalId: providerIds.get(ctx.runId) };
  };
  const failCompletion: DispatchStore = { transact: async (...args) => {
    if (++writes === 3) throw new Error('lost acknowledgement'); return store.transact(...args);
  } };
  await assert.rejects(durableActionExecutor(provider, failCompletion, () => clock)('outgoing_call', 'original', { x: 1 }, context));
  clock += 121_000;
  const result = await durableActionExecutor(provider, store, () => clock)('outgoing_call', 'changed', { x: 99 }, context);
  assert.equal(result.externalId, 'comm-one'); assert.equal(providerIds.size, 1);
  assert.deepEqual(requests[0], requests[1]);
});

test('unknown webhook outcome never automatically repeats a non-idempotent external write', async () => {
  const { store } = memoryStore(); let calls = 0; let clock = 1;
  const execute = durableActionExecutor(async () => { calls++; throw new Error('connection lost after external write'); }, store, () => clock);
  await assert.rejects(execute('webhook', '{}', {}, context)); clock += 300_000;
  await assert.rejects(execute('webhook', '{}', {}, context), /reconciliation/); assert.equal(calls, 1);
});

test('provider request freezing preserves dynamic voice context across acknowledgement loss', async () => {
  const { store } = memoryStore(); let clock = 1; let fail = true; let promptVersion = 0;
  const requests: string[] = []; const keys: string[] = [];
  const faultStore: DispatchStore = { async transact(org, id, update) {
    return store.transact(org, id, current => {
      const next = update(current);
      if (fail && next.outcome) { fail = false; throw new Error('result persistence failed'); }
      return next;
    });
  } };
  const execute = durableActionExecutor(async (_type, _template, _data, ctx) => {
    const client = new HttpCommunicationsClient({ baseUrl: 'https://communications.invalid', apiKey: 'test', fetchImpl: (async (_url, init) => {
      requests.push(String(init?.body)); keys.push(String((init?.headers as any)['Idempotency-Key']));
      return Response.json({ communication_id: 'one', status: 'accepted' });
    }) as typeof fetch });
    const result = await client.startCall({ to: '+15550000001', from: '+15550000000',
      overrides: { systemMessage: `context ${++promptVersion}`, greetingText: 'Hello', aiSpeaksFirst: true, liveTranscript: true },
      correlation: { tenant_id: 'tenant', external_project_id: ctx.projectId, task_id: ctx.nodeId, run_id: ctx.runId } });
    return { status: 'pending', externalId: result.id };
  }, faultStore, () => clock);
  await assert.rejects(execute('outgoing_call', '', {}, context)); clock += 121_000;
  await execute('outgoing_call', '', {}, context);
  assert.equal(requests.length, 2); assert.equal(requests[0], requests[1]); assert.deepEqual(keys, [context.runId, context.runId]);
});

test('failure and completion converge to success in either order; repeated event is a no-op', async () => {
  for (const order of [['error', 'success'], ['success', 'error']] as const) {
    const { store, rows } = memoryStore();
    await durableActionExecutor(async () => ({ status: 'pending' }), store)('outgoing_call', '{}', {}, context);
    for (const status of order) await settleActionDispatch('tenant', context.runId, status, { status }, store);
    const before = clone([...rows.values()][0]);
    await settleActionDispatch('tenant', context.runId, 'error', { status: 'error' }, store);
    assert.deepEqual([...rows.values()][0], before); assert.equal(before.terminal?.status, 'success');
  }
});

test('callback before FlowRun result persistence reconstructs the pending action from durable operation', async () => {
  const { store, rows } = memoryStore();
  const original = project([action('CALL', NodeType.PHONE_CALL)], { flow_run_id: 'flow', flow_occurrence_id: 'today' });
  await durableActionExecutor(async () => ({ status: 'pending', externalId: 'comm' }), store)('outgoing_call', '{}', {}, context);
  await settleActionDispatch('tenant', context.runId, 'event', { status: 'success', output: { conversation_completed: true } }, store);
  const recovered = reconcileDispatchResults(original, [...rows.values()]);
  assert.equal(recovered.milestones[0].actionConfig?.lastRun?.status, 'success');
  const next = await advanceProjectFlow(recovered, async () => { throw new Error('must not redispatch'); });
  assert.equal(next.project.milestones[0].actionConfig?.lastRun?.id, context.runId);
});

test('logical identities separate occurrences and loop attempts', () => {
  const definition = project([action('CALL', NodeType.PHONE_CALL)]);
  const first = createFlowRun({ orgId: 'tenant', project: definition, occurrenceId: 'one', trigger: 'schedule' });
  const other = createFlowRun({ orgId: 'tenant', project: definition, occurrenceId: 'two', trigger: 'schedule' });
  const runtime = materializeFlowRunProject(definition, first);
  const one = actionAttemptIdentity(runtime, 'CALL');
  assert.notEqual(one.runId, actionAttemptIdentity(materializeFlowRunProject(definition, other), 'CALL').runId);
  runtime.milestones[0].actionConfig!.runHistory = [{ id: one.runId, at: 1, status: 'error', scheduleOccurrenceId: 'one' }];
  assert.equal(actionAttemptIdentity(runtime, 'CALL').attempt, 2);
});

test('semantic completed conversation overrides a normal hangup and failure event', () => {
  for (const type of ['call.completed', 'call.failed']) for (const disposition of ['hangup', 'hang_up', 'hung_up']) {
    const event = normalizeExternalEvent({ event_id: 'event', source: 'communications', type,
      payload: { disposition, successful: false, conversation_completed: true } });
    assert.equal(terminalExternalEventResult(event)?.status, 'success');
  }
});

test('generated and existing coaching graphs remove hangup retry and enforce the retry window', () => {
  assert.equal(coachingRetryPolicy({ coaching_retry_window_minutes: 5, coaching_retry_delay_minutes: 10 }).windowMinutes, 5);
  const template = dailyCoachingTemplate({ retryWindowMinutes: 10 });
  const runtime = safeCoachingRetryGraph(project(template.milestones, { ...template.projectData, flow_started_at: Date.now() - 11 * 60_000 }));
  const route = runtime.milestones.find(item => item.id === 'COACH_CALL_ROUTE')!;
  assert.ok(!JSON.stringify(route.decisionConfig).includes('hangup'));
  const retry = runtime.milestones.find(item => item.id === 'COACH_RETRY_LOOP')!;
  retry.dependsOn = [];
  const outcome = advanceFlow(project([retry], runtime.projectData));
  assert.equal(outcome.project.milestones[0].loopConfig?.exited, true);
});

test('no-answer and busy retry only after delay and stop at attempt limit or window', async () => {
  for (const expireWindow of [false, true]) {
    const template = dailyCoachingTemplate({ retryAttempts: 2, retryDelayMinutes: 10, retryWindowMinutes: 30 });
    let runtime = project(template.milestones, { ...template.projectData,
      flow_run_id: 'retry-flow', flow_occurrence_id: 'today', flow_started_at: Date.now() });
    let calls = 0;
    const execute: ActionExecutor = async type => type === 'outgoing_call'
      ? (++calls, { status: 'pending', externalId: `comm-${calls}` }) : { status: 'success', output: {} };
    runtime = (await advanceProjectFlow(runtime, execute)).project;
    const fail = async (disposition: string) => {
      runtime = resolvePendingRun(runtime, { externalId: `comm-${calls}` }, {
        status: 'error', output: { disposition, successful: false }, resolvedBy: 'test' })!.project;
      runtime = (await advanceProjectFlow(runtime, execute)).project;
    };
    const releaseWait = () => {
      runtime = { ...runtime, milestones: runtime.milestones.map(node => node.id === 'COACH_RETRY_WAIT'
        ? { ...node, waitConfig: { ...node.waitConfig!, resolvedAt: Date.now() } } : node) };
    };
    await fail('no_answer'); assert.equal(calls, 1);
    assert.ok(runtime.milestones.find(node => node.id === 'COACH_RETRY_WAIT')?.waitConfig?.resumeAt);
    runtime = (await advanceProjectFlow(runtime, execute)).project; assert.equal(calls, 1);
    if (expireWindow) runtime.projectData!.flow_started_at = Date.now() - 31 * 60_000;
    releaseWait(); runtime = (await advanceProjectFlow(runtime, execute)).project;
    if (!expireWindow) {
      assert.equal(calls, 2); await fail('busy'); releaseWait();
      runtime = (await advanceProjectFlow(runtime, execute)).project;
    }
    assert.equal(calls, expireWindow ? 1 : 2);
    assert.equal(runtime.milestones.find(node => node.id === 'COACH_RETRY_LOOP')?.loopConfig?.exited, true);
  }
});
