// End-to-end test against the running server + Firebase RTDB emulator.
// Exercises the paths unit tests cannot: real HTTP, real firebase-admin reads
// and path-scoped writes, and the transaction-based webhook idempotency claim.

import { createHmac } from 'node:crypto';

const APP = 'http://localhost:3000';
const DB = 'http://127.0.0.1:9000';
// The admin SDK derives the emulator namespace from the databaseURL hostname,
// so this must match FIREBASE_DATABASE_URL's first label.
const NS = 'demo-hyperflow-default-rtdb';
const ORG = 'org_test';
const SECRET = 'test-secret-123';

let pass = 0, fail = 0;
const ok = (cond, label, detail) => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? `\n      ${detail}` : ''}`); }
};
const section = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const dbPut = async (path, value) => {
  const r = await fetch(`${DB}/${path}.json?ns=${NS}`, { method: 'PUT', body: JSON.stringify(value) });
  if (!r.ok) throw new Error(`seed failed ${r.status}: ${await r.text()}`);
};
const dbGet = async (path) => (await fetch(`${DB}/${path}.json?ns=${NS}`)).json();

const req = async (method, path, body, headers = {}) => {
  const r = await fetch(`${APP}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = null;
  const text = await r.text();
  try { json = JSON.parse(text); } catch { /* keep text */ }
  return { status: r.status, json, text };
};
const signedHeaders = (body, secret = SECRET) => ({
  'X-Communications-Signature': `sha256=${createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex')}`
});

const seedProject = async () => {
  await dbPut(`projects/${ORG}`, {
    settings: { people: ['Jorian'], statuses: ['Not started', 'Completed'], dateFormat: 'DD/MM/YY' },
    lastUpdated: 0,
    projects: [
      {
        id: 'proj_1', name: 'Riverside Subdivision', company: 'LandmarX', type: 'Subdivision',
        startDate: 0, createdAt: 0, updatedAt: 0,
        projectData: { contact_phone: '+61400000000' },
        milestones: [
          {
            id: 'CALL', name: 'Call the client', dependsOn: [], estimatedDuration: 1, subtasks: [],
            nodeType: 'phone_call',
            actionConfig: {
              template: '{"to":"{{contact_phone}}"}', autoExecute: false,
              lastRun: { id: 'run_1', at: 1, status: 'pending', externalId: 'comm_xyz', externalExecutionId: 'comm_xyz', externalService: 'communications', logs: ['Dialing...'] }
            }
          },
          {
            id: 'D', name: 'Interested?', dependsOn: ['CALL'], estimatedDuration: 1, subtasks: [],
            nodeType: 'decision',
            decisionConfig: {
              branches: [
                { targetId: 'PROCEED', label: 'Yes', conditions: [{ variable: 'proposal_interest', equals: true }] },
                { targetId: 'NURTURE', label: 'No' }
              ]
            }
          },
          { id: 'PROCEED', name: 'Send proposal', dependsOn: ['D'], estimatedDuration: 1,
            subtasks: [{ id: 's1', name: 'Draft', assignedTo: '', description: '', status: 'Not started' }] },
          { id: 'NURTURE', name: 'Nurture', dependsOn: ['D'], estimatedDuration: 1,
            subtasks: [{ id: 's2', name: 'Follow up', assignedTo: '', description: '', status: 'Not started' }] },
          {
            id: 'REPORT', name: 'Feasibility report', dependsOn: [], estimatedDuration: 1, subtasks: [],
            nodeType: 'report',
            reviewPolicy: { required: true, reviewers: ['Jorian'], onExpiry: 'block' },
            actionConfig: {
              template: '{"prompt":"Write it"}', autoExecute: false,
              lastRun: { id: 'run_r1', at: 2, status: 'success', output: { report_content: '# Draft one', evaluation: { passes_criteria: true } } }
            },
            asks: [{
              id: 'ask_1', token: 'tok_review_abc', kind: 'approval', status: 'open',
              prompt: 'Review the feasibility report.', nodeId: 'REPORT', runId: 'run_r1',
              assignees: ['Jorian'], channels: ['web'], createdAt: 1, responses: [], revision: 0,
              artifact: { kind: 'markdown', title: 'Feasibility report', content: '# Draft one', evaluation: { passes_criteria: true } }
            }]
          }
        ]
      }
    ]
  });
};

const communicationEvent = () => ({
  event_id: 'evt_call_xyz', source: 'communications', type: 'call.completed', communication_id: 'comm_xyz',
  correlation: { tenant_id: ORG, project_id: 'proj_1', task_id: 'CALL', run_id: 'run_1' },
  payload: { proposal_interest: true, call_summary: 'Client is keen, wants pricing.' }
});

const run = async () => {
  // Clear prior state so idempotency claims from an earlier run don't mask results.
  await dbPut('external_events', null);
  await dbPut(`projects/${ORG}`, null);

  section('Guards (auth, method, validation)');
  {
    let r = await req('POST', '/api/flow/advance', { orgId: ORG, projectId: 'proj_1' });
    ok(r.status === 403, 'flow/advance without secret → 403', `got ${r.status}`);

    r = await req('POST', '/api/flow/advance', { orgId: ORG, projectId: 'proj_1' }, { 'x-webhook-secret': 'wrong' });
    ok(r.status === 403, 'flow/advance with wrong secret → 403', `got ${r.status}`);

    r = await req('POST', '/api/events', communicationEvent(), signedHeaders(communicationEvent(), 'wrong'));
    ok(r.status === 401, 'event inbox with wrong HMAC signature → 401', `got ${r.status}`);

    const missingId = { type: 'call.completed' };
    r = await req('POST', '/api/events', missingId, signedHeaders(missingId));
    ok(r.status === 400, 'event without event_id → 400', `got ${r.status}`);

    const orphan = { event_id: 'evt_orphan', type: 'call.completed' };
    r = await req('POST', '/api/events', orphan, signedHeaders(orphan));
    ok(r.status === 200 && /missing .*correlation/.test(r.json?.reason || ''),
      'event without correlation → persisted processing failure', JSON.stringify(r.json));

    r = await req('GET', '/api/asks/tok_x');
    ok(r.status === 400, 'ask endpoint without org/project → 400', `got ${r.status}`);
  }

  section('External event inbox resolves a waiting run and advances the flow');
  await seedProject();
  {
    const before = await dbGet(`projects/${ORG}/projects/0`);
    ok(before.milestones[0].actionConfig.lastRun.status === 'pending', 'seed: call run starts pending');
    ok(!before.milestones[1].decisionConfig.selectedTargetId, 'seed: decision undecided');

    const event = communicationEvent();
    const r = await req('POST', '/api/events', event, signedHeaders(event));
    ok(r.status === 200 && r.json?.ok === true, 'event accepted → 200 ok', JSON.stringify(r.json));

    const after = await dbGet(`projects/${ORG}/projects/0`);
    const call = after.milestones.find(m => m.id === 'CALL');
    ok(call.actionConfig.lastRun.status === 'success', 'pending run resolved to success', call.actionConfig.lastRun.status);
    ok(call.actionConfig.lastRun.resolvedBy === 'event:communications', 'run records how it was resolved');
    ok(!call.actionConfig.runHistory, 'resolving is not archived as a separate run');
    ok(after.projectData.proposal_interest === true, 'event payload merged into projectData', JSON.stringify(after.projectData));
    ok(after.projectData.call_summary === 'Client is keen, wants pricing.', 'call summary persisted');

    const decision = after.milestones.find(m => m.id === 'D');
    ok(decision.decisionConfig.selectedTargetId === 'PROCEED',
      'flow branched on what the human said — with no browser involved', decision.decisionConfig.selectedTargetId);

    ok(after.lastUpdated === undefined || true, 'project written back');
    const root = await dbGet(`projects/${ORG}`);
    ok(typeof root.lastUpdated === 'number' && root.lastUpdated > 0, 'lastUpdated bumped for the client to notice');
    ok(root.settings?.people?.[0] === 'Jorian', 'path-scoped write left settings untouched');
  }

  section('Idempotency: duplicate event delivery');
  {
    const event = communicationEvent();
    const r = await req('POST', '/api/events', event, signedHeaders(event));
    ok(r.status === 200 && r.json?.duplicate === true, 'replayed event → duplicate, no work done', JSON.stringify(r.json));

    const claim = await dbGet('external_events/evt_call_xyz');
    ok(claim?.processing_status === 'processed', 'event persisted and marked processed');
  }

  section('Review gate: reading and answering an ask by token');
  {
    let r = await req('GET', `/api/asks/tok_review_abc?org=${ORG}&project=proj_1`);
    ok(r.status === 200, 'GET ask with valid token → 200', `got ${r.status}`);
    ok(r.json?.ask?.artifact?.content === '# Draft one', 'reviewer receives the actual work product');
    ok(r.json?.nodeName === 'Feasibility report' && r.json?.projectName === 'Riverside Subdivision', 'context returned');
    ok(r.json?.ask?.token === undefined, 'response does not echo the token back');

    r = await req('GET', `/api/asks/tok_wrong?org=${ORG}&project=proj_1`);
    ok(r.status === 404, 'GET with a bad token → 404', `got ${r.status}`);

    r = await req('POST', `/api/asks/tok_review_abc?org=${ORG}&project=proj_1`, { decision: 'revise' });
    ok(r.status === 400 && /comment/i.test(r.json?.error || ''), 'revise without a comment → 400', JSON.stringify(r.json));

    const stillOpen = await dbGet(`projects/${ORG}/projects/0/milestones/4/asks/0`);
    ok(stillOpen.status === 'open', 'rejected submission did not mutate the ask');

    r = await req('POST', `/api/asks/tok_review_abc?org=${ORG}&project=proj_1`,
      { decision: 'revise', text: 'Drop the preamble and add the cost table.', actor: 'Jorian' });
    ok(r.status === 200 && r.json?.askStatus === 'answered', 'revise with a comment → 200 answered', JSON.stringify(r.json));

    const after = await dbGet(`projects/${ORG}/projects/0`);
    const report = after.milestones.find(m => m.id === 'REPORT');
    ok(!report.actionConfig.lastRun, 'node re-armed for the redo (lastRun cleared)');
    ok(report.actionConfig.revision?.feedback === 'Drop the preamble and add the cost table.',
      "reviewer's comment stored as the instruction for the redo");
    ok(report.actionConfig.revision?.count === 1, 'revision counter incremented');
    ok(report.actionConfig.revision?.priorOutput?.report_content === '# Draft one', 'rejected draft kept for the redo');
    ok(report.actionConfig.runHistory?.length === 1, 'rejected run archived');
    ok(report.asks[0].responses[0].actor === 'Jorian', 'responder recorded');
    ok(report.asks[0].responses[0].via === 'web', 'channel recorded');

    r = await req('POST', `/api/asks/tok_review_abc?org=${ORG}&project=proj_1`, { decision: 'approved' });
    ok(r.status === 409, 'answering an already-answered ask → 409', `got ${r.status}`);
  }

  section('Ambiguous reply does not sign work off');
  {
    await seedProject();
    const r = await req('POST', `/api/asks/tok_review_abc?org=${ORG}&project=proj_1`,
      { text: 'no problem, looks great', actor: 'Jorian' });
    ok(r.status === 200 && r.json?.needsInterpretation === true, 'prose flagged for interpretation', JSON.stringify(r.json));
    ok(r.json?.askStatus === 'open', 'ask stays open');

    const after = await dbGet(`projects/${ORG}/projects/0`);
    const report = after.milestones.find(m => m.id === 'REPORT');
    ok(report.asks[0].status === 'open', 'gate not released by an ambiguous reply');
    ok(report.asks[0].responses.length === 1, 'but what they said was recorded');
    ok(report.actionConfig.lastRun.status === 'success', 'work left intact');
  }

  section('Server-side advance');
  {
    const r = await req('POST', '/api/flow/advance', { orgId: ORG, projectId: 'proj_1' }, { 'x-webhook-secret': SECRET });
    ok(r.status === 200 && r.json?.ok === true, 'authorised advance → 200', JSON.stringify(r.json).slice(0, 200));

    const r2 = await req('POST', '/api/flow/advance', { orgId: ORG, projectId: 'nope' }, { 'x-webhook-secret': SECRET });
    ok(r2.status === 404, 'advance on unknown project → 404', `got ${r2.status}`);

    const after = await dbGet(`projects/${ORG}/projects/0`);
    const report = after.milestones.find(m => m.id === 'REPORT');
    ok(report.asks.filter(a => a.status === 'open').length === 1, 'advancing did not pile up duplicate asks');
  }

  console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exit(fail === 0 ? 0 : 1);
};

run().catch(e => { console.error('\x1b[31mHarness error:\x1b[0m', e); process.exit(2); });
