import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HttpCommunicationsClient } from '../lib/communications/client';
import { CommunicationsApiError } from '../lib/communications/errors';
import { handleThreadRegisterRequest, ThreadRegisterRequestError } from '../lib/communications/threadRegister';

const member = { orgId: 'org_1', uid: 'verified_user' };
const personId = '11111111-1111-4111-8111-111111111111';
const harness = () => {
  const calls: any[] = [];
  const client: any = Object.fromEntries(['listThreadRegister', 'getThreadCandidates', 'correctThread', 'updateThread'].map(method => [method,
    async (...args: any[]) => { calls.push({ method, args }); return { ok: true }; }
  ]));
  client.getCommunication = async () => ({ correlation: { external_project_id: 'project_1' } });
  client.getThread = async () => ({ external_project_id: 'project_1' });
  return { calls, client, listProjects: async (tenantId: string) => { assert.equal(tenantId, member.orgId); return [{ id: 'project_1' }]; } };
};

describe('tenant-scoped thread register proxy', () => {
  for (const action of ['thread_update', 'thread_correction']) {
    test(`${action} explains missing actor capability without retrying anonymously`, async () => {
      const dependencies = harness();
      const writes: any[] = [];
      const rejectWrite = async (...args: any[]) => {
        writes.push(args);
        throw new CommunicationsApiError('Communications API returned 403: API client lacks required capability: threads:actor:assert', 403);
      };
      dependencies.client.updateThread = rejectWrite;
      dependencies.client.correctThread = rejectWrite;
      const request = action === 'thread_update'
        ? { method: 'PATCH', body: { threadId: 'thread_1', external_project_id: 'project_1' } }
        : { method: 'POST', body: { communicationId: 'comm_1', create_new: true, reason_code: 'wrong_project', external_project_id: 'project_1' } };
      await assert.rejects(handleThreadRegisterRequest(action, request, member, dependencies), (error: any) => {
        assert.equal(error.status, 403);
        assert.match(error.message, /administrator.*Communications Service/);
        assert.match(error.message, /not saved/);
        return true;
      });
      assert.equal(writes.length, 1);
      assert.equal(writes[0][2].initiator_id, member.uid);
    });
  }

  test('preserves unrelated permission failures unchanged', async () => {
    const dependencies = harness();
    const denied = new CommunicationsApiError('Tenant is not permitted', 403);
    dependencies.client.updateThread = async () => { throw denied; };
    await assert.rejects(handleThreadRegisterRequest('thread_update', {
      method: 'PATCH', body: { threadId: 'thread_1', title: 'Review' }
    }, member, dependencies), error => error === denied);
  });

  test('reads the register and candidates using verified membership, never caller tenant input', async () => {
    const dependencies = harness();
    await handleThreadRegisterRequest('thread_register', { method: 'GET', query: { tenant_id: 'other_org', status: 'all', personId, projectId: 'project_1', limit: '500' } }, member, dependencies);
    await handleThreadRegisterRequest('thread_candidates', { method: 'GET', query: { communicationId: 'comm_1', tenant_id: 'other_org' } }, member, dependencies);
    assert.deepEqual(dependencies.calls, [
      { method: 'listThreadRegister', args: ['org_1', { status: 'all', personId, externalProjectId: 'project_1', limit: 200 }] },
      { method: 'getThreadCandidates', args: ['org_1', 'comm_1'] }
    ]);
  });

  test('allows only a validated correction shape and records the verified actor', async () => {
    const dependencies = harness();
    await handleThreadRegisterRequest('thread_correction', { method: 'POST', body: {
      communicationId: 'comm_1', thread_id: 'thread_2', reason_code: 'wrong_person', person_id: personId,
      update_identity: true, external_project_id: 'project_1', initiator_id: 'forged', tenant_id: 'forged', callback_url: 'https://evil.example'
    } }, member, dependencies);
    assert.deepEqual(dependencies.calls[0], { method: 'correctThread', args: ['org_1', 'comm_1', {
      thread_id: 'thread_2', reason_code: 'wrong_person', reason_detail: undefined, person_id: personId,
      update_identity: true, external_project_id: 'project_1', initiator_id: 'verified_user'
    }] });
  });

  test('passes validated history paging through and rejects invalid offsets', async () => {
    const dependencies = harness();
    await handleThreadRegisterRequest('thread_register', { method: 'GET', query: { threadId: 'thread_1', offset: '100', communicationOffset: '20' } }, member, dependencies);
    assert.deepEqual(dependencies.calls[0].args[1], { threadId: 'thread_1', offset: 100, communicationOffset: 20, status: 'open', personId: undefined, externalProjectId: undefined, limit: 100 });
    for (const offset of ['no', '-1', '1.5', '2147483648']) {
      await assert.rejects(handleThreadRegisterRequest('thread_register', { method: 'GET', query: { offset } }, member, dependencies), /non-negative integer/);
    }
  });

  test('rejects conflicting targets, unknown reasons, invalid people and identity updates without a person', async () => {
    for (const patch of [
      { thread_id: 'thread_2', create_new: true }, { reason_code: 'guess' },
      { person_id: 'HyperFlow-person-name' }, { update_identity: true }
    ]) {
      const dependencies = harness();
      await assert.rejects(handleThreadRegisterRequest('thread_correction', { method: 'POST', body: {
        communicationId: 'comm_1', create_new: true, reason_code: 'wrong_topic', ...patch
      } }, member, dependencies), (error: any) => error instanceof ThreadRegisterRequestError && error.status === 400);
      assert.equal(dependencies.calls.length, 0);
    }
  });

  test('does not permit a project from another tenant or forward workflow mutations', async () => {
    const dependencies = harness();
    await assert.rejects(handleThreadRegisterRequest('thread_update', { method: 'PATCH', body: { threadId: 'thread_1', external_project_id: 'other_project' } }, member, dependencies), /does not belong/);
    await handleThreadRegisterRequest('thread_update', { method: 'PATCH', body: { threadId: 'thread_1', title: '  Meeting  ', external_project_id: null, purpose: { type: 'human_ask', ask_id: 'forged' }, tenant_id: 'forged' } }, member, dependencies);
    assert.deepEqual(dependencies.calls, [{ method: 'updateThread', args: ['org_1', 'thread_1', { initiator_id: 'verified_user', title: 'Meeting', external_project_id: null }] }]);
  });

  test('rejects inaccessible source and destination projects before any correction or edit', async () => {
    const dependencies = harness();
    dependencies.client.getThread = async () => ({ external_project_id: 'foreign_project' });
    await assert.rejects(handleThreadRegisterRequest('thread_correction', { method: 'POST', body: {
      communicationId: 'comm_1', thread_id: 'thread_foreign', reason_code: 'wrong_project'
    } }, member, dependencies), (error: any) => error.status === 403);
    await assert.rejects(handleThreadRegisterRequest('thread_update', { method: 'PATCH', body: {
      threadId: 'thread_foreign', title: 'Unpermitted edit'
    } }, member, dependencies), (error: any) => error.status === 403);
    dependencies.client.getCommunication = async () => ({ correlation: { external_project_id: 'foreign_project' } });
    await assert.rejects(handleThreadRegisterRequest('thread_correction', { method: 'POST', body: {
      communicationId: 'comm_foreign', create_new: true, reason_code: 'wrong_topic'
    } }, member, dependencies), (error: any) => error.status === 403);
    assert.equal(dependencies.calls.length, 0);
  });

  test('enforces methods and rejects empty edits before calling the service', async () => {
    const dependencies = harness();
    await assert.rejects(handleThreadRegisterRequest('thread_correction', { method: 'GET' }, member, dependencies), (error: any) => error.status === 405);
    await assert.rejects(handleThreadRegisterRequest('thread_update', { method: 'PATCH', body: { threadId: 'thread_1' } }, member, dependencies), /editable thread field/);
    assert.equal(dependencies.calls.length, 0);
  });
});

describe('Communications thread register HTTP contract', () => {
  test('preserves existing auth and uses only the new read/correction routes', async () => {
    const calls: any[] = [];
    const fetchImpl: typeof fetch = async (url: any, init?: any) => {
      calls.push({ url: String(url), init });
      const response = String(url).includes('/thread-register') ? { data: [{ thread_id: 'thread_1', status: 'open' }], count: 1 }
        : String(url).endsWith('/thread-candidates') ? { communication_id: 'comm/1', current_thread_id: 'thread_1', candidates: [] }
          : { communication_id: 'comm/1', thread_id: 'thread_2', corrected: true };
      return new Response(JSON.stringify(response), { status: 200 });
    };
    const client = new HttpCommunicationsClient({ baseUrl: 'https://communications.example', apiKey: 'server-only', fetchImpl });
    const register = await client.listThreadRegister('org_1', { status: 'all', externalProjectId: 'project 1', limit: 100, offset: 100, threadId: 'thread_1', communicationOffset: 20 });
    assert.deepEqual(register.data[0].participants, []);
    await client.getThreadCandidates('org_1', 'comm/1');
    await client.correctThread('org_1', 'comm/1', { thread_id: 'thread_2', reason_code: 'wrong_topic' });
    await client.updateThread('org_1', 'thread/2', { title: 'Meeting' });
    assert.deepEqual(calls.map(call => [call.url, call.init.method]), [
      ['https://communications.example/v1/thread-register?status=all&external_project_id=project+1&limit=100&offset=100&thread_id=thread_1&communication_offset=20', 'GET'],
      ['https://communications.example/v1/communications/comm%2F1/thread-candidates', 'GET'],
      ['https://communications.example/v1/communications/comm%2F1/rethread', 'POST'],
      ['https://communications.example/v1/threads/thread%2F2', 'PATCH']
    ]);
    assert.ok(calls.every(call => call.init.headers['X-Tenant-Id'] === 'org_1' && call.init.headers['X-API-Key'] === 'server-only'));
    await assert.rejects(client.listThreadRegister(''), /Tenant id is required/);
  });

  test('the register is on demand, uses authenticated fetch and never calls provider send routes', () => {
    const source = readFileSync(new URL('../components/ThreadRegister.tsx', import.meta.url), 'utf8');
    assert.match(source, /useState\(false\)/);
    assert.match(source, /if \(!expanded\) return/);
    assert.match(source, /firebaseService\.authorizedFetch/);
    assert.match(source, /aria-expanded/);
    assert.match(source, /update_identity/);
    assert.match(source, /human_ask/);
    assert.doesNotMatch(source, /COMMUNICATIONS_API_KEY|\/v1\/emails|\/v1\/messages|\/v1\/calls/);
  });
});
