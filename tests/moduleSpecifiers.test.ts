import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Every relative import in code that ships to a serverless function must carry an
 * explicit .js extension.
 *
 * Nothing local catches this. TypeScript is happy (moduleResolution: bundler),
 * Vite is happy, esbuild is happy, and tsx is happy — all four rewrite
 * extensionless specifiers. Vercel's serverless runtime does not: it runs the
 * emitted .js under Node's ESM loader, where a relative specifier must be a real
 * path.
 *
 * This shipped. api/tasks/execute.ts worked because executeTask.ts has no
 * relative imports of its own, so the build looked fine and one endpoint was
 * genuinely healthy — while an inbound webhook died at module load with
 * ERR_MODULE_NOT_FOUND, after placing a real phone call and holding a real
 * conversation. The failure only appeared in production, in the one path that
 * costs money and someone's time to exercise.
 */

const ROOT = path.resolve(import.meta.dirname, '..');
const SHIPPED_DIRS = ['lib', 'api'];

const walk = (dir: string): string[] => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap(e => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });
};

/** Matches `from './x'`, `import('./x')` and `export ... from './x'`. */
const RELATIVE_SPECIFIER = /(?:from|import)\s*\(?\s*['"](\.[^'"]*)['"]/g;

describe('module specifiers in shipped code', () => {
  const files = SHIPPED_DIRS.flatMap(d => walk(path.join(ROOT, d)));

  test('there are files to check', () => {
    assert.ok(files.length > 5, `expected to find shipped files, found ${files.length}`);
  });

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    test(`${rel} uses explicit extensions`, () => {
      const source = fs.readFileSync(file, 'utf8');
      const offenders: string[] = [];
      for (const m of source.matchAll(RELATIVE_SPECIFIER)) {
        const spec = m[1];
        if (!spec.endsWith('.js') && !spec.endsWith('.json')) offenders.push(spec);
      }
      assert.deepEqual(
        offenders,
        [],
        `${rel} imports ${offenders.join(', ')} without an extension — Node's ESM loader ` +
          `cannot resolve these on Vercel, even though tsc, Vite, esbuild and tsx all can.`
      );
    });
  }

  test('the entry points that broke are covered', () => {
    const names = files.map(f => path.relative(ROOT, f).replaceAll('\\', '/'));
    for (const expected of ['lib/serverFlow.ts', 'lib/executeTask.ts', 'api/events.ts']) {
      assert.ok(names.includes(expected), `${expected} should be checked`);
    }
  });
});
