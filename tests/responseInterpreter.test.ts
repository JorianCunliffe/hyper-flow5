import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretAskResponse } from '../lib/triage/responseInterpreter';
import { replaceProvisionalCommunicationResponse, respondToAsk } from '../lib/asks/respondToAsk';
import type { HumanAsk } from '../types';

const approvalAsk: HumanAsk = {
  id: 'ask_1', token: 'token_1', kind: 'approval', status: 'open', prompt: 'Approve this?',
  nodeId: 'task_1', assignees: ['reviewer@example.com'], channels: ['email'], createdAt: 1, responses: []
};

describe('conservative response interpretation', () => {
  test('uses deterministic decision parsing before any model', async () => {
    const response = await interpretAskResponse(approvalAsk, { via: 'email', actor: 'reviewer@example.com', text: 'Approved' });
    assert.equal(response.decision, 'approved');
    assert.equal(response.needsInterpretation, undefined);
    assert.equal(response.modelVersion, undefined);
  });

  test('fails closed for ambiguous prose when no model is configured', async () => {
    const previous = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const response = await interpretAskResponse(approvalAsk, { via: 'email', actor: 'reviewer@example.com', text: 'I will think about it tomorrow.' });
      assert.equal(response.decision, undefined);
      assert.equal(response.needsInterpretation, true);
    } finally {
      if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous;
    }
  });

  test('verified review replaces rather than duplicates a provisional communication response', () => {
    const provisional = {
      id: 'response_1', at: 1, via: 'email' as const, actor: 'communications:email',
      communicationId: 'comm_1', decision: 'approved' as const, needsInterpretation: true
    };
    const ask = { ...approvalAsk, responses: [provisional] };
    const reviewed = replaceProvisionalCommunicationResponse(ask, {
      id: 'response_2', at: 2, via: 'web', actor: 'owner:uid', communicationId: 'comm_1', decision: 'approved'
    }, 'comm_1', true);
    assert.equal(reviewed.ask.responses.length, 0);
    assert.equal(reviewed.response.id, 'response_1');
    assert.equal(reviewed.response.needsInterpretation, undefined);
  });

  test('canonical response handling rejects an invalid decision before persistence', async () => {
    const outcome = await respondToAsk({
      orgId: 'org_1', projectId: 'project_1', askId: 'ask_1',
      response: { decision: 'maybe' as any }
    });
    assert.deepEqual(outcome, { ok: false, reason: 'invalid_decision' });
  });
});
