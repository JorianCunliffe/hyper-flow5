import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');

const walkTs = (directory: string): string[] => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(directory, entry.name);
  return entry.isDirectory() ? walkTs(full) : entry.name.endsWith('.ts') ? [full] : [];
});

describe('Vercel Hobby deployment configuration', () => {
  test('server JSON imports load in native Node without the tsx loader', () => {
    let checked = 0;
    for (const file of walkTs(path.join(root, 'lib'))) {
      const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.moduleSpecifier.text.endsWith('.json')) continue;
        const url = pathToFileURL(path.resolve(path.dirname(file), statement.moduleSpecifier.text)).href;
        const declaration = statement.getText(source).replace(statement.moduleSpecifier.getText(source), JSON.stringify(url));
        const result = spawnSync(process.execPath, ['--input-type=module', '--eval', declaration], {
          encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' },
        });
        assert.equal(result.status, 0, `${file}: ${result.stderr}`);
        checked++;
      }
    }
    assert.ok(checked >= 6, 'Expected runtime JSON imports to be exercised');
  });
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  test('stays within the twelve-function deployment limit', () => {
    assert.ok(walkTs(path.join(root, 'api')).length <= 12);
  });

  test('preserves consolidated public API paths with rewrites', () => {
    const rewrites = new Map(config.rewrites.map((rewrite: any) => [rewrite.source, rewrite.destination]));
    assert.equal(rewrites.get('/api/schedules/run'), '/api/schedules?action=run');
    assert.equal(rewrites.get('/api/schedules/tick'), '/api/schedules?action=tick');
    assert.equal(rewrites.get('/api/integrations'), '/api/communications/status?action=integrations');
    assert.equal(rewrites.get('/api/integrations/google/callback'), '/api/communications/status?action=google_callback');
    assert.equal(rewrites.get('/api/agent/voice-context'), '/api/events?action=voice_context');
    assert.equal(rewrites.get('/api/operations'), '/api/communications/status?action=operations');
    assert.equal(rewrites.get('/api/operations/agent-jobs/replay'), '/api/communications/status?action=operations_replay');
    assert.equal(rewrites.get('/api/thread-register'), '/api/communications/status?action=thread_register');
    assert.equal(rewrites.get('/api/thread-register/candidates'), '/api/communications/status?action=thread_candidates');
    assert.equal(rewrites.get('/api/thread-register/correction'), '/api/communications/status?action=thread_correction');
    assert.equal(rewrites.get('/api/thread-register/thread'), '/api/communications/status?action=thread_update');
    assert.equal(rewrites.get('/api/gemini/brainstormSubtasks'), '/api/gemini?action=brainstormSubtasks');
    assert.equal(rewrites.get('/api/gemini/generateProjectStructure'), '/api/gemini?action=generateProjectStructure');
  });

  test('uses a Hobby-compatible daily cron', () => {
    assert.deepEqual(config.crons, [{ path: '/api/schedules/tick', schedule: '0 0 * * *' }]);
  });

  test('allows long-running API work within the Hobby Fluid Compute limit', () => {
    assert.equal(config.fluid, true);
    assert.equal(config.functions?.['api/**/*.ts']?.maxDuration, 300);
  });

  test('does not ship a competing GitHub scheduler ticker', () => {
    assert.equal(fs.existsSync(path.join(root, '.github', 'workflows', 'scheduler.yml')), false);
  });

  test('keeps Firebase Admin loadable in Vercel CommonJS functions', () => {
    assert.equal(packageJson.overrides?.['jwks-rsa']?.jose, '4.15.9');
  });
});
