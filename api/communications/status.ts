import { waitUntil } from '@vercel/functions';
import { processAgentInbox } from '../../lib/agentRouter.js';
import { readDiagnostics } from '../../lib/tenantControl/diagnostics.js';
import { TenantControlError } from '../../lib/tenantControl/model.js';
import { handleMemoryContextRequest } from '../../lib/communications/memoryContext.js';
import { handleMeetingRequest, MeetingRequestError } from '../../lib/communications/meetings.js';
import { handleCommitments } from '../../lib/commitments/api.js';
import { CommitmentError } from '../../lib/commitments/model.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { CommunicationsPersonRef } from '../../lib/communications/types.js';
import { ApiAuthError, requireAppMember, requireProjectInTenant } from '../../lib/apiAuth.js';
import { createCommunicationsClient } from '../../lib/communications/client.js';
import { accountEmailPolicy } from '../../lib/communications/accountEmailPolicy.js';
import { CommunicationsApiError } from '../../lib/communications/errors.js';
import { handleThreadRegisterRequest, THREAD_REGISTER_ACTIONS, threadRegisterErrorStatus } from '../../lib/communications/threadRegister.js';
import {
  listMailboxConnectionRefs,
  listCoachingSessions,
  listTenantCoachingSessions,
  listAgentInboxJobs,
  listExternalActionReceipts,
  listTenantSchedules,
  listWorkspaceConnectionRefs,
  consumeOAuthStateNonce,
  readTenantAgentProfile,
  readTenantCommunicationsSettings,
  readWorkspaceResourceGrant,
  registerOAuthStateNonce,
  replayAgentInboxJob,
  requireOrganizationMember,
  saveWorkspaceResourceGrant,
  saveMailboxConnectionRef,
  saveTenantAgentProfile
} from '../../lib/serverStore.js';
import {
  createGoogleOAuthState,
  exchangeGoogleCode,
  googleAccountEmail,
  googleAuthorizationUrl,
  verifyGoogleOAuthState
} from '../../lib/integrations/googleOAuth.js';
import {
  listGoogleWorkspaceResources,
  readGrantedGoogleDoc,
  readGrantedGoogleSheet,
  storeGoogleWorkspaceCredential
} from '../../lib/integrations/googleWorkspace.js';
import { serviceProjectRequest, SERVICE_PROJECT_ROUTES } from '../../lib/serviceProjectApi.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = typeof req.query.action === 'string' ? req.query.action : undefined;
  try {
    if (action === 'google_callback') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      const state = verifyGoogleOAuthState(String(req.query.state || ''));
      await requireOrganizationMember(state.uid, state.tenantId);
      const claimed = await consumeOAuthStateNonce(state.tenantId, state.nonce, state.uid);
      if (!claimed) {
        console.warn('[google-oauth] callback rejected: state unavailable');
        return res.status(400).json({ error: 'OAuth state was already used or expired' });
      }
      const code = String(req.query.code || '');
      if (!code) {
        console.warn('[google-oauth] callback rejected: code missing');
        return res.status(400).json({ error: 'Google authorization code is required' });
      }
      const tokens = await exchangeGoogleCode(code);
      if (!tokens.refresh_token) {
        console.warn('[google-oauth] callback rejected: refresh token missing');
        return res.status(400).json({ error: 'Google did not issue offline access; reconnect and grant consent' });
      }
      const accountEmail = await googleAccountEmail(tokens.access_token);
      await storeGoogleWorkspaceCredential(state.tenantId, {
        tokens,
        accountEmail,
        scopes: String(tokens.scope || '').split(/\s+/).filter(Boolean)
      });
      const base = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
      if (!base) return res.status(200).json({ connected: true, accountEmail });
      const destination = new URL(state.returnTo, `${base}/`);
      destination.searchParams.set('google_workspace', 'connected');
      return res.redirect(302, destination.toString());
    }

    const member = await requireAppMember(req);
    if (action === 'meetings') return res.status(200).json(await handleMeetingRequest(req, member));
    if (action === 'commitments') return res.status(200).json(await handleCommitments(req, member));
    if (action === 'memory') return res.status(200).json(await handleMemoryContextRequest(req, member));
    if (action === 'email_policy') return res.status(200).json(await accountEmailPolicy(member, req.method, req.body));
    if (action && (THREAD_REGISTER_ACTIONS as readonly string[]).includes(action)) {
      return res.status(200).json(await handleThreadRegisterRequest(action, req, member));
    }
    if (action && Object.values(SERVICE_PROJECT_ROUTES).includes(action as any)) {
      const result = await serviceProjectRequest(action, req, member);
      return res.status(result.status).json(result.body);
    }
    if (action === 'google_start') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const state = createGoogleOAuthState(member.orgId, member.uid, String(req.body?.returnTo || '/'));
      const verified = verifyGoogleOAuthState(state);
      await registerOAuthStateNonce(member.orgId, verified.nonce, member.uid, verified.exp);
      return res.status(200).json({ authorizationUrl: googleAuthorizationUrl(state,req.body?.calendarAccess==='write'?'write':req.body?.calendarAccess==='read'?'read':undefined) });
    }
    if (action === 'google_resources') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      const connectionId = String(req.query.connectionId || '');
      const kind = req.query.kind === 'document' || req.query.kind === 'spreadsheet' ? req.query.kind : undefined;
      return res.status(200).json({ data: await listGoogleWorkspaceResources(member.orgId, connectionId, kind) });
    }
    if (action === 'workspace_grant') {
      const projectId = String(req.query.projectId || req.body?.projectId || '');
      if (!projectId) return res.status(400).json({ error: 'projectId is required' });
      await requireProjectInTenant(member.orgId, projectId);
      if (req.method === 'PUT' && !['owner', 'admin'].includes(member.role)) return res.status(403).json({ error: 'Administrator membership required' });
      if (req.method === 'GET') return res.status(200).json({ grant: await readWorkspaceResourceGrant(member.orgId, projectId) });
      if (req.method === 'PUT') return res.status(200).json({ grant: await saveWorkspaceResourceGrant(member.orgId, projectId, req.body || {}) });
      return res.status(405).json({ error: 'Method not allowed' });
    }
    if (action === 'google_doc') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      return res.status(200).json({ document: await readGrantedGoogleDoc(member.orgId, String(req.query.projectId || '')) });
    }
    if (action === 'google_sheet') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      return res.status(200).json({ sheet: await readGrantedGoogleSheet(member.orgId, String(req.query.projectId || '')) });
    }
    if (action === 'coaching_sessions') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      const projectId = String(req.query.projectId || '');
      if (!projectId) return res.status(400).json({ error: 'projectId is required' });
      return res.status(200).json({ data: await listCoachingSessions(member.orgId, projectId, Number(req.query.limit || 50)) });
    }
    if (action === 'operations') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      if (req.query.view === 'diagnostics') return res.status(200).json(await readDiagnostics(member,req.query.reason));
      const [agentJobs, coachingSessions, externalActions, schedules] = await Promise.all([
        listAgentInboxJobs(member.orgId, 100),
        listTenantCoachingSessions(member.orgId, 100),
        listExternalActionReceipts(member.orgId, 100),
        listTenantSchedules(member.orgId)
      ]);
      return res.status(200).json({ agentJobs, coachingSessions, externalActions, schedules });
    }
    if (action === 'operations_replay') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const jobId = String(req.body?.jobId || '').trim();
      if (!jobId) return res.status(400).json({ error: 'jobId is required' });
      const job = await replayAgentInboxJob(member.orgId, jobId);
      waitUntil(processAgentInbox(1, {orgId: member.orgId, jobId}).catch(error => console.error('Agent replay failed', error?.message)));
      return res.status(200).json({ job });
    }
    if (action === 'mailbox_start') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const base = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
      if (!base) return res.status(503).json({ error: 'PUBLIC_BASE_URL is required for mailbox OAuth' });
      const destination = new URL(String(req.body?.returnTo || '/'), `${base}/`);
      if (destination.origin !== new URL(base).origin) return res.status(400).json({ error: 'Mailbox OAuth return path must stay on HyperFlow' });
      const provider = req.body?.provider === 'outlook' ? 'outlook' : req.body?.provider === 'gmail' || !req.body?.provider ? 'gmail' : null;
      if (!provider) return res.status(400).json({ error: 'provider must be gmail or outlook' });
      const setupDraftId = typeof req.body?.setupDraftId === 'string' ? req.body.setupDraftId.trim() : undefined;
      const authorizationUrl = await createCommunicationsClient().startMailboxOAuth(member.orgId, member.uid, destination.toString(), provider, setupDraftId);
      return res.status(200).json({ authorizationUrl });
    }
    if (action === 'mailbox_sync') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const connectionId = String(req.query.connectionId || req.body?.connectionId || '');
      if (!connectionId) return res.status(400).json({ error: 'connectionId is required' });
      return res.status(200).json({ result: await createCommunicationsClient().syncMailbox(member.orgId, connectionId, member.uid) });
    }
    if (action === 'integrations') {
      if (req.method === 'GET') {
        const [agent, storedMailboxes, workspaces] = await Promise.all([
          readTenantAgentProfile(member.orgId),
          listMailboxConnectionRefs(member.orgId),
          listWorkspaceConnectionRefs(member.orgId)
        ]);
        let mailboxes = storedMailboxes;
        let people: CommunicationsPersonRef[] = [];
        try {
          const client = createCommunicationsClient();
          const [live, livePeople] = await Promise.all([
            client.listMailboxes(member.orgId),
            client.listPeople(member.orgId)
          ]);
          people = livePeople;
          mailboxes = await Promise.all(live.map(connection => saveMailboxConnectionRef(member.orgId, {
            id: connection.id,
            provider: connection.provider,
            mailboxAddress: connection.mailboxAddress,
            state: connection.state === 'healthy' ? 'connected' : connection.state === 'syncing' ? 'pending' : connection.state,
            scopes: connection.scopes,
            lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt ? Date.parse(connection.lastSuccessfulSyncAt) : undefined
          })));
        } catch {
          // Preserve the last non-secret snapshot when Communications is temporarily unavailable.
        }
        return res.status(200).json({ agent, mailboxes, workspaces, people });
      }
      if (req.method === 'PATCH') {
        await (await import('../../lib/cockpit/profileAccess.js')).assertChannelProfileAccess(member, req.body?.agent || {});
        const agent = await saveTenantAgentProfile(member.orgId, req.body?.agent || {});
        return res.status(200).json({ agent });
      }
      return res.status(405).json({ error: 'Method not allowed' });
    }
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const settings = await readTenantCommunicationsSettings(member.orgId);
    try {
      await createCommunicationsClient().listCommunications(member.orgId, { limit: 1 });
      return res.status(200).json({
        connected: true,
        emailReady: Boolean(settings.defaultEmailIdentity),
        connectionId: settings.connectionId || null,
        emailIdentity: settings.defaultEmailIdentity || null,
        replyIdentity: settings.replyServiceIdentity || null
      });
    } catch (error: any) {
      return res.status(200).json({ connected: false, error: error?.message || 'Communications Service unavailable' });
    }
  } catch (error: any) {
    if (error instanceof TenantControlError) return res.status(error.status).json({error:error.message});
    if (error instanceof MeetingRequestError) return res.status(error.status).json({error:error.message,details:error.details});
    if (error instanceof CommitmentError) return res.status(error.status).json({ error: error.message });
    return res.status(error instanceof ApiAuthError ? error.status : action === 'email_policy' && error instanceof CommunicationsApiError ? error.status || 503 : threadRegisterErrorStatus(error)).json({ error: error?.message || String(error) });
  }
}
