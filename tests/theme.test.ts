import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseThemePreference, resolveTheme } from '../lib/theme';

describe('appearance preference', () => {
  test('only accepts explicit light or dark, otherwise follows the system', () => {
    assert.equal(parseThemePreference('light'), 'light');
    assert.equal(parseThemePreference('dark'), 'dark');
    assert.equal(parseThemePreference(null), 'system');
    assert.equal(parseThemePreference('midnight'), 'system');
  });

  test('system preference resolves from the OS setting; explicit choices win', () => {
    assert.equal(resolveTheme('system', true), 'dark');
    assert.equal(resolveTheme('system', false), 'light');
    assert.equal(resolveTheme('light', true), 'light');
    assert.equal(resolveTheme('dark', false), 'dark');
  });
});
