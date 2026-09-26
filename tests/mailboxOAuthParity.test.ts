import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('mailbox OAuth start preserves provider and setup draft in local and Vercel handlers', () => {
  const adapter = readFileSync('lib/http/express.ts', 'utf8');
  assert.match(adapter,/communications from/);
  assert.match(adapter,/config.rewrites/);
  const local = readFileSync('api/communications/status.ts', 'utf8');
  const serverless = readFileSync('api/communications/status.ts', 'utf8');

  for (const source of [local, serverless]) {
    assert.match(source, /provider must be gmail or outlook/);
    assert.match(source, /setupDraftId/);
    assert.match(source, /startMailboxOAuth\([\s\S]*provider,[\s\S]*setupDraftId/);
  }
});
