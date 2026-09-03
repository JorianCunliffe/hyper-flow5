import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleAlert, ExternalLink, Loader2, Mail, Phone, RefreshCw, X } from 'lucide-react';
import type {
  AppSettings,
  CommunicationsPersonRef,
  MailboxConnectionRef,
  ServiceSetupValidation,
  WorkspaceConnectionRef
} from '../types';
import type { ServiceSetupInput } from '../lib/serviceSetup';
import { firebaseService } from '../services/firebaseService';
import { COACHING_MAX_ATTEMPTS, COACHING_RETRY_DELAY_MINUTES, COACHING_RETRY_WINDOW_MINUTES } from '../lib/coachingRetry';

type Template = ServiceSetupInput['template'];

interface Props {
  isOpen: boolean;
  template?: Template;
  settings: AppSettings;
  initial?: Partial<ServiceSetupInput>;
  onClose: () => void;
  onComplete: (setup: ServiceSetupInput) => Promise<void> | void;
}

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Australia/Brisbane';
const emailDefaults = (): ServiceSetupInput => ({
  template: 'email_triage', projectName: 'Daily Email Triage', accessPersonIds: [], provider: 'gmail', connectionId: '',
  localTime: '09:00', timezone: timeZone, triagePolicy: 'human_only', createDrafts: true,
  digestChannel: 'web', digestRecipient: '', authoritativeSync: true
});
const coachingDefaults = (): ServiceSetupInput => ({
  template: 'daily_coaching', projectName: 'Daily Coaching', accessPersonIds: [], personId: '', phone: '', voiceIdentity: '',
  workspaceConnectionId: '', documentId: '', spreadsheetId: '', sheetRange: 'Coaching!A:G',
  localTime: '09:00', timezone: timeZone, retryAttempts: COACHING_MAX_ATTEMPTS, retryWindowMinutes: COACHING_RETRY_WINDOW_MINUTES,
  retryDelayMinutes: COACHING_RETRY_DELAY_MINUTES, reviewRecipient: '', reviewChannels: ['web']
});

const api = async (url: string, init?: RequestInit) => {
  const response = await firebaseService.authorizedFetch(url, {
    ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 422) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
};

export const ServiceProjectWizard: React.FC<Props> = ({ isOpen, template = 'email_triage', settings, initial, onClose, onComplete }) => {
  const [setup, setSetup] = useState<ServiceSetupInput>(() => ({ ...(template === 'email_triage' ? emailDefaults() : coachingDefaults()), ...(initial || {}) } as ServiceSetupInput));
  const [mailboxes, setMailboxes] = useState<MailboxConnectionRef[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceConnectionRef[]>([]);
  const [people, setPeople] = useState<CommunicationsPersonRef[]>([]);
  const [resources, setResources] = useState<Array<{ id: string; name: string; kind: 'document' | 'spreadsheet'; canEdit?: boolean }>>([]);
  const [validation, setValidation] = useState<ServiceSetupValidation | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const [draftId, setDraftId] = useState<string>();

  const patch = (values: Partial<ServiceSetupInput>) => {
    setSetup(current => ({ ...current, ...values } as ServiceSetupInput));
    setValidation(null);
    setError(undefined);
  };

  const loadIntegrations = async () => {
    const body = await api('/api/integrations');
    setMailboxes(Array.isArray(body.mailboxes) ? body.mailboxes : []);
    setWorkspaces(Array.isArray(body.workspaces) ? body.workspaces : []);
    setPeople(Array.isArray(body.people) ? body.people : []);
  };

  useEffect(() => {
    if (!isOpen) return;
    const next = { ...(template === 'email_triage' ? emailDefaults() : coachingDefaults()), ...(initial || {}) } as ServiceSetupInput;
    setSetup(next);
    setValidation(null);
    setError(undefined);
    const params = new URLSearchParams(window.location.search);
    const resumedId = params.get('service_setup') || params.get('setup_draft_id') || (!initial ? sessionStorage.getItem('hyperflow_service_setup_draft') : null);
    void (async () => {
      setWorking(true);
      try {
        if (resumedId) {
          const body = await api(`/api/service-projects/setup-draft?id=${encodeURIComponent(resumedId)}`);
          if (body.draft?.data) {
            setSetup(body.draft.data as ServiceSetupInput);
            setDraftId(body.draft.id);
          }
        }
        await loadIntegrations();
      } catch (e: any) { setError(e?.message || String(e)); }
      finally { setWorking(false); }
    })();
  }, [isOpen, template]);

  useEffect(() => {
    if (!isOpen || setup.template !== 'daily_coaching' || !setup.workspaceConnectionId) return;
    void api(`/api/integrations/google/resources?connectionId=${encodeURIComponent(setup.workspaceConnectionId)}`)
      .then(body => setResources(Array.isArray(body.data) ? body.data : []))
      .catch((e: any) => setError(e?.message || String(e)));
  }, [isOpen, setup.template, setup.template === 'daily_coaching' ? setup.workspaceConnectionId : '']);

  const connectedMailboxes = useMemo(() => mailboxes.filter(item => item.provider === (setup.template === 'email_triage' ? setup.provider : item.provider)), [mailboxes, setup]);

  const preserveDraft = async (): Promise<string> => {
    const body = await api('/api/service-projects/setup-draft', {
      method: draftId ? 'PUT' : 'POST',
      body: JSON.stringify({ id: draftId, template: setup.template, data: setup })
    });
    const id = String(body.draft.id);
    setDraftId(id);
    sessionStorage.setItem('hyperflow_service_setup_draft', id);
    return id;
  };

  const connectMailbox = async () => {
    if (setup.template !== 'email_triage') return;
    setWorking(true); setError(undefined);
    try {
      const id = await preserveDraft();
      const returnTo = `${window.location.pathname}?service_setup=${encodeURIComponent(id)}`;
      const body = await api('/api/integrations/mailbox/start', { method: 'POST', body: JSON.stringify({ provider: setup.provider, setupDraftId: id, returnTo }) });
      window.location.assign(body.authorizationUrl);
    } catch (e: any) { setError(e?.message || String(e)); setWorking(false); }
  };

  const connectGoogle = async () => {
    setWorking(true); setError(undefined);
    try {
      const id = await preserveDraft();
      const body = await api('/api/integrations/google/start', { method: 'POST', body: JSON.stringify({ returnTo: `${window.location.pathname}?service_setup=${encodeURIComponent(id)}` }) });
      window.location.assign(body.authorizationUrl);
    } catch (e: any) { setError(e?.message || String(e)); setWorking(false); }
  };

  const validate = async () => {
    setWorking(true); setError(undefined);
    try {
      await preserveDraft();
      const body = await api('/api/service-projects/validate', { method: 'POST', body: JSON.stringify({ setup }) });
      setValidation(body.validation);
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setWorking(false); }
  };

  const finish = async () => {
    if (!validation?.ready) return;
    setWorking(true); setError(undefined);
    try {
      await onComplete(setup);
      sessionStorage.removeItem('hyperflow_service_setup_draft');
      const destination = new URL(window.location.href);
      destination.searchParams.delete('service_setup');
      destination.searchParams.delete('setup_draft_id');
      window.history.replaceState({}, '', `${destination.pathname}${destination.search}${destination.hash}`);
      onClose();
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setWorking(false); }
  };

  if (!isOpen) return null;
  const field = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';
  const label = 'mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500';
  return <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
    <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div><h2 className="text-2xl font-black text-slate-900">{setup.template === 'email_triage' ? 'Email Triage Setup' : 'Daily Coaching Setup'}</h2><p className="mt-1 text-sm text-slate-500">The project is created only after every readiness check passes.</p></div>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close setup"><X /></button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="md:col-span-2"><span className={label}>Project name</span><input className={field} value={setup.projectName} onChange={e => patch({ projectName: e.target.value })} /></label>
        <fieldset className="md:col-span-2 rounded-xl border border-slate-200 p-3"><legend className={label}>People allowed to use this project</legend><div className="flex flex-wrap gap-3">{people.map(person => <label key={person.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold"><input type="checkbox" checked={setup.accessPersonIds.includes(person.id)} onChange={() => patch({ accessPersonIds: setup.accessPersonIds.includes(person.id) ? setup.accessPersonIds.filter(id => id !== person.id) : [...setup.accessPersonIds, person.id] })} />{person.name || person.email || person.phone || person.id}</label>)}{!people.length && <span className="text-sm text-amber-700">No Communications people are available yet.</span>}</div></fieldset>
        {setup.template === 'email_triage' ? <>
          <label><span className={label}>Mailbox provider</span><select className={field} value={setup.provider} onChange={e => patch({ provider: e.target.value as 'gmail' | 'outlook', connectionId: '' })}><option value="gmail">Gmail</option><option value="outlook">Outlook</option></select></label>
          <label><span className={label}>Connected mailbox</span><select className={field} value={setup.connectionId} onChange={e => patch({ connectionId: e.target.value })}><option value="">Select mailbox…</option>{connectedMailboxes.map(item => <option key={item.id} value={item.id}>{item.mailboxAddress} · {item.state}</option>)}</select></label>
          <button type="button" onClick={() => void connectMailbox()} className="md:col-span-2 flex items-center justify-center gap-2 rounded-xl border border-indigo-200 px-4 py-2 text-sm font-bold text-indigo-700"><ExternalLink size={16} /> Connect another {setup.provider === 'gmail' ? 'Google' : 'Microsoft'} account</button>
          <label><span className={label}>Inbound policy</span><select className={field} value={setup.triagePolicy} onChange={e => patch({ triagePolicy: e.target.value as any })}><option value="human_only">Human only</option><option value="all_inbound">All inbound</option><option value="correlated_only">Correlated replies only</option></select></label>
          <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold"><input type="checkbox" checked={setup.createDrafts} onChange={e => patch({ createDrafts: e.target.checked })} /> Create provider-native drafts</label>
          <label><span className={label}>Digest channel</span><select className={field} value={setup.digestChannel} onChange={e => patch({ digestChannel: e.target.value as any })}><option value="web">HyperFlow</option><option value="email">Email draft</option><option value="sms">SMS</option></select></label>
          {setup.digestChannel !== 'web' && <label><span className={label}>Digest recipient</span><input className={field} type={setup.digestChannel === 'email' ? 'email' : 'tel'} value={setup.digestRecipient || ''} onChange={e => patch({ digestRecipient: e.target.value })} /></label>}
        </> : <>
          <label><span className={label}>Person receiving coaching</span><select className={field} value={setup.personId} onChange={e => { const person = people.find(item => item.id === e.target.value); patch({ personId: e.target.value, accessPersonIds: setup.accessPersonIds.includes(e.target.value) ? setup.accessPersonIds : [...setup.accessPersonIds, e.target.value].filter(Boolean), phone: person?.phone || setup.phone, reviewRecipient: person?.email || setup.reviewRecipient }); }}><option value="">Select person…</option>{people.map(item => <option key={item.id} value={item.id}>{item.name || item.email || item.phone || item.id}</option>)}</select></label>
          <label><span className={label}>Phone number</span><input className={field} type="tel" value={setup.phone} onChange={e => patch({ phone: e.target.value })} placeholder="+61412345678" /></label>
          <label><span className={label}>Voice/SMS identity</span><input className={field} type="tel" value={setup.voiceIdentity || settings.communications?.fromNumber || ''} onChange={e => patch({ voiceIdentity: e.target.value })} placeholder="+61412345678" /></label>
          <label><span className={label}>Google Workspace</span><select className={field} value={setup.workspaceConnectionId} onChange={e => patch({ workspaceConnectionId: e.target.value, documentId: '', spreadsheetId: '' })}><option value="">Select account…</option>{workspaces.map(item => <option key={item.id} value={item.id}>{item.accountEmail} · {item.state}</option>)}</select></label>
          <button type="button" onClick={() => void connectGoogle()} className="md:col-span-2 flex items-center justify-center gap-2 rounded-xl border border-indigo-200 px-4 py-2 text-sm font-bold text-indigo-700"><ExternalLink size={16} /> Connect another Google Workspace account</button>
          <label><span className={label}>Coaching Google Doc</span><select className={field} value={setup.documentId} onChange={e => patch({ documentId: e.target.value })}><option value="">Select document…</option>{resources.filter(item => item.kind === 'document').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span className={label}>Coaching Google Sheet</span><select className={field} value={setup.spreadsheetId} onChange={e => patch({ spreadsheetId: e.target.value })}><option value="">Select spreadsheet…</option>{resources.filter(item => item.kind === 'spreadsheet').map(item => <option key={item.id} value={item.id}>{item.name}{item.canEdit === false ? ' · read only' : ''}</option>)}</select></label>
          <label><span className={label}>Allowed Sheet range</span><input className={field} value={setup.sheetRange} onChange={e => patch({ sheetRange: e.target.value })} /></label>
          <label><span className={label}>Review recipient</span><input className={field} value={setup.reviewRecipient} onChange={e => patch({ reviewRecipient: e.target.value })} placeholder="email or E.164 phone" /></label>
          <fieldset className="md:col-span-2 rounded-xl border border-slate-200 p-3"><legend className={label}>Review channels</legend><div className="flex flex-wrap gap-4">{(['web', 'email', 'sms'] as const).map(channel => <label key={channel} className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={setup.reviewChannels.includes(channel)} onChange={() => patch({ reviewChannels: setup.reviewChannels.includes(channel) ? setup.reviewChannels.filter(item => item !== channel) : [...setup.reviewChannels, channel] })} />{channel}</label>)}</div></fieldset>
          <label><span className={label}>Total call attempts (including first call)</span><input className={field} type="number" min={1} max={5} value={setup.retryAttempts} onChange={e => patch({ retryAttempts: Number(e.target.value) })} /></label>
          <label><span className={label}>Retry delay (minutes)</span><input className={field} type="number" min={5} value={setup.retryDelayMinutes} onChange={e => patch({ retryDelayMinutes: Number(e.target.value) })} /></label>
          <label><span className={label}>Retry window (minutes)</span><input className={field} type="number" min={5} value={setup.retryWindowMinutes} onChange={e => patch({ retryWindowMinutes: Number(e.target.value) })} /></label>
          <p className="md:col-span-2 text-sm text-slate-500">{Math.max(0, setup.retryAttempts - 1)} automatic {setup.retryAttempts === 2 ? 'retry' : 'retries'} per coaching session, waiting {setup.retryDelayMinutes} minutes after a failed call. Voicemail and early hangups are retryable; completed calls and wrong numbers are not. Retries run on the first scheduler tick after the delay.</p>
        </>}
        <label><span className={label}>Daily time</span><input className={field} type="time" value={setup.localTime} onChange={e => patch({ localTime: e.target.value })} /></label>
        <label><span className={label}>Timezone</span><input className={field} value={setup.timezone} onChange={e => patch({ timezone: e.target.value })} /></label>
      </div>

      {error && <div className="mt-5 flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><CircleAlert size={18} />{error}</div>}
      {validation && <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4"><h3 className="mb-3 font-black text-slate-900">Readiness</h3><div className="space-y-2">{validation.checks.map(item => <div key={item.key} className="flex items-start gap-2 text-sm">{item.ok ? <CheckCircle2 className="mt-0.5 text-emerald-600" size={16} /> : <CircleAlert className="mt-0.5 text-red-600" size={16} />}<div><span className="font-bold">{item.label}:</span> {item.message}</div></div>)}</div></div>}

      <details className="mt-5 rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-bold text-slate-600">Advanced generated configuration</summary><pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-slate-600">{JSON.stringify(setup, null, 2)}</pre></details>
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button type="button" onClick={onClose} className="rounded-xl bg-slate-100 px-5 py-2.5 font-bold text-slate-700">Cancel</button>
        <button type="button" onClick={() => void loadIntegrations()} disabled={working} className="flex items-center gap-2 rounded-xl border border-slate-300 px-5 py-2.5 font-bold text-slate-700"><RefreshCw size={16} /> Refresh connections</button>
        <button type="button" onClick={() => void validate()} disabled={working} className="flex items-center gap-2 rounded-xl border border-indigo-300 px-5 py-2.5 font-bold text-indigo-700">{working ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />} Validate configuration</button>
        <button type="button" onClick={() => void finish()} disabled={working || !validation?.ready} className="rounded-xl bg-indigo-600 px-5 py-2.5 font-black text-white disabled:opacity-40">{initial || setup.serviceProjectId ? 'Save service project' : 'Create service project'}</button>
      </div>
    </div>
  </div>;
};
