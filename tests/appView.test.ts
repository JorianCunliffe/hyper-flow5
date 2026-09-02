import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAppView } from '../lib/appView';

describe('app view deep links', () => {
  test('accepts each supported view', () => {
    for (const view of ['projects', 'kanban', 'scratch', 'feed', 'approvals', 'reports', 'activity'] as const) {
      assert.equal(parseAppView(view), view);
    }
  });

  test('falls back safely for missing or unsupported views', () => {
    assert.equal(parseAppView(null), 'projects');
    assert.equal(parseAppView('unknown'), 'projects');
  });
});
