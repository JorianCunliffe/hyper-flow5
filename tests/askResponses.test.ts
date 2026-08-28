import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildResponse, coerceFieldValue, coerceValues, parseDecisionText, validateResponse } from '../lib/askResponses';
import { createApprovalAsk, createQuestionAsk } from '../lib/humanAsk';
import { HumanAsk, NodeType } from '../types';
import { action, openMilestone } from './helpers';

const approvalAsk = (): HumanAsk =>
  createApprovalAsk(
    action('R', NodeType.REPORT, {
      reviewPolicy: { required: true },
      actionConfig: { template: '', lastRun: { id: 'run_1', at: 1, status: 'success', output: { report_content: '# D' } } }
    })
  );

describe('parseDecisionText', () => {
  test('recognises plain approvals', () => {
    for (const t of ['yes', 'Y', 'approve', 'APPROVED', 'ok', 'lgtm', 'confirm', '1']) {
      assert.equal(parseDecisionText(t), 'approved', `expected "${t}" to approve`);
    }
  });

  test('recognises plain rejections', () => {
    for (const t of ['no', 'reject', 'Declined', 'deny', '3']) {
      assert.equal(parseDecisionText(t), 'rejected', `expected "${t}" to reject`);
    }
  });

  test('recognises revision requests', () => {
    for (const t of ['revise', 'redo', 'changes', 'rework', '2']) {
      assert.equal(parseDecisionText(t), 'revise', `expected "${t}" to request revision`);
    }
  });

  test('tolerates trailing punctuation and whitespace', () => {
    assert.equal(parseDecisionText('  Yes.  '), 'approved');
    assert.equal(parseDecisionText('no!'), 'rejected');
  });

  test('reads a leading keyword followed by explanation', () => {
    assert.equal(parseDecisionText('revise - the pricing section is wrong'), 'revise');
    assert.equal(parseDecisionText('reject: we lost the deal'), 'rejected');
  });

  test('does NOT approve prose that merely contains a command word', () => {
    // The failure mode this guards: approving work nobody approved.
    assert.equal(parseDecisionText('no problem, looks great'), undefined);
    assert.equal(parseDecisionText('I have no objection but check the numbers'), undefined);
    assert.equal(parseDecisionText('yesterday I looked at this'), undefined);
    assert.equal(parseDecisionText('ok so the issue is the third paragraph'), undefined);
  });

  test('returns nothing for empty or missing input', () => {
    assert.equal(parseDecisionText(undefined), undefined);
    assert.equal(parseDecisionText(''), undefined);
    assert.equal(parseDecisionText('   '), undefined);
  });
});

describe('coerceFieldValue', () => {
  test('coerces booleans from natural replies', () => {
    assert.equal(coerceFieldValue({ name: 'x', type: 'boolean' }, 'yes'), true);
    assert.equal(coerceFieldValue({ name: 'x', type: 'boolean' }, 'NO'), false);
    assert.equal(coerceFieldValue({ name: 'x', type: 'boolean' }, true), true);
    assert.equal(coerceFieldValue({ name: 'x', type: 'boolean' }, 'maybe'), undefined);
  });

  test('coerces numbers and rejects junk', () => {
    assert.equal(coerceFieldValue({ name: 'x', type: 'number' }, '42'), 42);
    assert.equal(coerceFieldValue({ name: 'x', type: 'number' }, 'lots'), undefined);
    assert.equal(coerceFieldValue({ name: 'x', type: 'number' }, ''), undefined);
  });

  test('normalises dates to ISO day strings', () => {
    assert.equal(coerceFieldValue({ name: 'x', type: 'date' }, '2026-03-04'), '2026-03-04');
    assert.equal(coerceFieldValue({ name: 'x', type: 'date' }, 'not a date'), undefined);
  });

  test('trims strings', () => {
    assert.equal(coerceFieldValue({ name: 'x', type: 'string' }, '  hi  '), 'hi');
  });
});

describe('coerceValues', () => {
  test('keeps only fields declared in the schema', () => {
    const ask = createQuestionAsk(openMilestone('N'), ['site_address']);
    const out = coerceValues(ask, { site_address: '12 Main St', injected: 'nope' });
    assert.deepEqual(out, { site_address: '12 Main St' });
  });

  test('drops fields that fail coercion rather than writing junk', () => {
    const ask: HumanAsk = { ...createQuestionAsk(openMilestone('N'), ['n']), fields: [{ name: 'n', type: 'number', required: true }] };
    assert.deepEqual(coerceValues(ask, { n: 'abc' }), {});
  });

  test('without a schema, accepts scalars only', () => {
    const ask: HumanAsk = { ...approvalAsk(), fields: undefined };
    const out = coerceValues(ask, { a: 1, b: 'two', c: true, d: { nested: 'object' }, e: ['array'] });
    assert.deepEqual(out, { a: 1, b: 'two', c: true }, 'nested structures must not reach project data');
  });

  test('tolerates junk input', () => {
    assert.deepEqual(coerceValues(approvalAsk(), undefined), {});
    assert.deepEqual(coerceValues(approvalAsk(), 'nope' as any), {});
  });
});

describe('buildResponse', () => {
  test('an explicit decision is used as given', () => {
    const r = buildResponse(approvalAsk(), { via: 'web', actor: 'jorian', decision: 'approved' });
    assert.equal(r.decision, 'approved');
    assert.equal(r.needsInterpretation, undefined);
  });

  test('an approval ask reads a decision from reply text', () => {
    const r = buildResponse(approvalAsk(), { via: 'sms', actor: '+61400000000', text: 'yes' });
    assert.equal(r.decision, 'approved');
    assert.equal(r.needsInterpretation, undefined);
  });

  test('unclassifiable prose is flagged rather than guessed', () => {
    const r = buildResponse(approvalAsk(), { via: 'email', actor: 'jorian@x.com', text: 'Looks fine but check section 3' });
    assert.equal(r.decision, undefined);
    assert.equal(r.needsInterpretation, true, 'a human must look at this rather than it being auto-resolved');
    assert.equal(r.text, 'Looks fine but check section 3', 'the original words are preserved');
  });

  test('a question ask answered with values is not flagged', () => {
    const ask = createQuestionAsk(openMilestone('N'), ['site_address']);
    const r = buildResponse(ask, { via: 'web', actor: 'jorian', values: { site_address: '12 Main St' } });
    assert.deepEqual(r.values, { site_address: '12 Main St' });
    assert.equal(r.needsInterpretation, undefined);
  });

  test('a question ask answered with only prose is flagged for interpretation', () => {
    const ask = createQuestionAsk(openMilestone('N'), ['site_address']);
    const r = buildResponse(ask, { via: 'email', actor: 'jorian', text: "it's the one on the corner" });
    assert.equal(r.needsInterpretation, true);
  });

  test('an upload answered with a file is not flagged', () => {
    const ask: HumanAsk = { ...createQuestionAsk(openMilestone('N'), []), kind: 'upload', fields: [] };
    const r = buildResponse(ask, {
      via: 'email',
      actor: 'jorian',
      text: 'attached',
      attachments: [{ id: 'f1', url: 'https://x/y.pdf', kind: 'document', source: 'email', capturedAt: 1 }]
    });
    assert.equal(r.needsInterpretation, undefined);
  });

  test('records the channel and actor it actually came from', () => {
    const r = buildResponse(approvalAsk(), { via: 'voice', actor: '+61400000000', decision: 'approved' });
    assert.equal(r.via, 'voice');
    assert.equal(r.actor, '+61400000000');
  });
});

describe('validateResponse', () => {
  test('sending work back requires a comment', () => {
    const ask = approvalAsk();
    const bare = buildResponse(ask, { via: 'web', actor: 'jorian', decision: 'revise' });
    assert.match(validateResponse(ask, bare)!, /requires a comment/);

    const withReason = buildResponse(ask, { via: 'web', actor: 'jorian', decision: 'revise', text: 'trim section 3' });
    assert.equal(validateResponse(ask, withReason), null);
  });

  test('whitespace does not count as a comment', () => {
    const ask = approvalAsk();
    const r = buildResponse(ask, { via: 'web', actor: 'jorian', decision: 'revise', text: '   ' });
    assert.ok(validateResponse(ask, r));
  });

  test('an approval ask needs a decision', () => {
    const ask = approvalAsk();
    const r = { ...buildResponse(ask, { via: 'web', actor: 'jorian', decision: 'approved' }), decision: undefined };
    assert.match(validateResponse(ask, r)!, /decision is required/i);
  });

  test('a response flagged for interpretation is allowed through to be recorded', () => {
    const ask = approvalAsk();
    const r = buildResponse(ask, { via: 'email', actor: 'jorian', text: 'hmm, not sure' });
    assert.equal(validateResponse(ask, r), null);
  });

  test('a question ask does not require a decision', () => {
    const ask = createQuestionAsk(openMilestone('N'), ['x']);
    const r = buildResponse(ask, { via: 'web', actor: 'jorian', values: { x: 'y' } });
    assert.equal(validateResponse(ask, r), null);
  });

  test('a decision cannot answer a question ask', () => {
    const ask = createQuestionAsk(openMilestone('N'), ['x']);
    const r = buildResponse(ask, { via: 'web', actor: 'jorian', decision: 'approved' });
    assert.match(validateResponse(ask, r)!, /only valid for an approval Ask/);
  });
});
