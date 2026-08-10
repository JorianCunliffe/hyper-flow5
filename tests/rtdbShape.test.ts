import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAskToProject,
  collectAttachments,
  collectValues,
  isReviewSatisfied,
  latestDecision,
  needsApprovalAsk,
  normalizeAsk,
  normalizeNodeAsks,
  openAsks,
  recordAskResponse
} from '../lib/humanAsk';
import { advanceFlow, isNodeComplete } from '../lib/flowEngine';
import { HumanAsk, NodeType } from '../types';
import { action, project } from './helpers';

/**
 * Firebase RTDB does not store empty arrays — it drops the key entirely — and
 * stores sparse arrays as objects keyed by index. Anything round-tripped through
 * the database therefore comes back a different shape from what was written.
 *
 * This is not hypothetical: it crashed every one of these paths the first time
 * the code ran against a real database, because a newly created ask always has
 * `responses: []`, which RTDB silently discards.
 */

/** An ask as RTDB hands it back: empty arrays gone, populated ones as objects. */
const asRtdbReturnsIt = (): any => ({
  id: 'ask_1',
  token: 'tok_1',
  kind: 'approval',
  status: 'open',
  prompt: 'Review it',
  nodeId: 'REPORT',
  runId: 'run_1',
  createdAt: 1
  // responses, assignees, channels: all absent, because they were empty
});

const withObjectArrays = (): any => ({
  ...asRtdbReturnsIt(),
  // RTDB returns populated arrays as index-keyed objects
  responses: { '0': { id: 'r1', at: 5, via: 'web', actor: 'jorian', decision: 'approved' } },
  assignees: { '0': 'Jorian' },
  channels: { '0': 'web' }
});

describe('asks read back from RTDB', () => {
  test('latestDecision survives a missing responses array', () => {
    assert.equal(latestDecision(asRtdbReturnsIt()), undefined);
  });

  test('collectValues and collectAttachments survive it too', () => {
    assert.deepEqual(collectValues(asRtdbReturnsIt()), {});
    assert.deepEqual(collectAttachments(asRtdbReturnsIt()), []);
  });

  test('recordAskResponse can answer an ask that came back without responses', () => {
    const updated = recordAskResponse(asRtdbReturnsIt(), {
      id: 'r1', at: 10, via: 'web', actor: 'jorian', decision: 'approved'
    });
    assert.equal(updated.status, 'answered');
    assert.equal(updated.responses.length, 1);
  });

  test('a node gated on such an ask can still be evaluated', () => {
    const node = action('REPORT', NodeType.REPORT, {
      reviewPolicy: { required: true },
      actionConfig: { template: '', lastRun: { id: 'run_1', at: 1, status: 'success' } },
      asks: [asRtdbReturnsIt()]
    });
    assert.equal(isReviewSatisfied(node), false);
    assert.equal(needsApprovalAsk(node), false, 'the open ask is still recognised');
    assert.equal(isNodeComplete(node), false);
  });

  test('advanceFlow does not throw on a project loaded from RTDB', () => {
    const node = action('REPORT', NodeType.REPORT, {
      reviewPolicy: { required: true },
      actionConfig: { template: '', lastRun: { id: 'run_1', at: 1, status: 'success' } },
      asks: [asRtdbReturnsIt()]
    });
    const result = advanceFlow(project([node]));
    assert.deepEqual(result.asksToOpen, [], 'the existing open ask suppresses a duplicate');
  });

  test('applyAskToProject tolerates the shape', () => {
    const answered = { ...asRtdbReturnsIt(), status: 'answered', responses: undefined } as HumanAsk;
    const node = action('REPORT', NodeType.REPORT, { asks: [answered] });
    const next = applyAskToProject(project([node]), 'ask_1');
    assert.ok(next.milestones[0].asks![0].appliedAt, 'applied without throwing');
  });

  test('openAsks lists an ask with no responses key', () => {
    const node = action('REPORT', NodeType.REPORT, { asks: [asRtdbReturnsIt()] });
    assert.deepEqual(openAsks(project([node])).map(o => o.ask.id), ['ask_1']);
  });
});

describe('normalizeAsk', () => {
  test('restores missing arrays as empty ones', () => {
    const n = normalizeAsk(asRtdbReturnsIt());
    assert.deepEqual(n.responses, []);
    assert.deepEqual(n.assignees, []);
    assert.deepEqual(n.channels, []);
  });

  test('converts index-keyed objects back into arrays', () => {
    const n = normalizeAsk(withObjectArrays());
    assert.ok(Array.isArray(n.responses));
    assert.equal(n.responses.length, 1);
    assert.equal(n.responses[0].decision, 'approved');
    assert.deepEqual(n.assignees, ['Jorian']);
    assert.deepEqual(n.channels, ['web']);
  });

  test('normalises attachments nested inside responses', () => {
    const n = normalizeAsk({
      ...asRtdbReturnsIt(),
      responses: { '0': { id: 'r1', at: 1, via: 'email', actor: 'x', attachments: { '0': { id: 'f1', url: 'u', kind: 'document', source: 'email', capturedAt: 1 } } } }
    });
    assert.ok(Array.isArray(n.responses[0].attachments));
    assert.equal(n.responses[0].attachments!.length, 1);
  });

  test('leaves absent optional schemas absent rather than inventing empty ones', () => {
    const n = normalizeAsk(asRtdbReturnsIt());
    assert.equal(n.fields, undefined, 'an approval ask has no fields — do not fabricate an empty list');
    assert.equal(n.writeBack, undefined);
  });

  test('an already-correct ask round-trips unchanged in value', () => {
    const good: any = { ...asRtdbReturnsIt(), responses: [], assignees: ['Jorian'], channels: ['web'] };
    const n = normalizeAsk(good);
    assert.deepEqual(n.responses, []);
    assert.deepEqual(n.assignees, ['Jorian']);
  });

  test('normalizeNodeAsks leaves a node with no asks untouched', () => {
    const node = action('A');
    assert.equal(normalizeNodeAsks(node), node, 'same reference — no needless copying');
  });

  test('normalizeNodeAsks converts an index-keyed asks object', () => {
    const node: any = { ...action('A'), asks: { '0': asRtdbReturnsIt() } };
    const n = normalizeNodeAsks(node);
    assert.ok(Array.isArray(n.asks));
    assert.deepEqual(n.asks[0].responses, []);
  });
});
