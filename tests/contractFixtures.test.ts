import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { normalizeExternalEvent, terminalExternalEventResult } from '../lib/externalEvents.js';

const fixtures = JSON.parse(readFileSync(
  new URL('../contracts/communications-events.v2.json', import.meta.url), 'utf8'
)) as Array<{ name: string; event: Record<string, unknown> }>;

describe('Communications v2 shared contract fixtures', () => {
  test('normalizes every canonical fixture inside its trusted tenant', () => {
    assert.deepEqual(fixtures.map(fixture => fixture.name), [
      'inbound_email', 'inbound_sms', 'inbound_voice', 'ask_response', 'call_completed', 'call_failed'
    ]);
    for (const fixture of fixtures) {
      const event = normalizeExternalEvent({ ...fixture.event, source: 'communications' });
      assert.equal(event.correlation.tenant_id, 'tenant_fixture', fixture.name);
      assert.ok(event.event_id);
      assert.ok(event.type);
    }
  });

  test('accepts verified human completion and fails voicemail closed', () => {
    const completed = normalizeExternalEvent({ ...fixtures.find(item => item.name === 'call_completed')!.event, source: 'communications' });
    const failed = normalizeExternalEvent({ ...fixtures.find(item => item.name === 'call_failed')!.event, source: 'communications' });
    assert.equal(terminalExternalEventResult(completed)?.status, 'success');
    assert.equal(terminalExternalEventResult(failed)?.status, 'error');
  });
});
