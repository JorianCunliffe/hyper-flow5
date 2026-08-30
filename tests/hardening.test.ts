import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isPrivateAddress } from '../lib/safeWebhook.js';
import { renderAskForm } from '../lib/askForm.js';
import { recordAskResponse } from '../lib/humanAsk.js';
import { validateAskUpload } from '../lib/serverStore.js';
import type { HumanAsk, HumanResponse } from '../types.js';

const ask = (overrides: Partial<HumanAsk> = {}): HumanAsk => ({
  id: 'ask_parent', token: 'token_secret', kind: 'approval', status: 'open', prompt: 'Approve <this>?',
  nodeId: 'task_1', assignees: ['Alice', 'Bob'], channels: ['web'], createdAt: 1, responses: [],
  ...overrides
});

const response = (actor: string, at: number): HumanResponse => ({
  id: `response_${at}`, actor, at, via: 'web', decision: 'approved'
});

describe('SSRF address classification', () => {
  test('blocks local, private, link-local, documentation and multicast ranges', () => {
    for (const address of ['127.0.0.1', '10.0.0.1', '172.16.1.1', '192.168.1.1', '169.254.169.254', '203.0.113.4', '::1', 'fd00::1', 'ff02::1', '2001:db8::1']) {
      assert.equal(isPrivateAddress(address), true, address);
    }
  });

  test('permits ordinary public addresses', () => {
    assert.equal(isPrivateAddress('8.8.8.8'), false);
    assert.equal(isPrivateAddress('2606:4700:4700::1111'), false);
  });
});

describe('multi-reviewer Ask policy', () => {
  test('all waits for every distinct reviewer', () => {
    const first = recordAskResponse(ask({ responsePolicy: 'all' }), response('Alice', 2));
    assert.equal(first.status, 'open');
    const second = recordAskResponse(first, response('Bob', 3));
    assert.equal(second.status, 'answered');
  });

  test('quorum counts distinct actors rather than duplicate replies', () => {
    const first = recordAskResponse(ask({ responsePolicy: 'quorum', quorum: 2 }), response('Alice', 2));
    const duplicate = recordAskResponse(first, response('Alice', 3));
    assert.equal(duplicate.status, 'open');
  });

  test('all and quorum ignore identities that are not assigned reviewers', () => {
    const outsider = recordAskResponse(ask({ responsePolicy: 'all' }), response('Mallory', 2));
    assert.equal(outsider.status, 'open');
  });

  test('a rejection or revision from an assigned reviewer vetoes an all policy', () => {
    const rejected = recordAskResponse(ask({ responsePolicy: 'all' }), {
      ...response('Alice', 2), decision: 'rejected'
    });
    assert.equal(rejected.status, 'answered');
  });
});

describe('rendered Ask form', () => {
  test('renders an escaped, submit-capable HTML page without exposing project data', () => {
    const html = renderAskForm({ ask: ask(), projectName: 'Secret Project', nodeName: 'Review' });
    assert.match(html, /<!doctype html>/i);
    assert.match(html, /Approve &lt;this&gt;\?/);
    assert.match(html, /fetch\(location.href/);
    assert.doesNotMatch(html, /projectData/);
  });

  test('renders the escaped work product and only safe artifact links', () => {
    const html = renderAskForm({
      ask: ask({
        artifact: {
          kind: 'markdown', title: 'Draft <one>', content: '# Hello <script>alert(1)</script>',
          previousContent: 'Old <draft>', evaluation: { confidence: 0.8 }
        }
      }),
      projectName: 'Project', nodeName: 'Review'
    });
    assert.match(html, /Draft &lt;one&gt;/);
    assert.match(html, /# Hello &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /Old &lt;draft&gt;/);
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);

    const unsafe = renderAskForm({
      ask: ask({ artifact: { kind: 'link', url: 'javascript:alert(1)', title: 'Open' } }),
      projectName: 'Project', nodeName: 'Review'
    });
    assert.doesNotMatch(unsafe, /href=/);
  });

  test('renders declared file fields and submits uploads rather than trusted attachment metadata', () => {
    const html = renderAskForm({
      ask: ask({
        kind: 'upload',
        fields: [{ name: 'evidence', label: 'Evidence', type: 'file', required: true }]
      }),
      projectName: 'Project', nodeName: 'Upload'
    });
    assert.match(html, /name=\"evidence\" type=\"file\"/);
    assert.match(html, /uploads\.push/);
    assert.doesNotMatch(html, /JSON\.stringify\([^)]*attachments/);
  });
});

describe('Ask upload validation', () => {
  const upload = { field: 'evidence', name: 'note.txt', mime: 'text/plain', base64: Buffer.from('hello').toString('base64') };

  test('accepts a canonical, allowlisted upload for a declared field', () => {
    const result = validateAskUpload(upload, ['evidence']);
    assert.equal(result.bytes.toString('utf8'), 'hello');
  });

  test('rejects undeclared fields, unsafe names, unapproved MIME types and oversized files', () => {
    assert.throws(() => validateAskUpload(upload, []), /not declared/);
    assert.throws(() => validateAskUpload({ ...upload, name: '../note.txt' }, ['evidence']), /filename/);
    assert.throws(() => validateAskUpload({ ...upload, mime: 'text/html' }, ['evidence']), /type/);
    assert.throws(() => validateAskUpload({ ...upload, base64: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64') }, ['evidence']), /2 MB/);
  });
});
