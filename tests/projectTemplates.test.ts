import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyCoachingTemplate, emailTriageTemplate } from '../lib/projectTemplates';
import { ACTION_TASK_TYPE } from '../lib/nodeTypes';
import { NodeType } from '../types';
import { coachingSessionFromProject, syncCoachingSessionFromProject } from '../lib/serverFlow';

describe('Daily Coaching project template', () => {
  test('builds the complete read, call, extract, review, and write dependency chain', () => {
    const template = dailyCoachingTemplate({
      reviewer: 'Jorian', phone: '+61411111111', email: 'jorian@example.com'
    });
    assert.deepEqual(template.milestones.map(node => node.id), [
      'COACH_DOC', 'COACH_TRACKER', 'COACH_CALL', 'COACH_EXTRACT', 'COACH_WRITE'
    ]);
    assert.deepEqual(template.milestones.find(node => node.id === 'COACH_CALL')?.dependsOn, ['COACH_DOC', 'COACH_TRACKER']);
    assert.deepEqual(template.milestones.find(node => node.id === 'COACH_EXTRACT')?.dependsOn, ['COACH_CALL']);
    assert.deepEqual(template.milestones.find(node => node.id === 'COACH_WRITE')?.dependsOn, ['COACH_EXTRACT']);
    const extraction = template.milestones.find(node => node.id === 'COACH_EXTRACT')!;
    assert.deepEqual(extraction.reviewPolicy?.when, [{ variable: 'coaching_requires_review', equals: true }]);
    assert.deepEqual(extraction.reviewPolicy?.channels, ['web', 'email']);
    assert.equal(template.projectData.contact_phone, '+61411111111');
    assert.equal(template.projectData.project_template, 'daily_coaching');
  });

  test('every action is executable and Sheet writes use occurrence idempotency', () => {
    const template = dailyCoachingTemplate();
    for (const node of template.milestones) {
      assert.ok(ACTION_TASK_TYPE[node.nodeType as NodeType], `${node.id} is not executable`);
      assert.equal(node.actionConfig?.autoExecute, true);
    }
    assert.match(template.milestones.find(node => node.id === 'COACH_WRITE')?.actionConfig?.template || '', /schedule_occurrence_id/);
  });

  test('projects failed calls as failed sessions without a Sheet write', () => {
    const template = dailyCoachingTemplate();
    const call = template.milestones.find(node => node.id === 'COACH_CALL')!;
    call.actionConfig!.lastRun = {
      id: 'run_call', at: 2, status: 'error', error: 'Answering machine detected',
      externalExecutionId: 'comm_1',
      communicationOutcome: { disposition: 'voicemail', successful: false, memoryEligible: false }
    };
    const scheduledFor = Date.parse('2026-08-30T23:00:00.000Z');
    const session = coachingSessionFromProject('org_1', {
      id: 'project_1', name: 'Daily Coaching', company: 'Acme', type: 'Other', startDate: 0,
      milestones: template.milestones, createdAt: 0, updatedAt: 0,
      projectData: {
        ...template.projectData, schedule_id: 'daily', schedule_run_id: 'daily:1',
        schedule_occurrence_id: 'daily:1', scheduled_for: '2026-08-30T23:00:00.000Z'
      }
    }, scheduledFor + 10 * 60_000);
    assert.equal(session?.status, 'failed');
    assert.equal(session?.disposition, 'voicemail');
    assert.equal(session?.failureReason, 'Answering machine detected');
    assert.equal(session?.sheetWrite, undefined);
    assert.equal(session?.retryStatus, 'pending');
    assert.equal(session?.attemptCount, 1);
    assert.equal(session?.nextRetryAt, scheduledFor + 10 * 60_000);
  });

  test('does not retry wrong numbers and exhausts a bounded retry policy', () => {
    const template = dailyCoachingTemplate();
    const call = template.milestones.find(node => node.id === 'COACH_CALL')!;
    call.actionConfig!.lastRun = {
      id: 'run_2', at: 2, status: 'error', error: 'Wrong number',
      communicationOutcome: { disposition: 'wrong_number', successful: false, memoryEligible: false }
    };
    const base = {
      id: 'project_1', name: 'Daily Coaching', company: 'Acme', type: 'Other' as const, startDate: 0,
      milestones: template.milestones, createdAt: 0, updatedAt: 0,
      projectData: {
        ...template.projectData, schedule_occurrence_id: 'daily:1',
        scheduled_for: '2026-08-30T23:00:00.000Z'
      }
    };
    assert.equal(coachingSessionFromProject('org_1', base, Date.parse('2026-08-30T23:10:00Z'))?.nextRetryAt, undefined);

    call.actionConfig!.lastRun = {
      ...call.actionConfig!.lastRun!, error: 'No answer',
      communicationOutcome: { disposition: 'no_answer', successful: false, memoryEligible: false }
    };
    call.actionConfig!.runHistory = [{ id: 'run_1', at: 1, status: 'error' }];
    const exhausted = coachingSessionFromProject('org_1', base, Date.parse('2026-08-30T23:10:00Z'));
    assert.equal(exhausted?.retryStatus, 'exhausted');
    assert.equal(exhausted?.attemptCount, 2);
  });

  test('does not fail an already-persisted workflow when the coaching projection is temporarily unavailable', async () => {
    const template = dailyCoachingTemplate();
    const project = {
      id: 'project_1', name: 'Daily Coaching', company: 'Acme', type: 'Other' as const, startDate: 0,
      milestones: template.milestones, createdAt: 0, updatedAt: 0,
      projectData: { ...template.projectData, schedule_occurrence_id: 'daily:1' }
    };
    const originalError = console.error;
    console.error = () => undefined;
    try {
      const warning = await syncCoachingSessionFromProject('org_1', project, async () => {
        throw new Error('temporary database outage');
      });
      assert.match(warning || '', /pending reconciliation/);
    } finally {
      console.error = originalError;
    }
  });
});

describe('Daily Email Triage project template', () => {
  test('starts in draft-only mode with a visible triage review task', () => {
    const template = emailTriageTemplate();
    assert.equal(template.projectData.project_template, 'email_triage');
    assert.equal(template.projectData.email_send_policy, 'draft_only');
    assert.equal(template.milestones[0].subtasks[0].name, 'Review prioritized communications');
  });
});
