import type {
  CommunicationsPersonRef,
  CommunicationsClient,
  CommunicationsMailboxRef
} from './communications/types.js';
import type { ServiceSetupValidation, ServiceValidationCheck, TenantAgentProfile } from '../types.js';
import { createCommunicationsClient } from './communications/client.js';
import { validateGoogleWorkspaceSelection } from './integrations/googleWorkspace.js';
import { listWorkspaceConnectionRefs, readTenantAgentProfile, readTenantCommunicationsSettings } from './serverStore.js';

export interface EmailTriageSetupInput {
  template: 'email_triage';
  serviceProjectId?: string;
  projectName: string;
  accessPersonIds: string[];
  provider: 'gmail' | 'outlook';
  connectionId: string;
  localTime: string;
  timezone: string;
  triagePolicy: 'all_inbound' | 'human_only' | 'correlated_only';
  createDrafts: boolean;
  digestChannel: 'web' | 'email' | 'sms';
  digestRecipient?: string;
  authoritativeSync?: boolean;
}

export interface DailyCoachingSetupInput {
  template: 'daily_coaching';
  serviceProjectId?: string;
  projectName: string;
  accessPersonIds: string[];
  personId: string;
  phone: string;
  voiceIdentity?: string;
  workspaceConnectionId: string;
  documentId: string;
  spreadsheetId: string;
  sheetRange: string;
  localTime: string;
  timezone: string;
  retryAttempts: number;
  retryWindowMinutes: number;
  retryDelayMinutes: number;
  reviewRecipient: string;
  reviewChannels: Array<'web' | 'email' | 'sms'>;
}

export type ServiceSetupInput = EmailTriageSetupInput | DailyCoachingSetupInput;

const validTimezone = (value: string): boolean => {
  try { new Intl.DateTimeFormat('en-AU', { timeZone: value }).format(0); return true; }
  catch { return false; }
};
const validTime = (value: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const validEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validPhone = (value: string): boolean => /^\+[1-9]\d{7,14}$/.test(value);
const check = (key: string, label: string, ok: boolean, message: string): ServiceValidationCheck => ({ key, label, ok, message });

const mailboxHealthCheck = (mailbox: CommunicationsMailboxRef | undefined, provider: 'gmail' | 'outlook') => {
  if (!mailbox) return check('mailbox', 'Mailbox connection', false, 'Select a tenant-owned mailbox connection');
  if (mailbox.provider !== provider) return check('mailbox', 'Mailbox connection', false, `The selected connection is not ${provider}`);
  const healthy = ['connected', 'healthy'].includes(mailbox.state);
  const remediation = mailbox.state === 'expired' || mailbox.state === 'revoked'
    ? 'Reconnect the mailbox and grant consent again'
    : mailbox.lastError || `Mailbox state is ${mailbox.state}`;
  return check('mailbox', 'Mailbox connection', healthy && mailbox.canCreateDrafts, healthy && mailbox.canCreateDrafts ? `${mailbox.mailboxAddress} is connected and can create drafts` : remediation);
};

export const validateServiceSetup = async (
  orgId: string,
  input: ServiceSetupInput,
  client: CommunicationsClient = createCommunicationsClient()
): Promise<ServiceSetupValidation> => {
  const checks: ServiceValidationCheck[] = [];
  checks.push(check('identity', 'Project identity', Boolean(input.projectName.trim()), input.projectName.trim() ? 'Project name is set' : 'Project name is required'));
  checks.push(check('access', 'Project access', Array.isArray(input.accessPersonIds) && input.accessPersonIds.length > 0, input.accessPersonIds?.length ? `${input.accessPersonIds.length} person access grant(s) selected` : 'Select at least one Communications person who may use this project'));
  checks.push(check('schedule', 'Daily schedule', validTime(input.localTime) && validTimezone(input.timezone), validTime(input.localTime) && validTimezone(input.timezone) ? `${input.localTime} ${input.timezone}` : 'Enter a valid local time and IANA timezone'));

  if (input.template === 'email_triage') {
    let mailboxes: CommunicationsMailboxRef[] = [];
    try {
      mailboxes = await client.listMailboxes(orgId);
      if (input.authoritativeSync && input.connectionId) {
        const sync = await client.syncMailbox(orgId, input.connectionId, 'service-setup-validation');
        if (sync.in_progress === true) checks.push(check('sync', 'Authoritative mailbox sync', false, 'A mailbox sync is already running; wait and validate again'));
        else checks.push(check('sync', 'Authoritative mailbox sync', true, 'Mailbox synchronization completed'));
        mailboxes = await client.listMailboxes(orgId);
      }
    } catch (error: any) {
      checks.push(check('mailbox_api', 'Mailbox service', false, error?.message || 'Mailbox service is unavailable'));
    }
    checks.push(mailboxHealthCheck(mailboxes.find(mailbox => mailbox.id === input.connectionId), input.provider));
    const settings = await readTenantCommunicationsSettings(orgId);
    const allowed = settings.allowedAutomaticActions || [];
    checks.push(check('classification', 'Classification permission', allowed.includes('classify'), allowed.includes('classify') ? 'Allowed by tenant policy' : 'Enable classify in tenant automatic-action permissions'));
    const needsMailboxDraft = input.createDrafts || input.digestChannel === 'email';
    checks.push(check('drafts', 'Draft permission', !needsMailboxDraft || allowed.includes('create_draft'), !needsMailboxDraft || allowed.includes('create_draft') ? 'Draft behavior is within the tenant permission ceiling' : 'Enable create_draft at tenant level or disable message drafts and the email digest for this project'));
    const recipientOk = input.digestChannel === 'web'
      || (input.digestChannel === 'email' ? validEmail(input.digestRecipient || '') : validPhone(input.digestRecipient || ''));
    checks.push(check('digest', 'Digest delivery', recipientOk, recipientOk ? `${input.digestChannel} digest is configured` : `A valid ${input.digestChannel} recipient is required`));
    checks.push(check('digest_policy', 'Digest permission', input.digestChannel !== 'sms' || allowed.includes('send_reply'), input.digestChannel !== 'sms' || allowed.includes('send_reply') ? 'Digest delivery is within the tenant permission ceiling' : 'Enable send_reply at tenant level or use a web/email-draft digest'));
  } else {
    let people: CommunicationsPersonRef[] = [];
    try { people = await client.listPeople(orgId); }
    catch (error: any) { checks.push(check('people_api', 'Communications contacts', false, error?.message || 'Communications contacts are unavailable')); }
    const person = people.find(candidate => candidate.id === input.personId);
    checks.push(check('person', 'Coaching person', Boolean(person || input.personId.trim()), person ? `${person.name || person.id} is available` : input.personId.trim() ? 'Person identity is configured locally' : 'Select the person receiving coaching'));
    checks.push(check('phone', 'Phone number', validPhone(input.phone), validPhone(input.phone) ? 'Phone number uses E.164 format' : 'Phone number must use E.164 format, for example +61412345678'));
    const [settings, agent, workspaces] = await Promise.all([
      readTenantCommunicationsSettings(orgId),
      readTenantAgentProfile(orgId),
      listWorkspaceConnectionRefs(orgId)
    ]);
    const from = String(input.voiceIdentity || settings.fromNumber || '').trim();
    checks.push(check('voice', 'Voice identity', validPhone(from), validPhone(from) ? 'Voice sending identity is configured' : 'Select or configure an E.164 voice identity'));
    const workspace = workspaces.find(connection => connection.id === input.workspaceConnectionId && connection.state === 'connected');
    checks.push(check('workspace', 'Google Workspace', Boolean(workspace), workspace ? `${workspace.accountEmail} is connected` : 'Select a connected Google Workspace account'));
    if (workspace) {
      try {
        const verified = await validateGoogleWorkspaceSelection({
          orgId, connectionId: input.workspaceConnectionId, documentId: input.documentId,
          spreadsheetId: input.spreadsheetId, sheetRange: input.sheetRange
        });
        checks.push(check('document_read', 'Google Doc read', true, verified.documentTitle || 'Document is readable'));
        checks.push(check('sheet_read', 'Google Sheet read', true, `${verified.sheetRange} is readable`));
        checks.push(check('sheet_append', 'Google Sheet append permission', verified.canAppend, verified.canAppend ? 'The selected Sheet is editable' : 'The connected account cannot edit the selected Sheet'));
      } catch (error: any) {
        checks.push(check('workspace_resources', 'Google resources', false, error?.message || 'Selected Google resources could not be validated'));
      }
    }
    const retryOk = Number.isInteger(input.retryAttempts) && input.retryAttempts >= 0 && input.retryAttempts <= 5
      && input.retryDelayMinutes >= 5 && input.retryWindowMinutes >= input.retryDelayMinutes;
    checks.push(check('retries', 'Retry policy', retryOk, retryOk ? 'Retry limits are valid' : 'Use 0-5 attempts, at least 5 minutes between attempts, and a window no shorter than the delay'));
    const reviewOk = input.reviewChannels.includes('web')
      || (input.reviewChannels.includes('email') && validEmail(input.reviewRecipient))
      || (input.reviewChannels.includes('sms') && validPhone(input.reviewRecipient));
    checks.push(check('review', 'Review delivery', reviewOk, reviewOk ? 'Review channels are reachable' : 'Keep web review enabled or enter a valid email/phone review recipient'));
    const profile = agent as TenantAgentProfile | null;
    checks.push(check('call_policy', 'Call permission', Boolean(profile?.automaticActions?.includes('call')), profile?.automaticActions?.includes('call') ? 'Calls are allowed by tenant agent policy' : 'Enable call in the tenant agent policy'));
    checks.push(check('sheet_policy', 'Sheet write permission', Boolean(profile?.automaticActions?.includes('sheet_write')), profile?.automaticActions?.includes('sheet_write') ? 'Sheet writes are allowed by tenant agent policy' : 'Enable sheet_write in the tenant agent policy'));
  }

  return { ready: checks.every(item => item.ok), checks, validatedAt: Date.now() };
};
