import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { projectCollectionsShareRevisions } from '../lib/projectRevisionGuard.js';

describe('browser project revision guard', () => {
  test('accepts an unchanged project collection across RTDB array/object shapes', () => {
    assert.equal(projectCollectionsShareRevisions(
      { 0: { id: 1787628008985, revision: 7 }, 1: { id: 'p-2' } },
      [{ id: '1787628008985', revision: 7 }, { id: 'p-2', revision: 0 }]
    ), true);
  });

  test('rejects a stale browser snapshot after a callback increments a project revision', () => {
    assert.equal(projectCollectionsShareRevisions(
      [{ id: 'p-1', revision: 8 }],
      [{ id: 'p-1', revision: 7 }]
    ), false);
  });

  test('rejects missing, additional, or duplicate project identities', () => {
    assert.equal(projectCollectionsShareRevisions(
      [{ id: 'p-1', revision: 1 }, { id: 'p-2', revision: 1 }],
      [{ id: 'p-1', revision: 1 }]
    ), false);
    assert.equal(projectCollectionsShareRevisions(
      [{ id: 'p-1', revision: 1 }, { id: 'p-1', revision: 1 }],
      [{ id: 'p-1', revision: 1 }, { id: 'p-2', revision: 1 }]
    ), false);
  });
});
