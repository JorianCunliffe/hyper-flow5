import test from 'node:test';
import assert from 'node:assert/strict';
import { emailContent } from '../lib/communications/emailContent.js';
import { reusableTriageCheckpoint } from '../lib/triage/runEmailTriage.js';

test('Outlook HTML preserves substantive content beyond the 255-character preview', () => {
  const text = 'A'.repeat(255);
  const result = emailContent({ content: text, email: { text_body: text,
    sanitized_html: `<p>${text}</p><p>Inspection available at 3:30 &amp; minimum stay one month.</p><script>bad()</script>` } });
  assert.match(result.content!, /Inspection available at 3:30 & minimum stay one month/);
  assert.doesNotMatch(result.content!, /bad\(\)|<p>/);
  assert.equal(result.contentTruncated, false);
});

test('plain email and non-email communications retain their content', () => {
  assert.equal(emailContent({ content: 'preview', email: { text_body: 'Full plain message' } }).content, 'Full plain message');
  assert.equal(emailContent({ content: 'call transcript' }).content, 'call transcript');
});

test('classification failures retry on a new occurrence; completed full-body checkpoints do not', () => {
  const item: any = { sourceMessage: { contentVersion: 2 }, audit: [
    { action: 'triage.classification_failed' }, { action: 'project_reconciliation', detail: 'old' }
  ] };
  assert.equal(reusableTriageCheckpoint(item, 'old'), true);
  assert.equal(reusableTriageCheckpoint(item, 'new'), false);
  item.audit.push({ action: 'triage.classified' }, { action: 'project_reconciliation', detail: 'recovered' });
  assert.equal(reusableTriageCheckpoint(item, 'new'), true);
  delete item.sourceMessage.contentVersion;
  assert.equal(reusableTriageCheckpoint(item, 'new'), false, 'legacy preview-only records must refresh');
});
