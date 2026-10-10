import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretAskResponse } from '../lib/triage/responseInterpreter';
import { replaceProvisionalCommunicationResponse, respondToAsk } from '../lib/asks/respondToAsk';
import type { HumanAsk } from '../types';
import { validateResponse } from '../lib/askResponses';
import { recordAskResponse } from '../lib/humanAsk';

const approvalAsk: HumanAsk = {
  id: 'ask_1', token: 'token_1', kind: 'approval', status: 'open', prompt: 'Approve this?',
  nodeId: 'task_1', assignees: ['reviewer@example.com'], channels: ['email'], createdAt: 1, responses: []
};

describe('conservative response interpretation', () => {
  test('Sharehouse voice answer has a declared output field and completes the question', async () => {
    const previous = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-only';
    try {
      const ask: HumanAsk = { ...approvalAsk, kind: 'question', fields: [
        { name: 'direct_booking_policy', label: 'Do we accept direct bookings, or must they go through listing sites?', type: 'string', required: true }
      ] };
      const text = "No, they have to go through the listing and we have to check them. There's no direct booking.";
      const response = await interpretAskResponse(ask, { via: 'voice', actor: 'caller', text }, async request => {
        const schema = request.config?.responseSchema as any;
        assert.equal(schema.properties.values.properties.direct_booking_policy.type, 'STRING');
        assert.match(schema.properties.values.properties.direct_booking_policy.description, /direct bookings/);
        assert.equal(schema.properties.values.required, undefined);
        assert.equal(schema.properties.decision, undefined);
        // Emulate schema-constrained generation: undeclared keys cannot appear.
        const values = Object.fromEntries(Object.keys(schema.properties.values.properties).map(key => [key, text]));
        return { text: JSON.stringify({ values, intent: 'answer', confidence: 0.95, evidence: text }) } as any;
      });
      assert.deepEqual(response.values, { direct_booking_policy: text });
      assert.equal(response.needsInterpretation, undefined);
      assert.equal(recordAskResponse(ask, response).status, 'answered');
    } finally {
      if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous;
    }
  });

  test('typed extraction preserves missing-answer and review safeguards', async () => {
    const previous = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-only';
    try {
      const ask: HumanAsk = { ...approvalAsk, kind: 'question', fields: [
        { name: 'available', type: 'boolean', required: true },
        { name: 'duration', type: 'number', required: true },
        { name: 'day', type: 'date' },
        { name: 'location', type: 'string', options: ['Martyn', 'Other'] },
        { name: 'attachment', type: 'file' }
      ] };
      for (const scenario of [
        { values: {}, confidence: 1, review: false },
        { values: { available: false }, confidence: 1, review: false },
        { values: { available: true, duration: 15 }, confidence: 0.5, review: false },
        { values: { available: true, duration: 15 }, confidence: 1, review: true }
      ]) {
        const current = { ...ask, responseContract: { reviewRequired: scenario.review } };
        const response = await interpretAskResponse(current, { via: 'voice', actor: 'caller', text: 'Recorded caller evidence' }, async request => {
          const properties = (request.config?.responseSchema as any).properties.values.properties;
          assert.equal(properties.available.type, 'BOOLEAN');
          assert.equal(properties.duration.type, 'NUMBER');
          assert.match(properties.day.description, /YYYY-MM-DD/);
          assert.deepEqual(properties.location.enum, ['Martyn', 'Other']);
          assert.equal(properties.attachment, undefined);
          return { text: JSON.stringify({ ...scenario, intent: 'answer', evidence: 'Recorded caller evidence' }) } as any;
        });
        assert.equal(recordAskResponse(current, response).status, 'open');
      }
    } finally {
      if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous;
    }
  });

  test('voice question extracts confirmed fields without accepting a model approval decision', async () => {
    const previous = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-only';
    try {
      const ask: HumanAsk = { ...approvalAsk, kind: 'question', fields: [
        { name: 'inspection', label: 'Confirmed inspection', type: 'string', required: true }
      ] };
      const result = await interpretAskResponse(ask, {
        via: 'voice', actor: 'staff', text: 'Yes, I confirm the test inspection at 80 Martyn Street at 3pm today.'
      }, async request => {
        assert.match(String(request.contents), /do not return a decision/);
        assert.equal((request.config?.responseSchema as { properties?: Record<string, unknown> })?.properties?.decision, undefined);
        return { text: JSON.stringify({ decision: 'approved', values: { inspection: '80 Martyn Street, 3pm today' }, confidence: 0.99, evidence: 'I confirm the test inspection' }) } as any;
      });
      assert.equal(result.decision, undefined);
      assert.deepEqual(result.values, { inspection: '80 Martyn Street, 3pm today' });
      assert.equal(result.needsInterpretation, undefined);
      assert.equal(validateResponse(ask, result), null);
    } finally {
      if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous;
    }
  });

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
