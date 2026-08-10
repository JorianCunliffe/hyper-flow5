import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { coerceAnalysis, coerceAnalysisValue, normalizeBlandCallback } from '../lib/inboundVoice';

const completedPayload = (overrides: any = {}) => ({
  call_id: 'call_abc',
  status: 'completed',
  completed: true,
  call_length: 1.4,
  summary: 'They want to proceed.',
  answered_by: 'human',
  recording_url: 'https://example.com/rec.mp3',
  concatenated_transcript: 'Hello... yes please.',
  analysis: { proposal_interest: 'true', call_summary: 'Interested' },
  metadata: { orgId: 'org_1', projectId: 'p1', nodeId: 'CALL', runId: 'r1' },
  ...overrides
});

describe('coerceAnalysisValue', () => {
  test('coerces stringified booleans, which is how Bland usually returns them', () => {
    assert.equal(coerceAnalysisValue('true'), true);
    assert.equal(coerceAnalysisValue('TRUE'), true);
    assert.equal(coerceAnalysisValue(' false '), false);
  });

  test('coerces numeric strings', () => {
    assert.equal(coerceAnalysisValue('42'), 42);
    assert.equal(coerceAnalysisValue('-3.5'), -3.5);
  });

  test('maps null-ish strings to null', () => {
    assert.equal(coerceAnalysisValue('N/A'), null);
    assert.equal(coerceAnalysisValue('none'), null);
  });

  test('leaves ordinary prose alone', () => {
    assert.equal(coerceAnalysisValue('They seemed keen'), 'They seemed keen');
  });

  test('passes through native types untouched', () => {
    assert.equal(coerceAnalysisValue(true), true);
    assert.equal(coerceAnalysisValue(7), 7);
    assert.equal(coerceAnalysisValue(null), null);
  });

  test('coerceAnalysis tolerates junk', () => {
    assert.deepEqual(coerceAnalysis(null), {});
    assert.deepEqual(coerceAnalysis('nope'), {});
    assert.deepEqual(coerceAnalysis(['a']), {});
  });
});

describe('normalizeBlandCallback', () => {
  test('extracts correlation metadata', () => {
    const e = normalizeBlandCallback(completedPayload());
    assert.equal(e.eventId, 'call_abc');
    assert.equal(e.orgId, 'org_1');
    assert.equal(e.projectId, 'p1');
    assert.equal(e.nodeId, 'CALL');
    assert.equal(e.runId, 'r1');
  });

  test('a completed call is a success and its analysis becomes branchable project data', () => {
    const e = normalizeBlandCallback(completedPayload());
    assert.equal(e.status, 'success');
    assert.equal(e.output.proposal_interest, true, 'strict `equals: true` branches depend on this coercion');
    assert.equal(e.output.call_completed, true);
    assert.equal(e.output.call_summary, 'They want to proceed.');
    assert.equal(e.output.call_recording_url, 'https://example.com/rec.mp3');
    assert.equal(e.output.call_transcript, 'Hello... yes please.');
    assert.equal(e.error, undefined);
  });

  test('the top-level summary wins over the analysis summary', () => {
    const e = normalizeBlandCallback(completedPayload());
    assert.equal(e.output.call_summary, 'They want to proceed.');
  });

  test('a failed call is an error and carries the provider message', () => {
    const e = normalizeBlandCallback(completedPayload({ status: 'failed', completed: false, error_message: 'no answer' }));
    assert.equal(e.status, 'error');
    assert.equal(e.error, 'no answer');
    assert.equal(e.output.call_completed, false);
  });

  test('a call marked completed but carrying an error is treated as an error', () => {
    const e = normalizeBlandCallback(completedPayload({ status: 'errored', completed: true, error_message: 'carrier rejected' }));
    assert.equal(e.status, 'error');
    assert.equal(e.error, 'carrier rejected');
  });

  test('an unknown status is an error with a readable message', () => {
    const e = normalizeBlandCallback({ call_id: 'c1', metadata: {} });
    assert.equal(e.status, 'error');
    assert.match(e.error!, /unknown/);
  });

  test('missing correlation metadata yields undefined rather than throwing', () => {
    const e = normalizeBlandCallback({ call_id: 'c1', status: 'completed' });
    assert.equal(e.orgId, undefined);
    assert.equal(e.projectId, undefined);
  });

  test('a junk body does not throw and reports no event id', () => {
    assert.equal(normalizeBlandCallback(null).eventId, '');
    assert.equal(normalizeBlandCallback('nonsense').eventId, '');
    assert.equal(normalizeBlandCallback(undefined).eventId, '');
  });
});
