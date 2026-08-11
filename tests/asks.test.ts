import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { askIdentity, createAsk } from '../lib/asks/createAsk';
import { expireAsk } from '../lib/asks/expireAsk';

describe('canonical ask identity', () => {
  test('creates one durable identity independent of delivery channel', () => {
    const ask = createAsk({
      askId: 'ask_1', askToken: 'token_1', taskId: 'task_1', projectId: 'project_1',
      runId: 'run_1', personId: 'person_1', question: 'Approve this?',
      responseType: 'approval', channels: ['email', 'sms'], now: 100, expiresAt: 200
    });
    assert.deepEqual(askIdentity(ask), { ask_id: 'ask_1', ask_token: 'token_1', status: 'open' });
    assert.equal(ask.nodeId, 'task_1');
    assert.equal(ask.projectId, 'project_1');
    assert.equal(ask.personId, 'person_1');
    assert.equal(ask.dueAt, 200);
  });

  test('expiry changes only an open overdue ask', () => {
    const ask = createAsk({ taskId: 'task_1', question: 'Answer?', responseType: 'question', expiresAt: 200, now: 100 });
    assert.equal(expireAsk(ask, 199).status, 'open');
    assert.equal(expireAsk(ask, 200).status, 'expired');
    assert.equal(expireAsk({ ...ask, status: 'answered' }, 300).status, 'answered');
  });
});
