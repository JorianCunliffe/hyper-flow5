import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCallOverrides, COACHING_PROMPT, resolveCallTemplate } from '../lib/callPrompts';
import { executeTask } from '../lib/executeTask';

test('multiline coaching sources preserve purpose, destination and tracker row boundaries', () => {
  const rows = [['2026-09-16', 'Done', '', 'Finish "report"', 'Send report'], ['2026-09-15', 'Earlier']];
  const call = resolveCallTemplate(JSON.stringify({ to: '{{contact_phone}}', purpose_type: 'coaching_session', prompt: COACHING_PROMPT }), {
    contact_phone: '+61400000000', google_doc_text: 'Goals\nReview "progress" and $&', google_sheet_values: rows
  });
  assert.equal(call.to, '+61400000000');
  assert.equal(call.purpose_type, 'coaching_session');
  assert.ok(call.prompt.includes('Goals\nReview "progress" and $&'));
  assert.ok(call.prompt.includes(JSON.stringify(rows)));
  assert.ok(!call.prompt.includes('{{google_doc_text}}'));
});

test('coaching reviews prior completion before next plans and keeps evidence out of greeting', () => {
  const result = buildCallOverrides('PRIVATE TRACKER CONTEXT', 'coaching_session');
  assert.ok(result.systemMessage.indexOf('completed, partly completed') < result.systemMessage.indexOf('ask what comes next'));
  assert.match(result.systemMessage, /never invent a commitment/);
  assert.match(result.systemMessage, /deadlines/);
  assert.ok(!result.greetingText.includes('PRIVATE TRACKER'));
  assert.ok(result.greetingText.length < 150);
  assert.equal(buildCallOverrides('Confirm the delivery time.', 'workflow_action', 'Hello, I’m calling about your delivery.').greetingText, 'Hello, I’m calling about your delivery.');
});

test('test call dispatch sends test instructions and does not fetch coaching history', async t => {
  const keys = ['COMMUNICATIONS_API_URL', 'COMMUNICATIONS_API_KEY', 'COMMUNICATIONS_FROM_NUMBER', 'PUBLIC_BASE_URL'];
  const prior = keys.map(key => process.env[key]);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; keys.forEach((key, i) => { if (prior[i] === undefined) delete process.env[key]; else process.env[key] = prior[i]; }); });
  process.env.COMMUNICATIONS_API_URL = 'https://communications.example';
  process.env.COMMUNICATIONS_API_KEY = 'test';
  process.env.COMMUNICATIONS_FROM_NUMBER = '+61411111111';
  process.env.PUBLIC_BASE_URL = 'https://hyperflow.example';
  const requests: any[] = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json({ communication_id: 'comm_test', channel: 'voice', status: 'accepted' }, { status: 201 });
  };
  const result = await executeTask('outgoing_call', JSON.stringify({
    to: '+61400000000', purpose_type: 'test_call', prompt: 'Check two-way audio and callback delivery.'
  }), { google_doc_text: 'UNRELATED COACHING DATA' }, { correlation: { orgId: 'org_test', projectId: 'p_test', nodeId: 'CALL_TEST', runId: 'test_run_1' } });
  assert.equal(result.httpStatus, 202);
  assert.equal(requests.length, 1);
  const request = requests[0].body;
  assert.equal(request.purpose.type, 'test_call');
  assert.match(request.overrides.greetingText, /test call/);
  assert.match(request.overrides.systemMessage, /two-way audio and callback delivery/);
  assert.ok(!request.overrides.systemMessage.includes('UNRELATED COACHING DATA'));
  assert.equal(result.body.output.conversation_context.status, 'not_requested');
});
