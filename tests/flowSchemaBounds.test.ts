import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOutputSchema, validateFlowOutput } from '../lib/flowData';

test('finalisation schema rejects short or long Sheet rows and nonpositive draft revisions', () => {
  const schema = validateOutputSchema({ type: 'object', properties: {
    row: { type: 'array', items: { type: 'string' }, minItems: 10, maxItems: 10 },
    revision: { type: 'integer', minimum: 1 }
  }, required: ['row', 'revision'] });
  assert.doesNotThrow(() => validateFlowOutput({ row: Array(10).fill(''), revision: 1 }, schema));
  for (const length of [0, 9, 11]) assert.throws(() => validateFlowOutput({ row: Array(length).fill(''), revision: 1 }, schema), /items/);
  for (const revision of [0, -1, 1.5, '1']) assert.throws(() => validateFlowOutput({ row: Array(10).fill(''), revision }, schema), /minimum|integer/);
  for (const invalid of [
    { type: 'array', items: { type: 'string' }, minItems: 11, maxItems: 10 },
    { type: 'string', minItems: 1 }, { type: 'integer', minimum: Infinity },
    { type: 'string', minimum: 1 }
  ]) assert.throws(() => validateOutputSchema(invalid));
});
