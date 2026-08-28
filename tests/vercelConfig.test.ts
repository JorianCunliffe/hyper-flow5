import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

const walkTs = (directory: string): string[] => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(directory, entry.name);
  return entry.isDirectory() ? walkTs(full) : entry.name.endsWith('.ts') ? [full] : [];
});

describe('Vercel Hobby deployment configuration', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  test('stays within the twelve-function deployment limit', () => {
    assert.ok(walkTs(path.join(root, 'api')).length <= 12);
  });

  test('preserves consolidated public API paths with rewrites', () => {
    const rewrites = new Map(config.rewrites.map((rewrite: any) => [rewrite.source, rewrite.destination]));
    assert.equal(rewrites.get('/api/schedules/run'), '/api/schedules?action=run');
    assert.equal(rewrites.get('/api/schedules/tick'), '/api/schedules?action=tick');
    assert.equal(rewrites.get('/api/gemini/brainstormSubtasks'), '/api/gemini?action=brainstormSubtasks');
    assert.equal(rewrites.get('/api/gemini/generateProjectStructure'), '/api/gemini?action=generateProjectStructure');
  });

  test('uses a Hobby-compatible daily cron', () => {
    assert.deepEqual(config.crons, [{ path: '/api/schedules/tick', schedule: '0 0 * * *' }]);
  });

  test('keeps Firebase Admin loadable in Vercel CommonJS functions', () => {
    assert.equal(packageJson.overrides?.['jwks-rsa']?.jose, '4.15.9');
  });
});
