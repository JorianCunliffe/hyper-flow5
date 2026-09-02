import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { coachingPresentation } from '../components/triage/coachingPresentation';
import type { CoachingSession } from '../types';

const session = (overrides: Partial<CoachingSession> = {}): CoachingSession => ({
  id: 'session_1', orgId: 'org_1', projectId: 'project_1', status: 'scheduled',
  createdAt: 1, updatedAt: 1, ...overrides
});

describe('coaching session presentation', () => {
  test('distinguishes completed sessions with and without a tracker write', () => {
    assert.match(coachingPresentation(session({ status: 'completed', sheetWrite: { row: 2 } })).detail, /tracker update/i);
    assert.match(coachingPresentation(session({ status: 'completed' })).detail, /no tracker write/i);
  });

  test('surfaces review requirements', () => {
    assert.equal(coachingPresentation(session({ status: 'review_required' })).label, 'Needs review');
  });

  test('shows a pending retry as the next action', () => {
    const result = coachingPresentation(session({ status: 'failed', retryStatus: 'pending', nextRetryAt: Date.now() + 60_000 }));
    assert.equal(result.label, 'Retry scheduled');
    assert.match(result.nextStep, /scheduled/i);
  });

  test('does not describe an in-progress call as complete', () => {
    assert.equal(coachingPresentation(session({ status: 'calling' })).label, 'Call in progress');
  });
});
