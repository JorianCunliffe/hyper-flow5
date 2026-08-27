import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { actionRunStatusClasses, actionRunStatusLabel, communicationOutcomeFromOutput } from '../lib/actionRunPresentation';
import { NodeType } from '../types';

describe('action run presentation', () => {
  test('pending work is shown as waiting, never failed', () => {
    const run = { at: 1, status: 'pending' as const };
    assert.equal(actionRunStatusLabel(run, NodeType.PHONE_CALL), 'Waiting');
    assert.match(actionRunStatusClasses(run), /amber/);
  });

  test('failed voice dispositions are human-readable and preserve memory exclusion', () => {
    const output = {
      business_status: 'failed', disposition: 'wrong_number', successful: false,
      memory_eligible: false, failure_reason: 'The recipient said this was the wrong number'
    };
    const outcome = communicationOutcomeFromOutput(output);
    const run = { at: 1, status: 'error' as const, output, communicationOutcome: outcome };
    assert.equal(actionRunStatusLabel(run, NodeType.PHONE_CALL), 'Wrong number');
    assert.equal(outcome?.memoryEligible, false);
    assert.match(actionRunStatusClasses(run), /red/);
  });

  test('successful channel labels are specific', () => {
    const run = { at: 1, status: 'success' as const };
    assert.equal(actionRunStatusLabel(run, NodeType.SMS), 'Delivered');
    assert.equal(actionRunStatusLabel(run, NodeType.EMAIL), 'Sent');
    assert.equal(actionRunStatusLabel(run, NodeType.PHONE_CALL), 'Completed');
  });
});
