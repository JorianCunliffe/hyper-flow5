import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildTriageDigest } from '../lib/triage/emailTriage.js';
import type { TriageItem } from '../types.js';

const item = (overrides: Partial<TriageItem>): TriageItem => ({
  id: 'message_1', orgId: 'org_1', communicationId: 'message_1', channel: 'email', direction: 'inbound',
  occurredAt: '2026-08-30T00:00:00Z', disposition: 'new', audit: [], createdAt: 1, updatedAt: 1,
  ...overrides
});

describe('daily triage digest', () => {
  test('summarizes only the occurrence and orders urgent work first', () => {
    const digest = buildTriageDigest({
      orgId: 'org_1', scheduleId: 'daily', scheduledFor: 123, timezone: 'Australia/Brisbane',
      deliveryChannel: 'sms',
      newItemIds: ['urgent', 'high'],
      items: [
        item({ id: 'normal', communicationId: 'normal', subject: 'Newsletter', priority: 'normal', disposition: 'resolved' }),
        item({ id: 'urgent', communicationId: 'urgent', subject: 'Settlement deadline', priority: 'urgent', disposition: 'needs_review', recommendation: 'Reply today' }),
        item({ id: 'high', communicationId: 'high', subject: 'Contract review', priority: 'high', disposition: 'draft_prepared' })
      ]
    });
    assert.equal(digest.id, 'daily:123');
    assert.deepEqual(digest.counts, { total: 2, outstanding: 2, urgent: 1, high: 1, needsReview: 1, draftsPrepared: 1 });
    assert.equal(digest.deliveryChannel, 'sms');
    assert.equal(digest.deliveryStatus, 'available');
    assert.ok(digest.summary.indexOf('Settlement deadline') < digest.summary.indexOf('Contract review'));
    assert.doesNotMatch(digest.summary, /Newsletter/);
  });

  test('renders an explicit empty occurrence', () => {
    const digest = buildTriageDigest({ orgId: 'org_1', scheduleId: 'daily', scheduledFor: 123, timezone: 'UTC', items: [] });
    assert.match(digest.summary, /0 new messages/);
    assert.match(digest.summary, /Nothing requires attention/);
  });

  test('keeps prior outstanding work visible when no new mail arrives', () => {
    const digest = buildTriageDigest({
      orgId: 'org_1', scheduleId: 'daily', scheduledFor: 123, timezone: 'UTC', newItemIds: [],
      items: [item({ id: 'urgent', communicationId: 'urgent', subject: 'Still due', priority: 'urgent', disposition: 'needs_review' })]
    });
    assert.equal(digest.counts.total, 0);
    assert.equal(digest.counts.outstanding, 1);
    assert.match(digest.summary, /0 new messages; 1 outstanding/);
    assert.match(digest.summary, /Still due/);
  });
});
