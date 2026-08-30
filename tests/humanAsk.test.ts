import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAskToProject,
  artifactFromRun,
  collectValues,
  createApprovalAsk,
  createQuestionAsk,
  findAskByToken,
  isApproved,
  isOverdue,
  isReviewSatisfied,
  latestDecision,
  needsApprovalAsk,
  newAskToken,
  openAsks,
  recordAskResponse,
  upsertAsk
} from '../lib/humanAsk';
import { advanceFlow, isAwaitingReview, isNodeComplete, isNodeWorkDone } from '../lib/flowEngine';
import { HumanAsk, HumanResponse, Milestone, NodeType } from '../types';
import { action, doneMilestone, node, openMilestone, project, resetSeq, subtask } from './helpers';

beforeEach(resetSeq);

const reply = (overrides: Partial<HumanResponse> = {}): HumanResponse => ({
  id: 'resp_1',
  at: 1000,
  via: 'web',
  actor: 'jorian@example.com',
  ...overrides
});

const reviewedAction = (overrides: Partial<Milestone> = {}): Milestone =>
  action('REPORT', NodeType.REPORT, {
    reviewPolicy: { required: true, reviewers: ['Jorian'] },
    actionConfig: {
      template: '',
      lastRun: { id: 'run_1', at: 1, status: 'success', output: { report_content: '# Draft' } }
    },
    ...overrides
  });

describe('newAskToken', () => {
  test('generates distinct, non-trivial tokens', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => newAskToken()));
    assert.equal(tokens.size, 100);
    for (const t of tokens) assert.ok(t.length >= 20, `token too short: ${t}`);
  });
});

describe('review gating', () => {
  test('a node with no review policy is unaffected', () => {
    const n = action('A', NodeType.EMAIL, { actionConfig: { template: '', lastRun: { id: 'r', at: 1, status: 'success' } } });
    assert.equal(isNodeComplete(n), true);
    assert.equal(needsApprovalAsk(n), false);
  });

  test('successful work with a required review is NOT complete', () => {
    const n = reviewedAction();
    assert.equal(isNodeWorkDone(n), true);
    assert.equal(isNodeComplete(n), false, 'the flow must not run past an unreviewed node');
    assert.equal(isAwaitingReview(n), true);
    assert.equal(needsApprovalAsk(n), true);
  });

  test('an approved ask for the current run completes the node', () => {
    let n = reviewedAction();
    const ask = { ...createApprovalAsk(n), id: 'a1' };
    n = upsertAsk(n, recordAskResponse(ask, reply({ decision: 'approved' })));
    assert.equal(isNodeComplete(n), true);
    assert.equal(needsApprovalAsk(n), false);
  });

  test('an approval from an EARLIER run does not satisfy the current run', () => {
    let n = reviewedAction();
    const staleAsk = recordAskResponse({ ...createApprovalAsk(n), id: 'a1' }, reply({ decision: 'approved' }));
    n = upsertAsk(n, staleAsk);
    assert.equal(isNodeComplete(n), true);

    // The node re-runs (e.g. a loop iteration). New run id, same node.
    n = { ...n, actionConfig: { ...n.actionConfig!, lastRun: { id: 'run_2', at: 2, status: 'success' } } };
    assert.equal(isNodeComplete(n), false, 'stale sign-off must not approve new work');
    assert.equal(needsApprovalAsk(n), true, 'a fresh review is required');
  });

  test('an open ask does not satisfy the gate but suppresses a duplicate ask', () => {
    const n = upsertAsk(reviewedAction(), createApprovalAsk(reviewedAction()));
    assert.equal(isNodeComplete(n), false);
    assert.equal(needsApprovalAsk(n), false, 'do not pester the reviewer with a second ask');
  });

  test('a rejection keeps the gate shut and stops re-asking', () => {
    let n = reviewedAction();
    n = upsertAsk(n, recordAskResponse(createApprovalAsk(n), reply({ decision: 'rejected' })));
    assert.equal(isNodeComplete(n), false);
    assert.equal(needsApprovalAsk(n), false);
  });

  test('a milestone node can be gated too', () => {
    let m = doneMilestone('M', { reviewPolicy: { required: true, reviewers: ['Kiera'] } });
    assert.equal(isNodeWorkDone(m), true);
    assert.equal(isNodeComplete(m), false);
    m = upsertAsk(m, recordAskResponse(createApprovalAsk(m), reply({ decision: 'approved' })));
    assert.equal(isNodeComplete(m), true);
  });

  test('work that is not done raises no ask, however strict the policy', () => {
    const m = openMilestone('M', { reviewPolicy: { required: true } });
    assert.equal(isNodeWorkDone(m), false);
    assert.equal(needsApprovalAsk(m), true, 'the policy is unmet...');
    // advanceFlow is what gates on work actually being finished.
    const { asksToOpen } = advanceFlow(project([m]));
    assert.deepEqual(asksToOpen, [], '...but no ask is raised until there is something to review');
  });

  test('a conditional review gate opens only when project data matches', () => {
    const n = reviewedAction({
      reviewPolicy: { required: true, when: [{ variable: 'coaching_requires_review', equals: true }] }
    });
    assert.equal(isNodeComplete(n, { coaching_requires_review: false }), true);
    assert.equal(needsApprovalAsk(n, { coaching_requires_review: false }), false);
    assert.equal(isNodeComplete(n, { coaching_requires_review: true }), false);
    assert.equal(needsApprovalAsk(n, { coaching_requires_review: true }), true);

    const safe = advanceFlow(project([n], { coaching_requires_review: false } as any));
    assert.deepEqual(safe.asksToOpen, []);
    const held = advanceFlow(project([n], { coaching_requires_review: true } as any));
    assert.deepEqual(held.asksToOpen, [n.id]);
  });
});

describe('expiry policy', () => {
  const overdueAsk = (n: Milestone): HumanAsk => ({ ...createApprovalAsk(n), dueAt: Date.now() - 1000 });

  test('an overdue ask is reported as overdue', () => {
    assert.equal(isOverdue(overdueAsk(reviewedAction())), true);
  });

  test('the default (block) keeps the gate shut past the due date', () => {
    const n = upsertAsk(reviewedAction(), overdueAsk(reviewedAction()));
    assert.equal(isNodeComplete(n), false, 'silence must not be read as approval');
  });

  test('escalate also keeps the gate shut', () => {
    const base = reviewedAction({ reviewPolicy: { required: true, onExpiry: 'escalate' } });
    const n = upsertAsk(base, overdueAsk(base));
    assert.equal(isNodeComplete(n), false);
  });

  test('auto_approve releases the gate only when explicitly opted into', () => {
    const base = reviewedAction({ reviewPolicy: { required: true, onExpiry: 'auto_approve' } });
    const n = upsertAsk(base, overdueAsk(base));
    assert.equal(isNodeComplete(n), true);
  });

  test('auto_approve does not release a gate that is not yet overdue', () => {
    const base = reviewedAction({ reviewPolicy: { required: true, onExpiry: 'auto_approve', slaHours: 24 } });
    const n = upsertAsk(base, createApprovalAsk(base));
    assert.equal(isNodeComplete(n), false);
  });
});

describe('recordAskResponse', () => {
  test('a decision answers the ask', () => {
    const ask = recordAskResponse(createApprovalAsk(reviewedAction()), reply({ decision: 'approved' }));
    assert.equal(ask.status, 'answered');
    assert.equal(ask.answeredAt, 1000);
    assert.equal(isApproved(ask), true);
  });

  test('the most recent decision wins', () => {
    let ask = recordAskResponse(createApprovalAsk(reviewedAction()), reply({ decision: 'revise' }));
    ask = recordAskResponse(ask, reply({ id: 'resp_2', at: 2000, decision: 'approved' }));
    assert.equal(latestDecision(ask), 'approved');
  });

  test('a response needing interpretation never closes the ask on its own', () => {
    const ask = recordAskResponse(
      createApprovalAsk(reviewedAction()),
      reply({ decision: 'approved', needsInterpretation: true, confidence: 0.3 })
    );
    assert.equal(ask.status, 'open', 'a low-confidence parse must not sign work off');
    assert.equal(ask.responses.length, 1, 'but the response is still recorded for a human to look at');
  });

  test('a question ask closes only once every required field is supplied', () => {
    const n = openMilestone('N');
    let ask = createQuestionAsk(n, ['site_address', 'lot_number']);

    ask = recordAskResponse(ask, reply({ values: { site_address: '12 Main St' } }));
    assert.equal(ask.status, 'open', 'still missing lot_number');

    ask = recordAskResponse(ask, reply({ id: 'r2', at: 2000, values: { lot_number: '7' } }));
    assert.equal(ask.status, 'answered');
    assert.deepEqual(collectValues(ask), { site_address: '12 Main St', lot_number: '7' });
  });

  test('an empty string does not count as answering a required field', () => {
    const ask = recordAskResponse(createQuestionAsk(openMilestone('N'), ['x']), reply({ values: { x: '' } }));
    assert.equal(ask.status, 'open');
  });

  test('an upload ask needs an actual file', () => {
    const base: HumanAsk = { ...createQuestionAsk(openMilestone('N'), []), kind: 'upload', fields: [] };
    let ask = recordAskResponse(base, reply({ text: 'here you go' }));
    assert.equal(ask.status, 'open');

    ask = recordAskResponse(base, reply({
      attachments: [{ id: 'f1', url: 'https://x/y.pdf', kind: 'document', source: 'email', capturedAt: 1 }]
    }));
    assert.equal(ask.status, 'answered');
  });
});

describe('createQuestionAsk', () => {
  test('derives its schema from the variables the node is blocked on', () => {
    const ask = createQuestionAsk(openMilestone('Survey'), ['site_address', 'lot_number']);
    assert.equal(ask.kind, 'question');
    assert.deepEqual(ask.fields!.map(f => f.name), ['site_address', 'lot_number']);
    assert.equal(ask.fields![0].label, 'Site Address', 'humanised for the form and the email');
    assert.ok(ask.fields!.every(f => f.required));
    assert.match(ask.prompt, /site_address, lot_number/);
  });

  test('maps each variable into a write-back so answers reach project data', () => {
    const ask = createQuestionAsk(openMilestone('N'), ['a', 'b']);
    assert.deepEqual(ask.writeBack!.map(w => w.name), ['a', 'b']);
  });

  test('phrases a single missing detail in the singular', () => {
    assert.match(createQuestionAsk(openMilestone('N'), ['x']).prompt, /one detail/);
  });
});

describe('artifactFromRun', () => {
  test('renders a report as markdown and carries the model self-evaluation', () => {
    const n = action('R', NodeType.REPORT, {
      actionConfig: {
        template: '',
        lastRun: { id: 'r', at: 1, status: 'success', output: { report_content: '# Hi', evaluation: { passes_criteria: false } } }
      }
    });
    const art = artifactFromRun(n)!;
    assert.equal(art.kind, 'markdown');
    assert.equal(art.content, '# Hi');
    assert.deepEqual(art.evaluation, { passes_criteria: false });
  });

  test('includes the prior draft so a re-review can show what changed', () => {
    const n = action('R', NodeType.REPORT, {
      actionConfig: {
        template: '',
        revision: { feedback: 'too long', priorOutput: { report_content: '# Old' }, at: 1, count: 1 },
        lastRun: { id: 'r', at: 2, status: 'success', output: { report_content: '# New' } }
      }
    });
    assert.equal(artifactFromRun(n)!.previousContent, '# Old');
  });

  test('renders a call outcome as readable text with the recording', () => {
    const n = action('C', NodeType.PHONE_CALL, {
      actionConfig: {
        template: '',
        lastRun: { id: 'r', at: 1, status: 'success', output: { call_summary: 'Keen', call_recording_url: 'https://x/r.mp3' } }
      }
    });
    const art = artifactFromRun(n)!;
    assert.equal(art.kind, 'text');
    assert.match(art.content!, /Keen/);
    assert.equal(art.url, 'https://x/r.mp3');
  });

  test('falls back to pretty JSON for anything else', () => {
    const n = action('W', NodeType.WEBHOOK, {
      actionConfig: { template: '', lastRun: { id: 'r', at: 1, status: 'success', output: { webhook_status: 200 } } }
    });
    assert.equal(artifactFromRun(n)!.kind, 'json');
  });

  test('a node that has not run has no artifact', () => {
    assert.equal(artifactFromRun(action('A')), undefined);
  });
});

describe('applyAskToProject', () => {
  const projectWithAsk = (ask: HumanAsk, nodeOverrides: Partial<Milestone> = {}) =>
    project([upsertAsk(reviewedAction(nodeOverrides), ask)], { existing: 1 });

  test('an approved question ask writes its values into project data', () => {
    const ask = recordAskResponse(
      { ...createQuestionAsk(openMilestone('N'), ['site_address']), nodeId: 'REPORT', id: 'a1' },
      reply({ values: { site_address: '12 Main St' } })
    );
    const next = applyAskToProject(projectWithAsk(ask), 'a1');
    assert.equal(next.projectData!.site_address, '12 Main St');
    assert.equal(next.projectData!.existing, 1, 'existing data is preserved');
  });

  test('applying is idempotent — a second call is a no-op', () => {
    const ask = recordAskResponse(
      { ...createQuestionAsk(openMilestone('N'), ['x']), nodeId: 'REPORT', id: 'a1' },
      reply({ values: { x: 'first' } })
    );
    const once = applyAskToProject(projectWithAsk(ask), 'a1');
    const applied = once.milestones[0].asks!.find(a => a.id === 'a1')!;
    assert.ok(applied.appliedAt);

    const twice = applyAskToProject({ ...once, projectData: { ...once.projectData, x: 'edited since' } }, 'a1');
    assert.equal(twice.projectData!.x, 'edited since', 'a replay must not overwrite later edits');
  });

  test('an unanswered ask is not applied', () => {
    const ask = { ...createQuestionAsk(openMilestone('N'), ['x']), nodeId: 'REPORT', id: 'a1' };
    const next = applyAskToProject(projectWithAsk(ask), 'a1');
    assert.equal(next.projectData!.x, undefined);
  });

  test('a rejection writes nothing', () => {
    const ask = recordAskResponse(
      { ...createApprovalAsk(reviewedAction()), id: 'a1', writeBack: [{ name: 'signed_off', type: 'boolean', write_on: 'approval', value_source: 'static', value: true }] },
      reply({ decision: 'rejected' })
    );
    const next = applyAskToProject(projectWithAsk(ask), 'a1');
    assert.equal(next.projectData!.signed_off, undefined);
  });

  test('a static write-back fires on approval', () => {
    const ask = recordAskResponse(
      { ...createApprovalAsk(reviewedAction()), id: 'a1', writeBack: [{ name: 'signed_off', type: 'boolean', write_on: 'approval', value_source: 'static', value: true }] },
      reply({ decision: 'approved' })
    );
    assert.equal(applyAskToProject(projectWithAsk(ask), 'a1').projectData!.signed_off, true);
  });

  describe('revision', () => {
    const revised = () => {
      const ask = recordAskResponse(
        { ...createApprovalAsk(reviewedAction()), id: 'a1' },
        reply({ decision: 'revise', text: 'Too long, and the pricing section is wrong.' })
      );
      return applyAskToProject(projectWithAsk(ask), 'a1');
    };

    test("captures the reviewer's comment as the instruction for the next run", () => {
      const cfg = revised().milestones[0].actionConfig!;
      assert.equal(cfg.revision!.feedback, 'Too long, and the pricing section is wrong.');
      assert.equal(cfg.revision!.count, 1);
    });

    test('re-arms the node so the flow runs it again', () => {
      const cfg = revised().milestones[0].actionConfig!;
      assert.equal(cfg.lastRun, undefined, 'clearing lastRun re-opens the node');
      assert.deepEqual(cfg.runHistory!.map(r => r.id), ['run_1'], 'the rejected draft is kept');
      assert.equal(cfg.revision!.priorOutput.report_content, '# Draft', 'the rejected draft feeds the redo');
    });

    test('does not write the reviewer comment into project data', () => {
      assert.equal(revised().projectData!.existing, 1);
      assert.equal(Object.keys(revised().projectData!).length, 1);
    });

    test('a second revision increments the counter', () => {
      const first = revised();
      const node2 = first.milestones[0];
      const ask2 = recordAskResponse({ ...createApprovalAsk(node2), id: 'a2' }, reply({ decision: 'revise', text: 'still too long' }));
      const second = applyAskToProject({ ...first, milestones: [upsertAsk(node2, ask2)] }, 'a2');
      assert.equal(second.milestones[0].actionConfig!.revision!.count, 2);
    });
  });
});

describe('ask lookup', () => {
  test('finds an ask by its token', () => {
    const ask = { ...createApprovalAsk(reviewedAction()), id: 'a1', token: 'tok_123' };
    const p = project([upsertAsk(reviewedAction(), ask)]);
    assert.equal(findAskByToken(p, 'tok_123')!.ask.id, 'a1');
    assert.equal(findAskByToken(p, 'nope'), undefined);
  });

  test('openAsks lists only what is still awaiting a person', () => {
    const open = { ...createApprovalAsk(reviewedAction()), id: 'a1' };
    const done = recordAskResponse({ ...createApprovalAsk(reviewedAction()), id: 'a2' }, reply({ decision: 'approved' }));
    const p = project([upsertAsk(upsertAsk(reviewedAction(), open), done)]);
    assert.deepEqual(openAsks(p).map(o => o.ask.id), ['a1']);
  });
});

describe('advanceFlow with review gates', () => {
  test('raises an ask for a node whose work is done and gated', () => {
    const { asksToOpen } = advanceFlow(project([reviewedAction()]));
    assert.deepEqual(asksToOpen, ['REPORT']);
  });

  test('does not raise an ask on a skipped branch', () => {
    const p = project([
      node('D', {
        nodeType: NodeType.DECISION,
        decisionConfig: { branches: [{ targetId: 'YES', label: 'Y' }, { targetId: 'NO', label: 'N' }], selectedTargetId: 'YES' }
      }),
      doneMilestone('YES', { dependsOn: ['D'] }),
      doneMilestone('NO', { dependsOn: ['D'], reviewPolicy: { required: true } })
    ]);
    const { asksToOpen } = advanceFlow(p);
    assert.deepEqual(asksToOpen, [], 'nobody should review work on a branch never taken');
  });

  test('a gated node blocks its dependents until approved', () => {
    const gated = reviewedAction();
    const p = project([gated, openMilestone('NEXT', { dependsOn: ['REPORT'] })]);

    const before = advanceFlow(p);
    assert.equal(isNodeComplete(before.project.milestones[0]), false);

    const approved = upsertAsk(gated, recordAskResponse(createApprovalAsk(gated), reply({ decision: 'approved' })));
    const after = advanceFlow(project([approved, openMilestone('NEXT', { dependsOn: ['REPORT'] })]));
    assert.equal(isNodeComplete(after.project.milestones[0]), true);
  });

  test('a loop iteration cancels prior sign-off so the new output is reviewed afresh', () => {
    const approved = upsertAsk(
      doneMilestone('BODY', { reviewPolicy: { required: true } }),
      recordAskResponse(createApprovalAsk(doneMilestone('BODY', { reviewPolicy: { required: true } })), reply({ decision: 'approved' }))
    );
    const p = project(
      [
        approved,
        node('L', {
          dependsOn: ['BODY'],
          nodeType: NodeType.LOOP,
          loopConfig: { loopStartId: 'BODY', exitConditions: [{ variable: 'done', equals: true }], maxIterations: 3, currentIteration: 0 }
        })
      ],
      { done: false }
    );

    const { project: next } = advanceFlow(p);
    const body = next.milestones.find(m => m.id === 'BODY')!;
    assert.ok(body.asks!.every(a => a.status === 'cancelled'), 'the old approval is retired, not reused');
    assert.equal(isNodeComplete(body), false);
  });
});
