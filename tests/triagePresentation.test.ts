import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { triageRecommendedAction, triageResponsePresentation } from '../components/triage/triagePresentation';
import type { AgentInboxJob, TriageItem } from '../types';

const item = (overrides: Partial<TriageItem> = {}): TriageItem => ({
  id: 'triage_1', orgId: 'org_1', communicationId: 'comm_1', channel: 'email',
  direction: 'inbound', occurredAt: '2026-09-02T00:00:00Z', disposition: 'new',
  audit: [], createdAt: 1, updatedAt: 1, ...overrides
});

describe('triage response presentation', () => {
  const failedJob: AgentInboxJob = {
    id: 'job_1', orgId: 'org_1', communicationId: 'comm_1', eventId: 'evt_1',
    channel: 'email', status: 'failed', attemptCount: 1, createdAt: 1, updatedAt: 2,
    error: 'Inbound person is not authorized for this tenant agent'
  };

  test('does not report an authorization failure as a draft attempt', () => {
    const result = triageResponsePresentation(item(), failedJob);
    assert.equal(result.kind, 'agent_failed');
    assert.equal(result.label, 'Agent processing failed');
    assert.match(result.detail, /does not establish/);
  });

  test('separates delivery failure from draft creation failure', () => {
    assert.equal(triageResponsePresentation(item({ disposition: 'delivery_failure' })).kind, 'delivery_failed');
  });

  test('retains actual draft evidence despite an independent failed agent job', () => {
    assert.equal(triageResponsePresentation(item({ providerDraftId: 'draft_1' }), failedJob).kind, 'draft_prepared');
    assert.equal(triageResponsePresentation(item({ audit: [{ at: 2, actor: 'triage', action: 'mailbox.draft.failed' }] }), failedJob).kind, 'draft_failed');
  });
  test('distinguishes a prepared draft from a missing draft', () => {
    assert.equal(triageResponsePresentation(item({ disposition: 'draft_prepared', providerDraftId: 'draft_1' })).kind, 'draft_prepared');
    assert.equal(triageResponsePresentation(item()).label, 'No draft recorded');
  });

  test('surfaces draft failures before the generic review state', () => {
    const presentation = triageResponsePresentation(item({
      disposition: 'needs_review',
      audit: [{ at: 2, action: 'mailbox.draft.failed', actor: 'triage', detail: 'Provider unavailable' }]
    }));
    assert.equal(presentation.kind, 'draft_failed');
    assert.match(presentation.detail, /timeline/i);
  });

  test('labels ineligible automated messages as excluded', () => {
    assert.equal(triageResponsePresentation(item({ disposition: 'spam_automatic', memoryEligible: false })).kind, 'excluded');
  });

  test('shows the most specific recommended action available', () => {
    assert.equal(triageRecommendedAction(item({ requestedAction: 'Pay in the Microsoft admin centre', recommendation: 'Review' })), 'Pay in the Microsoft admin centre');
  });
});
