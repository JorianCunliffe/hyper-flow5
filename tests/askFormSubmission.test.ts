import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { renderAskForm } from '../lib/askForm';
import type { HumanAsk } from '../types';

const ask = { id: 'question', kind: 'question', status: 'open', prompt: 'Test SMS question', responses: [],
  fields: [{ name: 'policy', type: 'string', required: true }, { name: 'minutes', type: 'number', required: true },
    { name: 'available', type: 'boolean' }] } as HumanAsk;

async function submit(result: object, ok = true) {
  const html = renderAskForm({ ask, projectName: 'Test project', nodeName: 'SMS question' });
  const script = html.match(/<script>([\s\S]*)<\/script>/)![1];
  let listener: (event: object) => Promise<void>;
  let removed = false;
  let payload: any;
  const status = { textContent: '' };
  const form = { addEventListener: (_: string, fn: typeof listener) => { listener = fn; }, remove: () => { removed = true; } };
  runInNewContext(script, { document: { getElementById: (id: string) => id === 'ask-form' ? form : status },
    location: { href: 'https://example.test/api/asks/delivery-token?org=org&project=project' },
    FormData: class { get(key: string) { return ({ policy: 'Booking form required', minutes: '15', available: 'false' } as any)[key] ?? null; } },
    fetch: async (url: string, options: any) => {
      assert.match(url, /delivery-token\?org=org&project=project$/);
      payload = JSON.parse(options.body);
      return { ok, json: async () => result };
    }
  });
  await listener!({ preventDefault() {} });
  return { removed, message: status.textContent, payload };
}

test('SMS-linked form posts answers to the same capability and marks answered complete', async () => {
  const value = await submit({ askStatus: 'answered' });
  assert.deepEqual(value.payload.values, { policy: 'Booking form required', minutes: '15', available: false });
  assert.equal(value.removed, true);
  assert.match(value.message, /question is complete/);
});
test('partial and review responses keep the form available and explicitly say still open', async () => {
  for (const needsInterpretation of [false, true]) {
    const value = await submit({ askStatus: 'open', needsInterpretation });
    assert.equal(value.removed, false);
    assert.match(value.message, /still open/);
    assert.doesNotMatch(value.message, /question is complete/);
  }
});
test('rejected submissions retain entries and never claim completion', async () => {
  const value = await submit({ error: 'ask_cancelled' }, false);
  assert.equal(value.removed, false);
  assert.equal(value.message, 'ask_cancelled');
});
test('reopened answered, cancelled and expired links have distinct status and no form', () => {
  for (const status of ['answered', 'cancelled', 'expired'] as const) {
    const html = renderAskForm({ ask: { ...ask, status }, projectName: 'Test', nodeName: 'SMS' });
    assert.match(html, new RegExp(`This request is ${status}`));
    assert.doesNotMatch(html, /<form/);
  }
});
