import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpCommunicationsClient } from '../lib/communications/client.js';
import { assertProjectEmailSendAllowed } from '../lib/communications/projectEmailPolicy.js';

test('project gate defaults off and rejects missing, foreign, archived and malformed grants', async () => {
  for (const project of [null, {}, { emailSendingEnabled: false }, { emailSendingEnabled: 'true' }, { emailSendingEnabled: true, isArchived: true }]) {
    await assert.rejects(assertProjectEmailSendAllowed('org', 'project', async () => project ? { project } as any : null),
      (error: any) => error.status === 403);
  }
  let lookedUp = false;
  const lookup = async () => { lookedUp = true; return { project: { emailSendingEnabled: true } }; };
  await assert.rejects(assertProjectEmailSendAllowed('org', undefined, lookup));
  await assert.rejects(assertProjectEmailSendAllowed(undefined, 'project', lookup));
  assert.equal(lookedUp, false);
});

test('every email purpose reads current saved project, cannot self-authorize, and obeys revocation', async t => {
  const previous = process.env.EMAIL_SEND_POLICY_BY_TENANT;
  delete process.env.EMAIL_SEND_POLICY_BY_TENANT;
  t.after(() => { if (previous === undefined) delete process.env.EMAIL_SEND_POLICY_BY_TENANT; else process.env.EMAIL_SEND_POLICY_BY_TENANT = previous; });
  let enabled = false;
  let mode = 'allow_send';
  let sends = 0;
  const client = new HttpCommunicationsClient({ baseUrl: 'https://communications.invalid', apiKey: 'fixture',
    projectLookup: async (org, project) => {
      assert.equal(org, 'org');
      return project === 'owned' ? { project: { emailSendingEnabled: enabled } } : null;
    },
    fetchImpl: async url => {
      if (String(url).endsWith('/tenant-policy/email')) return Response.json({ mode, version: 'v1' });
      assert.ok(String(url).endsWith('/v1/emails'));
      sends++;
      return Response.json({ id: 'email-fixture' });
    }
  });
  const request = (purpose: string, project = 'owned') => ({ to: ['fixture@example.invalid'], subject: 'Fixture', text: 'Fixture',
    correlation: { tenant_id: 'org', external_project_id: project, task_id: 'task', run_id: 'run' },
    purpose: { type: purpose }, emailSendingEnabled: true, approved: true });
  for (const purpose of ['workflow_action', 'workflow_notification', 'human_ask', 'triage']) {
    await assert.rejects(client.sendEmail(request(purpose)), (error: any) => error.status === 403);
  }
  assert.equal(sends, 0);
  enabled = true;
  await client.sendEmail(request('workflow_action'));
  assert.equal(sends, 1);
  await assert.rejects(client.sendEmail(request('workflow_action', 'foreign')));
  enabled = false;
  await assert.rejects(client.sendEmail(request('workflow_action')));
  enabled = true;
  mode = 'draft_only';
  await assert.rejects(client.sendEmail(request('workflow_action')));
  assert.equal(sends, 1);
});

test('project storage failure never dispatches email', async () => {
  let writes = 0;
  const client = new HttpCommunicationsClient({ baseUrl: 'https://communications.invalid', apiKey: 'fixture',
    projectLookup: async () => { throw new Error('Store unavailable'); },
    fetchImpl: async (_url, init) => { if (init?.method === 'POST') writes++; return Response.json({ mode: 'allow_send', version: 'v1' }); }
  });
  await assert.rejects(client.sendEmail({ correlation: { tenant_id: 'org', external_project_id: 'owned' } } as any));
  assert.equal(writes, 0);
});
