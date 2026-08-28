import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rules = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, '..', 'database.rules.json'), 'utf8')
).rules;

describe('Firebase production rules configuration', () => {
  test('keeps the triage tree backend-only', () => {
    assert.equal(rules.triage_items['.read'], false);
    assert.equal(rules.triage_items['.write'], false);
  });

  test('indexes the tenant triage query used by the server', () => {
    assert.equal(rules.triage_items.$orgId['.indexOn'], 'updatedAt');
  });
});
