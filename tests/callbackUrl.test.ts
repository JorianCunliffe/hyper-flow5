import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { redactCallbackUrl } from '../lib/executeTask';

describe('redactCallbackUrl', () => {
  test('hides the webhook secret', () => {
    const out = redactCallbackUrl('https://x.app/api/inbound/voice/bland?secret=supersecret');
    assert.equal(out, 'https://x.app/api/inbound/voice/bland?secret=***');
    assert.ok(!out.includes('supersecret'));
  });

  test('hides the Vercel protection bypass token', () => {
    const out = redactCallbackUrl('https://x.app/api/hook?x-vercel-protection-bypass=abc123');
    assert.ok(!out.includes('abc123'));
    assert.match(out, /x-vercel-protection-bypass=\*\*\*/);
  });

  test('hides both when both are present', () => {
    const out = redactCallbackUrl('https://x.app/api/hook?secret=s1&x-vercel-protection-bypass=b2');
    assert.ok(!out.includes('s1'));
    assert.ok(!out.includes('b2'));
  });

  test('leaves ordinary params alone', () => {
    const out = redactCallbackUrl('https://x.app/api/hook?secret=s1&org=org_1');
    assert.match(out, /org=org_1/);
  });

  test('a URL with no secrets is unchanged', () => {
    const url = 'https://x.app/api/hook';
    assert.equal(redactCallbackUrl(url), url);
  });
});
