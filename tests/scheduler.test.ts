import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { communicationsAfterCursor, cursorAfterCommunications, listInboundEmailSince, occurredMs } from '../lib/scheduler';
import { normalizeTenantSchedule } from '../lib/serverStore';

describe('durable communication cursor helpers', () => {
  test('sorts only records strictly after the committed cursor', () => {
    const records = [
      { id: 'late', occurredAt: '2026-08-28T03:00:00Z' },
      { id: 'old', occurredAt: '2026-08-28T01:00:00Z' },
      { id: 'next', occurredAt: '2026-08-28T02:00:00Z' }
    ];
    assert.deepEqual(
      communicationsAfterCursor(records, '2026-08-28T01:00:00Z').map(item => item.id),
      ['next', 'late']
    );
  });

  test('advances to the newest successfully processed record and never regresses', () => {
    assert.equal(cursorAfterCommunications('2026-08-28T02:00:00Z', [
      { occurredAt: '2026-08-28T03:00:00Z' }, { occurredAt: '2026-08-28T02:30:00Z' }
    ]), '2026-08-28T03:00:00Z');
    assert.equal(cursorAfterCommunications('2026-08-28T03:00:00Z', []), '2026-08-28T03:00:00Z');
  });

  test('treats missing and invalid timestamps as the beginning of time', () => {
    assert.equal(occurredMs(undefined), 0);
    assert.equal(occurredMs('not-a-date'), 0);
  });

  test('paginates backward until it reaches the committed cursor without dropping mail', async () => {
    const cursors: Array<string | undefined> = [];
    const client: any = {
      listCommunications: async (_orgId: string, options: any) => {
        cursors.push(options.cursor);
        return options.cursor
          ? { data: [
              { id: 'middle', occurredAt: '2026-08-28T02:00:00Z', direction: 'inbound' },
              { id: 'committed', occurredAt: '2026-08-28T01:00:00Z', direction: 'inbound' }
            ], limit: 200 }
          : { data: [{ id: 'newest', occurredAt: '2026-08-28T03:00:00Z', direction: 'inbound' }], limit: 200, nextCursor: 'page_2' };
      }
    };
    const result = await listInboundEmailSince(client, 'org_1', '2026-08-28T01:00:00Z');
    assert.deepEqual(cursors, [undefined, 'page_2']);
    assert.deepEqual(result.map(item => item.id), ['middle', 'newest']);
  });

  test('fails instead of moving the cursor over an unbounded backlog', async () => {
    const client: any = {
      listCommunications: async () => ({ data: [{ id: 'new', occurredAt: '2026-08-28T03:00:00Z' }], limit: 200, nextCursor: 'more' })
    };
    await assert.rejects(listInboundEmailSince(client, 'org_1', '2026-08-28T01:00:00Z', 2), /backlog exceeded/);
  });
});

describe('tenant schedule normalization', () => {
  test('preserves omitted fields during a partial update', () => {
    const existing = normalizeTenantSchedule('org_1', 'schedule_1', {
      name: 'Inbox triage', intervalMinutes: 60, timezone: 'Australia/Brisbane',
      connectionId: 'connection_1', policy: 'allow_approved_send', nextRunAt: 2000
    }, null, 1000);
    const updated = normalizeTenantSchedule('org_1', 'schedule_1', { enabled: false }, existing, 1500);
    assert.equal(updated.name, 'Inbox triage');
    assert.equal(updated.intervalMinutes, 60);
    assert.equal(updated.connectionId, 'connection_1');
    assert.equal(updated.policy, 'allow_approved_send');
    assert.equal(updated.nextRunAt, 2000);
    assert.equal(updated.enabled, false);
    assert.equal(updated.createdAt, 1000);
  });

  test('clamps intervals and fails closed on an unknown send policy', () => {
    const schedule = normalizeTenantSchedule('org_1', 'schedule_1', {
      name: 'Inbox triage', intervalMinutes: 1, policy: 'unexpected' as any
    }, null, 1000);
    assert.equal(schedule.intervalMinutes, 5);
    assert.equal(schedule.policy, 'draft_only');
  });
});
