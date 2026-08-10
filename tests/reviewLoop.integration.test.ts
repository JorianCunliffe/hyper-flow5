import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ActionExecutor, advanceProjectFlow } from '../lib/flowOrchestrator';
import { applyAskToProject, recordAskResponse, upsertAsk } from '../lib/humanAsk';
import { buildResponse } from '../lib/askResponses';
import { isNodeComplete } from '../lib/flowEngine';
import { HumanAsk, NodeType, Project } from '../types';
import { action, openMilestone, project } from './helpers';

/**
 * The full agent-to-human handover loop:
 *
 *   agent produces work -> flow blocks -> human sees it and asks for changes
 *   -> agent redoes it with that feedback -> human approves -> flow continues
 *
 * This is the behaviour the whole design exists to support, so it is worth
 * asserting end to end rather than only in pieces.
 */

const reportFlow = (): Project =>
  project([
    action('REPORT', NodeType.REPORT, {
      reviewPolicy: { required: true, reviewers: ['Jorian'] },
      actionConfig: { template: '{"prompt": "Write the status report"}', autoExecute: true }
    }),
    openMilestone('SEND', { dependsOn: ['REPORT'] })
  ]);

/** Returns successive drafts and records the revision context it was given. */
const draftingExecutor = () => {
  const seen: any[] = [];
  let n = 0;
  const fn: ActionExecutor = async (_taskType, _template, _data, ctx) => {
    seen.push(ctx.revision);
    n += 1;
    return {
      status: 'success',
      output: {
        report_written: true,
        report_content: `# Draft ${n}`,
        evaluation: { passes_criteria: true, evaluation: 'Looks fine to me', revisions_needed: [] }
      }
    };
  };
  return { fn, seen };
};

const openAskOn = (p: Project, nodeId: string): HumanAsk => {
  const ask = p.milestones.find(m => m.id === nodeId)!.asks!.find(a => a.status === 'open');
  assert.ok(ask, `expected an open ask on ${nodeId}`);
  return ask!;
};

/** Answers an ask the way the UI or an inbound channel would. */
const answer = (p: Project, ask: HumanAsk, input: { decision?: any; text?: string }): Project => {
  const response = buildResponse(ask, { via: 'web', actor: 'jorian@example.com', ...input });
  const updated = recordAskResponse(ask, response);
  const withResponse = {
    ...p,
    milestones: p.milestones.map(m => (m.id === ask.nodeId ? upsertAsk(m, updated) : m))
  };
  return updated.status === 'answered' ? applyAskToProject(withResponse, updated.id) : withResponse;
};

describe('review and revision loop', () => {
  test('work is produced, held for review, sent back, redone, then approved', async () => {
    const { fn, seen } = draftingExecutor();

    // 1. The agent writes the report — and the flow stops dead at the gate.
    let p = (await advanceProjectFlow(reportFlow(), fn)).project;
    assert.equal(seen.length, 1);
    assert.equal(seen[0], undefined, 'the first attempt has no reviewer feedback');

    let node = p.milestones.find(m => m.id === 'REPORT')!;
    assert.equal(node.actionConfig!.lastRun!.status, 'success', 'the work itself succeeded...');
    assert.equal(isNodeComplete(node), false, '...but the node is not complete until a person signs it off');
    assert.equal(
      p.milestones.find(m => m.id === 'SEND')!.subtasks[0].status,
      'Not started',
      'downstream work must not start on unreviewed output'
    );

    // 2. The reviewer sees the draft and sends it back.
    const firstAsk = openAskOn(p, 'REPORT');
    assert.equal(firstAsk.artifact!.kind, 'markdown');
    assert.equal(firstAsk.artifact!.content, '# Draft 1', 'the reviewer sees the actual work product');
    assert.deepEqual(firstAsk.assignees, ['Jorian']);

    p = answer(p, firstAsk, { decision: 'revise', text: 'Drop the preamble and add the cost table.' });

    node = p.milestones.find(m => m.id === 'REPORT')!;
    assert.equal(node.actionConfig!.lastRun, undefined, 'the node is re-armed for a redo');
    assert.equal(node.actionConfig!.revision!.feedback, 'Drop the preamble and add the cost table.');
    assert.equal(node.actionConfig!.revision!.count, 1);

    // 3. The flow redoes the work, and the agent is actually told what to change.
    p = (await advanceProjectFlow(p, fn)).project;
    assert.equal(seen.length, 2, 'the report was regenerated');
    assert.equal(
      seen[1].feedback,
      'Drop the preamble and add the cost table.',
      "the reviewer's words reached the agent — this is what makes it a redo rather than a retry"
    );
    assert.equal(seen[1].priorOutput.report_content, '# Draft 1', 'the rejected draft went along with it');

    // 4. A fresh review is required for the new draft — the old ask cannot cover it.
    const secondAsk = openAskOn(p, 'REPORT');
    assert.notEqual(secondAsk.id, firstAsk.id);
    assert.equal(secondAsk.artifact!.content, '# Draft 2');
    assert.equal(secondAsk.artifact!.previousContent, '# Draft 1', 'the reviewer can compare against what they rejected');
    assert.equal(secondAsk.revision, 1);

    // 5. Approval releases the gate and the flow moves on.
    p = answer(p, secondAsk, { decision: 'approved', text: 'Good now.' });
    node = p.milestones.find(m => m.id === 'REPORT')!;
    assert.equal(isNodeComplete(node), true);

    const advanced = await advanceProjectFlow(p, fn);
    assert.equal(seen.length, 2, 'approving must not trigger yet another run');
    assert.equal(
      advanced.project.projectData!.report_content,
      '# Draft 2',
      'the approved draft is what reaches project data'
    );
  });

  test('rejecting stops the node without redoing it', async () => {
    const { fn, seen } = draftingExecutor();
    let p = (await advanceProjectFlow(reportFlow(), fn)).project;

    p = answer(p, openAskOn(p, 'REPORT'), { decision: 'rejected', text: 'Not needed after all.' });

    const node = p.milestones.find(m => m.id === 'REPORT')!;
    assert.equal(isNodeComplete(node), false, 'the gate stays shut');
    assert.ok(node.actionConfig!.lastRun, 'the run is left in place rather than re-armed');

    const advanced = await advanceProjectFlow(p, fn);
    assert.equal(seen.length, 1, 'a rejection is not a request to try again');
    assert.equal(advanced.project.milestones.find(m => m.id === 'REPORT')!.asks!.filter(a => a.status === 'open').length, 0,
      'and the reviewer is not asked again');
  });

  test('an ask is raised once, not on every advance', async () => {
    const { fn } = draftingExecutor();
    let p = (await advanceProjectFlow(reportFlow(), fn)).project;
    const first = p.milestones.find(m => m.id === 'REPORT')!.asks!.length;

    p = (await advanceProjectFlow(p, fn)).project;
    p = (await advanceProjectFlow(p, fn)).project;

    assert.equal(
      p.milestones.find(m => m.id === 'REPORT')!.asks!.length,
      first,
      'repeatedly advancing must not pile up duplicate reviews'
    );
  });

  test('an ambiguous reply is recorded but does not sign the work off', async () => {
    const { fn } = draftingExecutor();
    let p = (await advanceProjectFlow(reportFlow(), fn)).project;

    // Prose that contains "no" but is not a decision.
    p = answer(p, openAskOn(p, 'REPORT'), { text: 'no problem, looks great' });

    const node = p.milestones.find(m => m.id === 'REPORT')!;
    const ask = node.asks![0];
    assert.equal(ask.status, 'open', 'the ask stays open for a person to resolve properly');
    assert.equal(ask.responses.length, 1, 'but what they said is not lost');
    assert.equal(ask.responses[0].needsInterpretation, true);
    assert.equal(isNodeComplete(node), false, 'ambiguity must never release the gate');
  });

  test('a reviewer who answers twice does not re-open settled work', async () => {
    const { fn } = draftingExecutor();
    let p = (await advanceProjectFlow(reportFlow(), fn)).project;

    const ask = openAskOn(p, 'REPORT');
    p = answer(p, ask, { decision: 'approved' });
    const dataAfterFirst = { ...p.projectData };

    // Replaying the same ask (double-click, provider retry) is inert.
    const stale = p.milestones.find(m => m.id === 'REPORT')!.asks!.find(a => a.id === ask.id)!;
    const again = applyAskToProject(p, stale.id);
    assert.deepEqual(again.projectData, dataAfterFirst);
  });
});
