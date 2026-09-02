import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { triageRecommendedAction, triageResponsePresentation } from '../components/triage/triagePresentation';
import type { TriageItem } from '../types';

const item = (overrides: Partial<TriageItem> = {}): TriageItem => ({
  id: 'triage_1', orgId: 'org_1', communicationId: 'comm_1', channel: 'email',
  direction: 'inbound', occurredAt: '2026-09-02T00:00:00Z', disposition: 'new',
  audit: [], createdAt: 1, updatedAt: 1, ...overrides
});

describe('triage response presentation', () => {
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
