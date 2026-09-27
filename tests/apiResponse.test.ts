import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkApiResponse } from '../services/apiResponse.js';

test('platform failures give a useful HTTP error without exposing the response body', () => {
  const response = new Response('A server error has occurred', { status: 500, headers: { 'content-type': 'text/plain', 'x-vercel-id': 'test-request' } });
  assert.throws(() => checkApiResponse(response), /HTTP 500.*Reference: test-request/);
});

test('JSON API errors and successful non-JSON responses remain available to callers', async () => {
  const error = Response.json({ error: 'Sign in required' }, { status: 401 });
  assert.equal(checkApiResponse(error), error);
  assert.deepEqual(await error.json(), { error: 'Sign in required' });
  const success = new Response('download');
  assert.equal(checkApiResponse(success), success);
});
