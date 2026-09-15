import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyCoachingTemplate, emailTriageTemplate, upgradeLegacyEmailTriageProject } from '../lib/projectTemplates';
import { ACTION_TASK_TYPE } from '../lib/nodeTypes';
import { isActionNode } from '../lib/flowEngine';
import { NodeType } from '../types';
import { coachingSessionFromProject, syncCoachingSessionFromProject } from '../lib/serverFlow';
import { normalizeServiceTemplate } from '../lib/serverStore';

describe('Daily Coaching project template', () => {
  test('builds coaching from ordinary configurable flow primitives', () => {
    const template = dailyCoachingTemplate({
      reviewer: 'Jorian', phone: '+61411111111', email: 'jorian@example.com'
    });
    assert.deepEqual(template.milestones.map(node => node.id), [
      'COACH_DOC',
      'COACH_TRACKER',
      'COACH_CALL',
      'COACH_CALL_ROUTE',
      'COACH_EXTRACT',
      'COACH_WRITE',
      'COACH_FAILED_END',
      'COACH_RETRY_WAIT',
      'COACH_RETRY_LOOP',
      'COACH_RETRIES_END'
    ]);

    const byId = new Map(template.milestones.map(node => [node.id, node]));
    assert.deepEqual(byId.get('COACH_CALL')?.dependsOn, ['COACH_DOC', 'COACH_TRACKER']);
    assert.deepEqual(byId.get('COACH_CALL_ROUTE')?.dependsOn, ['COACH_CALL']);
    assert.equal(byId.get('COACH_CALL_ROUTE')?.nodeType, NodeType.DECISION);
    assert.deepEqual(byId.get('COACH_EXTRACT')?.dependsOn, ['COACH_CALL_ROUTE']);
    assert.equal(byId.get('COACH_RETRY_WAIT')?.nodeType, NodeType.WAIT);
    assert.equal(byId.get('COACH_RETRY_WAIT')?.waitConfig?.durationMinutes, 10);
    assert.equal(byId.get('COACH_RETRY_LOOP')?.nodeType, NodeType.LOOP);
    assert.equal(byId.get('COACH_RETRY_LOOP')?.loopConfig?.loopStartId, 'COACH_CALL');
    assert.equal(byId.get('COACH_RETRIES_END')?.nodeType, NodeType.END);
    assert.equal(byId.get('COACH_FAILED_END')?.nodeType, NodeType.END);

    const call = byId.get('COACH_CALL')!;
    assert.equal(call.actionConfig?.failureMode, 'continue');
    assert.equal(call.actionConfig?.resultVariable, 'coaching_call_result');

    const extraction = byId.get('COACH_EXTRACT')!;
    assert.deepEqual(extraction.reviewPolicy?.when, [{ variable: 'coaching_requires_review', equals: true }]);
    assert.deepEqual(extraction.reviewPolicy?.channels, ['web', 'email']);
    assert.equal(template.projectData.contact_phone, '+61411111111');
    assert.equal(template.projectData.project_template, 'daily_coaching');
  });

  test('only action nodes are executable and Sheet writes use occurrence idempotency', () => {
    const template = dailyCoachingTemplate();
    const actions = template.milestones.filter(isActionNode);
    assert.deepEqual(actions.map(node => node.id), [
      'COACH_DOC', 'COACH_TRACKER', 'COACH_CALL', 'COACH_EXTRACT', 'COACH_WRITE'
    ]);
    for (const node of actions) {
      assert.ok(ACTION_TASK_TYPE[node.nodeType as NodeType], `${node.id} is not executable`);
      assert.equal(node.actionConfig?.autoExecute, true);
    }
    assert.match(
      template.milestones.find(node => node.id === 'COACH_WRITE')?.actionConfig?.template || '',
      /flow_occurrence_id/
    );
  });

  test('projects a failed call for presentation without creating a special retry queue state', () => {
    const template = dailyCoachingTemplate();
    const call = template.milestones.find(node => node.id === 'COACH_CALL')!;
    const scheduledFor = Date.parse('2026-08-30T23:00:00.000Z');
    call.actionConfig!.lastRun = {
      id: 'run_call',
      scheduleOccurrenceId: 'daily:1',
      at: scheduledFor,
      resolvedAt: scheduledFor + 2 * 60_000,
      status: 'error',
      error: 'Answering machine detected',
      externalExecutionId: 'comm_1',
      communicationOutcome: { disposition: 'voicemail', successful: false, memoryEligible: false }
    };
    const session = coachingSessionFromProject('org_1', {
      id: 'project_1', name: 'Daily Coaching', company: 'Acme', type: 'Other', startDate: 0,
      milestones: template.milestones, createdAt: 0, updatedAt: 0,
      projectData: {
        ...template.projectData,
        schedule_id: 'daily',
        schedule_run_id: 'daily:1',
        schedule_occurrence_id: 'daily:1',
        scheduled_for: '2026-08-30T23:00:00.000Z'
      }
    }, scheduledFor + 10 * 60_000);
    assert.equal(session?.status, 'failed');
    assert.equal(session?.disposition, 'voicemail');
    assert.equal(session?.failureReason, 'Answering machine detected');
    assert.equal(session?.sheetWrite, undefined);
    assert.equal(session?.retryStatus, undefined);
    assert.equal(session?.nextRetryAt, undefined);
  });

  test('encodes retryable outcomes and bounded attempts in Decision/Wait/Loop configuration', () => {
    const template = dailyCoachingTemplate({ retryAttempts: 3, retryDelayMinutes: 12 });
    const route = template.milestones.find(node => node.id === 'COACH_CALL_ROUTE')!;
    const retryBranch = route.decisionConfig?.branches.find(branch => branch.targetId === 'COACH_RETRY_WAIT');
    assert.deepEqual(retryBranch?.conditions, [{
      variable: 'coaching_call_result_disposition',
      oneOf: [
        'voicemail', 'no_meaningful_response', 'hangup', 'hang_up', 'hung_up',
        'no_answer', 'busy', 'provider_failed', 'provider_failure', 'failed'
      ]
    }]);
    assert.equal(template.milestones.find(node => node.id === 'COACH_RETRY_WAIT')?.waitConfig?.durationMinutes, 12);
    assert.equal(template.milestones.find(node => node.id === 'COACH_RETRY_LOOP')?.loopConfig?.maxIterations, 2);
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
  test('starts in draft-only mode with one executable triage action', () => {
    const template = emailTriageTemplate();
    assert.equal(template.projectData.project_template, 'email_triage');
    assert.equal(template.projectData.email_send_policy, 'draft_only');
    assert.equal(template.milestones[0].nodeType, NodeType.EMAIL_TRIAGE);
    assert.equal(template.milestones[0].actionConfig?.autoExecute, true);
    assert.equal(ACTION_TASK_TYPE[NodeType.EMAIL_TRIAGE], 'run_email_triage');
    assert.match(template.milestones[0].actionConfig?.template || '', /triage_connection_id/);
  });

  test('canonicalizes the legacy daily_email_triage template key without changing project identity', () => {
    const legacy = {
      id: 'legacy-triage', name: 'Inbox', company: 'Acme', type: 'Other' as const,
      startDate: 0, milestones: [], createdAt: 1, updatedAt: 1,
      projectData: { project_template: 'daily_email_triage', retained: true }
    };
    const migrated = normalizeServiceTemplate(legacy);
    assert.equal(migrated.id, legacy.id);
    assert.equal(migrated.projectData?.project_template, 'email_triage');
    assert.equal(migrated.projectData?.retained, true);
  });

  test('upgrades the generated decorative triage milestone to the executable action', () => {
    const legacy = {
      id: 'legacy-triage', name: 'Inbox', company: 'Acme', type: 'Other' as const,
      startDate: 0, createdAt: 1, updatedAt: 1,
      projectData: { project_template: 'email_triage' },
      milestones: [{
        id: 'TRIAGE_INBOX', name: 'Daily mailbox triage', estimatedDuration: 1, dependsOn: [],
        subtasks: [{
          id: 'TRIAGE_REVIEW', name: 'Review prioritized communications',
          description: '', assignedTo: '', status: 'Not started' as const
        }]
      }]
    };
    const upgraded = upgradeLegacyEmailTriageProject(legacy);
    assert.equal(upgraded.milestones[0].nodeType, NodeType.EMAIL_TRIAGE);
    assert.equal(upgraded.milestones[0].actionConfig?.autoExecute, true);
    assert.deepEqual(upgraded.milestones[0].subtasks, []);
  });
});
