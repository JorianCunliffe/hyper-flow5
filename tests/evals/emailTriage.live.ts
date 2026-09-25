// Explicit live evaluation: GEMINI_API_KEY=... node --import tsx tests/evals/emailTriage.live.ts
// Synthetic correspondence only; this does not create drafts or send messages.
import assert from 'node:assert/strict';
import { classifyEmailForTriage } from '../../lib/triage/classifyEmail.js';
import type { CommunicationResult } from '../../lib/communications/types.js';

if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required for live classification evaluation');

const cases = [
  { name: 'subject enquiry with test marker', subject: 'could you let me know how to arrange a viewing', content: 'Hyperflow test', shouldDraft: true },
  { name: 'body enquiry with test marker', subject: 'Test enquiry', content: 'Testing the inbox. I am interested in a room. How can I arrange a viewing?', shouldDraft: true },
  { name: 'test marker without a request', subject: 'Inbox test', content: 'Hyperflow test', shouldDraft: false },
  { name: 'explicit no-reply intent', subject: 'Viewing enquiry test', content: 'This is a delivery check only. No viewing is wanted and no reply is needed.', shouldDraft: false }
];

for (const fixture of cases) {
  const result = await classifyEmailForTriage({
    id: 'synthetic-eval', channel: 'email', direction: 'inbound',
    sender: 'Enquirer <enquirer@example.com>', occurredAt: '2026-09-25T04:00:00Z',
    subject: fixture.subject, content: fixture.content
  } as CommunicationResult);
  console.log(JSON.stringify({ case: fixture.name, priority: result.priority, shouldDraft: result.shouldDraft, recommendation: result.recommendation, draft: result.draftBody }));
  assert.equal(result.shouldDraft, fixture.shouldDraft, fixture.name);
  if (fixture.shouldDraft) {
    assert.equal(result.priority, 'normal', fixture.name);
    assert.ok(result.draftBody?.includes('?'), 'Ask for missing viewing details');
    assert.doesNotMatch(result.draftBody!, /(?:your (?:viewing|booking) is (?:confirmed|booked)|we have (?:booked|scheduled)|\$\d)/i);
    assert.doesNotMatch(result.recommendation, /(?:do not respond|ignore (?:this|the) (?:test|message))/i);
  }
}
