import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyEmailForTriage, normalizeGeneratedDraft } from '../lib/triage/classifyEmail';

test('model JSON with double-escaped paragraphs produces usable mailbox draft text', async t => {
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'synthetic-test-key';
  t.after(() => {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = oldKey;
  });
  globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({
    should_draft: true, draft_body: 'Hi Jorian,\\n\\nA room is available.\\n- Couple: $371/week.\\n- Inspections: weekdays at 4pm.\\n\\nRegards,\\nThe team'
  }) }] } }] });
  const result = await classifyEmailForTriage({ id: 'test', content: 'Room enquiry' } as any);
  assert.equal(result.shouldDraft, true);
  assert.equal(result.draftBody, 'Hi Jorian,\n\nA room is available.\n- Couple: $371/week.\n- Inspections: weekdays at 4pm.\n\nRegards,\nThe team');
  // The request's JSON transport must preserve actual newlines when decoded.
  assert.equal(JSON.parse(JSON.stringify({ text: result.draftBody })).text, result.draftBody);
});

test('normal text, CRLF, paths, and code are preserved', () => {
  const text = 'Hi,\r\n\r\nPrice: $371.\nPath C:\\new\\reports.txt and `\\n` are literal.\n```\nprint("\\n")\n```';
  assert.equal(normalizeGeneratedDraft(text), text);
  assert.equal(normalizeGeneratedDraft('Hi,\\r\\n\\r\\nThanks'), 'Hi,\n\nThanks');
  assert.equal(normalizeGeneratedDraft('Actual\nEscaped\\nEnd'), 'Actual\nEscaped\nEnd');
});

test('empty and non-string output remains absent and draft size stays bounded', () => {
  assert.equal(normalizeGeneratedDraft(null), undefined);
  assert.equal(normalizeGeneratedDraft('\\n\\n'), undefined);
  assert.equal(normalizeGeneratedDraft('x'.repeat(12001))?.length, 12000);
});
