import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { executeTask, normalizeTaskType, TASK_TYPES } from '../lib/executeTask';
import { ACTION_TASK_TYPE } from '../lib/nodeTypes';
import { NodeType } from '../types';

describe('normalizeTaskType', () => {
  test('passes through canonical values', () => {
    for (const t of TASK_TYPES) assert.equal(normalizeTaskType(t), t);
  });

  test('accepts the label shown in the UI', () => {
    // "Phone Call" typed into the old free-text field silently became
    // unknown_task_type with no indication of what was wrong.
    assert.equal(normalizeTaskType('Phone Call'), 'outgoing_call');
    assert.equal(normalizeTaskType('phone call'), 'outgoing_call');
    assert.equal(normalizeTaskType('phone_call'), 'outgoing_call');
    assert.equal(normalizeTaskType('Email'), 'send_email');
    assert.equal(normalizeTaskType('SMS'), 'send_sms');
    assert.equal(normalizeTaskType('Report'), 'write_report');
    assert.equal(normalizeTaskType('Webhook'), 'webhook');
    assert.equal(normalizeTaskType('Google Doc'), 'read_google_doc');
    assert.equal(normalizeTaskType('Google Sheet'), 'read_google_sheet');
    assert.equal(normalizeTaskType('Append Google Sheet'), 'append_google_sheet');
    assert.equal(normalizeTaskType('Upsert Google Sheet'), 'upsert_google_sheet');
  });

  test('tolerates surrounding whitespace', () => {
    assert.equal(normalizeTaskType('  outgoing_call  '), 'outgoing_call');
    assert.equal(normalizeTaskType(' Phone Call '), 'outgoing_call');
  });

  test('returns undefined for something genuinely unknown', () => {
    assert.equal(normalizeTaskType('call_parent'), undefined);
    assert.equal(normalizeTaskType('teleport'), undefined);
    assert.equal(normalizeTaskType(''), undefined);
    assert.equal(normalizeTaskType(undefined), undefined);
  });

  test('every node type maps to a canonical task type', () => {
    for (const nodeType of [
      NodeType.EMAIL, NodeType.SMS, NodeType.PHONE_CALL, NodeType.WEBHOOK, NodeType.REPORT,
      NodeType.GOOGLE_DOC, NodeType.GOOGLE_SHEET_READ, NodeType.GOOGLE_SHEET_APPEND, NodeType.COACHING_EXTRACT
    ]) {
      const mapped = ACTION_TASK_TYPE[nodeType];
      assert.ok(mapped, `${nodeType} has no task type`);
      assert.equal(normalizeTaskType(mapped), mapped, `${nodeType} -> ${mapped} is not canonical`);
    }
  });
});

describe('executeTask with a bad task type', () => {
  test('reports what was wrong and what is valid, instead of a bare failure', async () => {
    const res = await executeTask('Phone Call is wrong', '{}', {});
    assert.equal(res.httpStatus, 400, 'a caller error should not look like success');
    assert.equal(res.body.status, 'unknown_task_type');
    assert.match(res.body.error, /Phone Call is wrong/, 'echoes what was supplied');
    for (const t of TASK_TYPES) {
      assert.match(res.body.error, new RegExp(t), `lists ${t} as valid`);
    }
  });

  test('an empty task type is rejected the same way', async () => {
    const res = await executeTask('', undefined, {});
    assert.equal(res.httpStatus, 400);
    assert.equal(res.body.status, 'unknown_task_type');
  });

  test('a recognised alias is NOT rejected', async () => {
    // No credentials here, so it fails while executing rather than at the type
    // check — the point is that it got past normalization.
    const res = await executeTask('Phone Call', '{"to":"+61400000000"}', {});
    assert.notEqual(res.body.status, 'unknown_task_type');
  });

  test('Google Workspace actions fail before access without trusted tenant and project correlation', async () => {
    const read = await executeTask('read_google_doc', '{}', {});
    assert.equal(read.httpStatus, 500);
    assert.match(read.body.error, /trusted orgId and projectId/);
    const append = await executeTask('append_google_sheet', '{"idempotency_key":"one","values":[["x"]]}', {});
    assert.equal(append.httpStatus, 500);
    assert.match(append.body.error, /trusted orgId and projectId/);
    const upsert = await executeTask('upsert_google_sheet', '{"idempotency_key":"one","key_column":0,"key_value":"x","values":["x"]}', {});
    assert.equal(upsert.httpStatus, 500);
    assert.match(upsert.body.error, /trusted orgId and projectId/);
  });
});
