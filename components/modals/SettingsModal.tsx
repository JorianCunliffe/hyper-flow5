import React, { useEffect, useRef, useState } from 'react';
import { Settings, X, Plus, Tags, Building, User, CheckCircle2, Type as LucideType, Download, Upload, AlertTriangle, Mail, Phone, Briefcase, RefreshCw, Cloud, CloudOff, Bot, Link2 } from 'lucide-react';
import { AppSettings, CommunicationsPersonRef, MailboxConnectionRef, Project, TeamMemberDetails, TenantAgentProfile, TenantSchedule, WorkspaceConnectionRef } from '../../types';
import { firebaseService } from '../../services/firebaseService';
import { COACHING_TRANSIENT_KEYS } from '../../lib/projectTemplates';
import type { ServiceSetupInput } from '../../lib/serviceSetup';
import { ServiceProjectWizard } from '../ServiceProjectWizard';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onUpdateSettings: (newSettings: AppSettings) => void;
  onExportBackup: () => void;
  onImportBackup: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBulkReplaceNameGlobal: (oldName: string, newName: string) => void;
  currentOrgId: string;
  isCloudConfigured: boolean;
  cloudStatus: 'disconnected' | 'connected' | 'syncing' | 'error';
  onOpenCloudSetup: () => void;
  projects: Project[];
  onConfigureService: (setup: ServiceSetupInput, projectId?: string) => Promise<void>;
  configureProjectId?: string;
}

const TeamMemberSection: React.FC<{ 
  items?: string[]; 
  details?: Record<string, TeamMemberDetails>;
  onAdd: (name: string, email?: string, phone?: string) => void; 
  onRemove: (name: string) => void;
  onUpdateDetails: (name: string, email?: string, phone?: string) => void;
}> = ({ items = [], details = {}, onAdd, onRemove, onUpdateDetails }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [editingMember, setEditingMember] = useState<string | null>(null);

  const handleAdd = () => {
    if (name.trim()) {
      onAdd(name.trim(), email.trim() || undefined, phone.trim() || undefined);
      setName('');
      setEmail('');
      setPhone('');
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-slate-800 font-bold mb-1 border-b border-slate-100 pb-2">
        <User size={18} />
        Team Members
      </div>
      
      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-2">
          <input 
            type="text" 
            className="bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name..."
          />
          <div className="grid grid-cols-2 gap-2">
            <div className="relative">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="email" 
                className="w-full bg-white border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email (optional)"
              />
            </div>
            <div className="relative">
              <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="tel" 
                className="w-full bg-white border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Phone (optional)"
              />
            </div>
          </div>
        </div>
        <button 
          onClick={handleAdd}
          className="bg-indigo-600 text-white py-2 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm font-bold text-xs flex items-center justify-center gap-2"
        >
          <Plus size={16} /> ADD TEAM MEMBER
        </button>
      </div>

      <div className="flex flex-col gap-2 mt-1 max-h-[300px] overflow-y-auto pr-1">
        {items.map(item => {
          const memberDetail = details[item] || {};
          const isEditing = editingMember === item;
          
          return (
            <div key={item} className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm group hover:border-indigo-200 transition-all">
              <div className="flex justify-between items-start mb-1">
                <span className="font-bold text-slate-800 text-sm">{item}</span>
                <div className="flex items-center gap-1">
                  <button 
                    onClick={() => setEditingMember(isEditing ? null : item)}
                    className="text-slate-400 hover:text-indigo-600 p-1 rounded-md hover:bg-indigo-50 transition-all"
                  >
                    <Settings size={14} />
                  </button>
                  <button 
                    onClick={() => onRemove(item)} 
                    className="text-slate-400 hover:text-red-500 p-1 rounded-md hover:bg-red-50 transition-all"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
              
              {isEditing ? (
                <div className="mt-2 flex flex-col gap-2 animate-in slide-in-from-top-1 duration-200">
                  <div className="grid grid-cols-1 gap-2">
                    <div className="relative">
                      <Mail size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input 
                        type="email" 
                        className="w-full bg-slate-50 border border-slate-200 rounded-md pl-7 pr-2 py-1 text-xs text-slate-900 outline-none focus:ring-1 focus:ring-indigo-500"
                        defaultValue={memberDetail.email || ''}
                        onBlur={(e) => onUpdateDetails(item, e.target.value || undefined, memberDetail.phone)}
                        placeholder="Email"
                      />
                    </div>
                    <div className="relative">
                      <Phone size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input 
                        type="tel" 
                        className="w-full bg-slate-50 border border-slate-200 rounded-md pl-7 pr-2 py-1 text-xs text-slate-900 outline-none focus:ring-1 focus:ring-indigo-500"
                        defaultValue={memberDetail.phone || ''}
                        onBlur={(e) => onUpdateDetails(item, memberDetail.email, e.target.value || undefined)}
                        placeholder="Phone"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-3 mt-1">
                  {memberDetail.email && (
                    <div className="flex items-center gap-1 text-[10px] text-slate-500">
                      <Mail size={10} className="text-indigo-400" />
                      {memberDetail.email}
                    </div>
                  )}
                  {memberDetail.phone && (
                    <div className="flex items-center gap-1 text-[10px] text-slate-500">
                      <Phone size={10} className="text-emerald-400" />
                      {memberDetail.phone}
                    </div>
                  )}
                  {!memberDetail.email && !memberDetail.phone && (
                    <span className="text-[10px] text-slate-400 italic">No contact info</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {items.length === 0 && <span className="text-xs text-slate-400 italic text-center py-4">No team members defined</span>}
      </div>
    </div>
  );
};

const SettingsSection: React.FC<{ 
  title: string; 
  icon: React.ReactNode; 
  items: string[]; 
  onAdd: (v: string) => void; 
  onRemove: (v: string) => void 
}> = ({ title, icon, items, onAdd, onRemove }) => {
  const [inputValue, setInputValue] = useState('');
  const safeItems = items || []; 
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-slate-800 font-bold mb-1 border-b border-slate-100 pb-2">
        {icon}
        {title}
      </div>
      <div className="flex gap-2">
        <input 
          type="text" 
          className="flex-1 bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder={`Add new ${title.toLowerCase()}...`}
          onKeyDown={(e) => { if(e.key === 'Enter') { onAdd(inputValue); setInputValue(''); }}}
        />
        <button 
          onClick={() => { onAdd(inputValue); setInputValue(''); }}
          className="bg-indigo-600 text-white p-2 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
        >
          <Plus size={20} />
        </button>
      </div>
      <div className="flex flex-wrap gap-2 mt-1">
        {safeItems.map(item => (
          <div key={item} className="bg-slate-100 text-slate-700 text-xs px-2 py-1 rounded-md flex items-center gap-2 group border border-slate-200">
            {item}
            <button onClick={() => onRemove(item)} className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
              <X size={12} />
            </button>
          </div>
        ))}
        {safeItems.length === 0 && <span className="text-xs text-slate-400 italic">No items defined</span>}
      </div>
    </div>
  );
};

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen, onClose, settings, onUpdateSettings, onExportBackup, onImportBackup, onBulkReplaceNameGlobal, currentOrgId, isCloudConfigured, cloudStatus, onOpenCloudSetup, projects, onConfigureService, configureProjectId
}) => {
  const [communicationsDraft, setCommunicationsDraft] = useState(settings.communications?.fromNumber || '');
  const [communicationsStatus, setCommunicationsStatus] = useState<{ loading: boolean; connected?: boolean; emailReady?: boolean; error?: string }>({ loading: false });
  const [integrationStatus, setIntegrationStatus] = useState<{
    loading: boolean;
    saving?: boolean;
    agent?: TenantAgentProfile | null;
    people: CommunicationsPersonRef[];
    mailboxes: MailboxConnectionRef[];
    workspaces: WorkspaceConnectionRef[];
    error?: string;
  }>({ loading: false, mailboxes: [], workspaces: [], people: [] });
  const [agentDraft, setAgentDraft] = useState<Partial<TenantAgentProfile>>({
    displayName: 'HyperFlow Agent', timezone: settings.communications?.timezone || 'Australia/Brisbane'
  });
  const [scheduleStatus, setScheduleStatus] = useState<{ loading: boolean; items: TenantSchedule[]; error?: string }>({ loading: false, items: [] });
  const [scheduleDraft, setScheduleDraft] = useState({
    name: 'Daily coaching', activity: 'flow_start' as TenantSchedule['activity'], projectId: '',
    localTime: '09:00', timezone: settings.communications?.timezone || 'Australia/Brisbane',
    misfirePolicy: 'run_once' as TenantSchedule['misfirePolicy'],
    digestChannel: 'web' as 'web' | 'email' | 'sms', digestRecipient: ''
  });
  const [workspaceGrantDraft, setWorkspaceGrantDraft] = useState({
    projectId: '', connectionId: '', documentId: '', spreadsheetId: '', sheetRange: 'Coaching!A:G'
  });
  const [googleResources, setGoogleResources] = useState<Array<{ id: string; name: string; kind: 'document' | 'spreadsheet' }>>([]);
  const [automationStatus, setAutomationStatus] = useState<{ working?: boolean; message?: string; error?: string }>({});
  const [serviceWizard, setServiceWizard] = useState<{ template: 'email_triage' | 'daily_coaching'; project?: Project } | null>(null);
  const handledConfigureProject = useRef<string>();
  const [serviceStatuses, setServiceStatuses] = useState<Record<string, any>>({});
  const communicationsNumberValid = !communicationsDraft || /^\+[1-9]\d{7,14}$/.test(communicationsDraft.trim());
  const [replaceOldName, setReplaceOldName] = useState('');
  const [replaceNewName, setReplaceNewName] = useState('');
  const [isReplacing, setIsReplacing] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const serviceProjects = projects.filter(project => ['email_triage', 'daily_email_triage', 'daily_coaching'].includes(String(project.projectData?.project_template)));

  const setupFromProject = (project: Project): Partial<ServiceSetupInput> => {
    const data = project.projectData || {};
    if (['email_triage', 'daily_email_triage'].includes(String(data.project_template))) return {
      template: 'email_triage', serviceProjectId: String(project.id), projectName: project.name, accessPersonIds: Array.isArray(data.service_allowed_person_ids) ? data.service_allowed_person_ids : [], provider: data.triage_provider || 'gmail',
      connectionId: data.triage_connection_id || '', localTime: '09:00', timezone: data.triage_timezone || settings.communications?.timezone || 'Australia/Brisbane',
      triagePolicy: data.triage_policy || 'human_only', createDrafts: data.triage_create_drafts !== false,
      digestChannel: data.triage_digest_channel || 'web', digestRecipient: data.triage_digest_recipient || '', authoritativeSync: true
    } as Partial<ServiceSetupInput>;
    return {
      template: 'daily_coaching', serviceProjectId: String(project.id), projectName: project.name, accessPersonIds: Array.isArray(data.service_allowed_person_ids) ? data.service_allowed_person_ids : [data.coaching_person_id].filter(Boolean), personId: data.coaching_person_id || '', phone: data.contact_phone || '',
      voiceIdentity: settings.communications?.fromNumber || '', workspaceConnectionId: data.coaching_workspace_connection_id || '',
      documentId: data.coaching_document_id || '', spreadsheetId: data.coaching_spreadsheet_id || '', sheetRange: data.coaching_sheet_range || 'Coaching!A:G',
      localTime: '09:00', timezone: data.coaching_timezone || settings.communications?.timezone || 'Australia/Brisbane',
      retryAttempts: Number(data.coaching_max_attempts ?? 2), retryDelayMinutes: Number(data.coaching_retry_delay_minutes ?? 30), retryWindowMinutes: Number(data.coaching_retry_window_minutes ?? 180),
      reviewRecipient: data.coaching_review_recipient || '', reviewChannels: Array.isArray(data.coaching_review_channels) ? data.coaching_review_channels : ['web']
    } as Partial<ServiceSetupInput>;
  };

  useEffect(() => {
    if (!isOpen) handledConfigureProject.current = undefined;
    if (!isOpen || serviceWizard) return;
    if (configureProjectId && handledConfigureProject.current !== configureProjectId) {
      const project = serviceProjects.find(item => String(item.id) === configureProjectId);
      if (project) {
        handledConfigureProject.current = configureProjectId;
        const template = project.projectData?.project_template === 'daily_coaching' ? 'daily_coaching' : 'email_triage';
        setServiceWizard({ template, project });
        return;
      }
    }
    const params = new URLSearchParams(window.location.search);
    if (params.has('service_setup') || params.has('setup_draft_id')) {
      setServiceWizard({ template: 'email_triage' });
    }
  }, [isOpen, serviceWizard, configureProjectId, serviceProjects]);

  const refreshServiceStatuses = async () => {
    const pairs = await Promise.all(serviceProjects.map(async project => {
      try {
        const response = await firebaseService.authorizedFetch(`/api/service-projects/status?projectId=${encodeURIComponent(String(project.id))}`);
        const body = await response.json().catch(() => ({}));
        return [String(project.id), response.ok ? body : { error: body.error || `Status failed (${response.status})` }] as const;
      } catch (error: any) { return [String(project.id), { error: error?.message || String(error) }] as const; }
    }));
    setServiceStatuses(Object.fromEntries(pairs));
  };

  useEffect(() => {
    setCommunicationsDraft(settings.communications?.fromNumber || '');
  }, [settings.communications?.fromNumber]);

  useEffect(() => {
    if (!isOpen || !currentOrgId || !firebaseService.isConfigured()) return;
    let active = true;
    setCommunicationsStatus({ loading: true });
    void firebaseService.authorizedFetch('/api/communications/status')
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || `Status check failed (${response.status})`);
        if (active) setCommunicationsStatus({ loading: false, connected: body.connected, emailReady: body.emailReady, error: body.error });
      })
      .catch((error: any) => {
        if (active) setCommunicationsStatus({ loading: false, connected: false, error: error?.message || String(error) });
      });
    setIntegrationStatus(current => ({ ...current, loading: true, error: undefined }));
    void firebaseService.authorizedFetch('/api/integrations')
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || `Integration check failed (${response.status})`);
        if (!active) return;
        const fallback = { displayName: 'HyperFlow Agent', timezone: settings.communications?.timezone || 'Australia/Brisbane' };
        setAgentDraft(body.agent || fallback);
        setIntegrationStatus({
          loading: false,
          agent: body.agent || null,
          mailboxes: Array.isArray(body.mailboxes) ? body.mailboxes : [],
          workspaces: Array.isArray(body.workspaces) ? body.workspaces : [],
          people: Array.isArray(body.people) ? body.people : []
        });
      })
      .catch((error: any) => {
        if (active) setIntegrationStatus({ loading: false, mailboxes: [], workspaces: [], people: [], error: error?.message || String(error) });
      });
    return () => { active = false; };
  }, [currentOrgId, isOpen, settings.communications?.timezone]);

  useEffect(() => {
    if (!isOpen || !currentOrgId || !firebaseService.isConfigured()) return;
    let active = true;
    setScheduleStatus(current => ({ ...current, loading: true, error: undefined }));
    void firebaseService.authorizedFetch('/api/schedules')
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || `Schedule load failed (${response.status})`);
        if (active) setScheduleStatus({ loading: false, items: Array.isArray(body.data) ? body.data : [] });
      })
      .catch((error: any) => {
        if (active) setScheduleStatus({ loading: false, items: [], error: error?.message || String(error) });
      });
    return () => { active = false; };
  }, [currentOrgId, isOpen]);

  useEffect(() => {
    if (!isOpen || !currentOrgId || !firebaseService.isConfigured()) return;
    void refreshServiceStatuses();
  }, [currentOrgId, isOpen, projects.length]);

  if (!isOpen) return null;

  const updateList = (key: keyof AppSettings, value: string, action: 'add' | 'remove') => {
    const list = (settings[key] as string[]) || [];
    let newList = [...list];
    if (action === 'add' && value.trim() && !newList.includes(value)) newList.push(value);
    else if (action === 'remove') {
      const index = newList.indexOf(value);
      if (index > -1) newList.splice(index, 1);
    }
    onUpdateSettings({ ...settings, [key]: newList });
  };

  const updateCommunications = (patch: NonNullable<AppSettings['communications']>) => {
    onUpdateSettings({ ...settings, communications: { ...settings.communications, ...patch } });
  };

  const saveAgentProfile = async () => {
    setIntegrationStatus(current => ({ ...current, saving: true, error: undefined }));
    try {
      const response = await firebaseService.authorizedFetch('/api/integrations', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent: agentDraft })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Agent save failed (${response.status})`);
      setAgentDraft(body.agent);
      setIntegrationStatus(current => ({ ...current, saving: false, agent: body.agent }));
    } catch (error: any) {
      setIntegrationStatus(current => ({ ...current, saving: false, error: error?.message || String(error) }));
    }
  };

  const connectGoogleWorkspace = async () => {
    setIntegrationStatus(current => ({ ...current, saving: true, error: undefined }));
    try {
      const response = await firebaseService.authorizedFetch('/api/integrations/google/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnTo: '/' })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.authorizationUrl) throw new Error(body.error || 'Google connection could not be started');
      window.location.assign(body.authorizationUrl);
    } catch (error: any) {
      setIntegrationStatus(current => ({ ...current, saving: false, error: error?.message || String(error) }));
    }
  };

  const connectGmailMailbox = async () => {
    setIntegrationStatus(current => ({ ...current, saving: true, error: undefined }));
    try {
      const response = await firebaseService.authorizedFetch('/api/integrations/mailbox/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnTo: '/' })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.authorizationUrl) throw new Error(body.error || 'Gmail connection could not be started');
      window.location.assign(body.authorizationUrl);
    } catch (error: any) {
      setIntegrationStatus(current => ({ ...current, saving: false, error: error?.message || String(error) }));
    }
  };

  const syncSelectedMailbox = async () => {
    const connectionId = settings.communications?.mailboxConnectionId;
    if (!connectionId) return;
    setIntegrationStatus(current => ({ ...current, saving: true, error: undefined }));
    try {
      const response = await firebaseService.authorizedFetch(`/api/integrations/mailbox/sync?connectionId=${encodeURIComponent(connectionId)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Mailbox sync failed (${response.status})`);
      const refreshed = await firebaseService.authorizedFetch('/api/integrations');
      const integrations = await refreshed.json().catch(() => ({}));
      if (!refreshed.ok) throw new Error(integrations.error || `Mailbox refresh failed (${refreshed.status})`);
      setIntegrationStatus(current => ({
        ...current,
        saving: false,
        mailboxes: Array.isArray(integrations.mailboxes) ? integrations.mailboxes : current.mailboxes,
        workspaces: Array.isArray(integrations.workspaces) ? integrations.workspaces : current.workspaces,
        agent: integrations.agent || current.agent,
        people: Array.isArray(integrations.people) ? integrations.people : current.people
      }));
    } catch (error: any) {
      setIntegrationStatus(current => ({ ...current, saving: false, error: error?.message || String(error) }));
    }
  };

  const createDailySchedule = async () => {
    setAutomationStatus({ working: true });
    try {
      const payload = {
        name: scheduleDraft.name,
        activity: scheduleDraft.activity,
        recurrence: { kind: 'daily', localTime: scheduleDraft.localTime },
        timezone: scheduleDraft.timezone,
        misfirePolicy: scheduleDraft.misfirePolicy,
        ...(scheduleDraft.activity === 'flow_start'
          ? {
              projectId: scheduleDraft.projectId,
              resetPolicy: 'flow',
              clearProjectDataKeys: COACHING_TRANSIENT_KEYS
            }
          : {
              connectionId: settings.communications?.mailboxConnectionId || settings.communications?.connectionId,
              policy: settings.communications?.sendPolicy || 'draft_only',
              digestChannel: scheduleDraft.digestChannel,
              ...(scheduleDraft.digestChannel !== 'web' ? { digestRecipient: scheduleDraft.digestRecipient.trim() } : {})
            })
      };
      const response = await firebaseService.authorizedFetch('/api/schedules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Schedule creation failed (${response.status})`);
      setScheduleStatus(current => ({ ...current, items: [...current.items, body.schedule] }));
      setAutomationStatus({ message: 'Daily schedule created.' });
    } catch (error: any) {
      setAutomationStatus({ error: error?.message || String(error) });
    }
  };

  const runScheduleNow = async (id: string) => {
    setAutomationStatus({ working: true });
    try {
      const response = await firebaseService.authorizedFetch('/api/schedules/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Schedule run failed (${response.status})`);
      setAutomationStatus({ message: `Run ${body.result?.status || 'submitted'}.` });
    } catch (error: any) {
      setAutomationStatus({ error: error?.message || String(error) });
    }
  };

  const deleteSchedule = async (id: string) => {
    setAutomationStatus({ working: true });
    try {
      const response = await firebaseService.authorizedFetch(`/api/schedules?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Schedule deletion failed (${response.status})`);
      }
      setScheduleStatus(current => ({ ...current, items: current.items.filter(item => item.id !== id) }));
      setAutomationStatus({ message: 'Schedule deleted.' });
    } catch (error: any) {
      setAutomationStatus({ error: error?.message || String(error) });
    }
  };

  const loadGoogleResources = async () => {
    if (!workspaceGrantDraft.connectionId) return setAutomationStatus({ error: 'Select a Google Workspace connection first.' });
    setAutomationStatus({ working: true });
    try {
      const response = await firebaseService.authorizedFetch(`/api/integrations/google/resources?connectionId=${encodeURIComponent(workspaceGrantDraft.connectionId)}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Google resource load failed (${response.status})`);
      setGoogleResources(Array.isArray(body.data) ? body.data : []);
      setAutomationStatus({ message: 'Google Docs and Sheets loaded.' });
    } catch (error: any) {
      setAutomationStatus({ error: error?.message || String(error) });
    }
  };

  const saveWorkspaceGrant = async () => {
    if (!workspaceGrantDraft.projectId) return setAutomationStatus({ error: 'Select a project first.' });
    setAutomationStatus({ working: true });
    try {
      const response = await firebaseService.authorizedFetch('/api/integrations/google/grant', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(workspaceGrantDraft)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Workspace grant save failed (${response.status})`);
      setAutomationStatus({ message: 'Project Google resources saved.' });
    } catch (error: any) {
      setAutomationStatus({ error: error?.message || String(error) });
    }
  };

  const toggleServiceSchedule = async (schedule: TenantSchedule) => {
    setAutomationStatus({ working: true });
    try {
      const response = await firebaseService.authorizedFetch('/api/schedules', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: schedule.id, enabled: !schedule.enabled })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Schedule could not be updated');
      setScheduleStatus(current => ({ ...current, items: current.items.map(item => item.id === schedule.id ? body.schedule : item) }));
      await refreshServiceStatuses();
      setAutomationStatus({ message: body.schedule.enabled ? 'Service resumed.' : 'Service paused.' });
    } catch (error: any) { setAutomationStatus({ error: error?.message || String(error) }); }
    finally { setAutomationStatus(current => ({ ...current, working: false })); }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[100] flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col border border-white/20">
        <div className="p-8 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-50 rounded-xl"><Settings className="text-indigo-600" /></div>
            <div>
              <h3 className="text-2xl font-black text-slate-900">Global Configuration</h3>
              <p className="text-sm text-slate-500">Customize labels and manage project data.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors"><X size={24} /></button>
        </div>
        
        <div className="flex-1 overflow-auto p-10">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mb-16">
            <div className="flex flex-col gap-6">
              <SettingsSection title="Project Types" icon={<Tags size={18} />} items={settings.projectTypes} onAdd={(v) => updateList('projectTypes', v, 'add')} onRemove={(v) => updateList('projectTypes', v, 'remove')} />
              <SettingsSection title="Companies" icon={<Building size={18} />} items={settings.companies} onAdd={(v) => updateList('companies', v, 'add')} onRemove={(v) => updateList('companies', v, 'remove')} />
              <SettingsSection title="Roles" icon={<Briefcase size={18} />} items={settings.roles || []} onAdd={(v) => updateList('roles', v, 'add')} onRemove={(v) => updateList('roles', v, 'remove')} />
            </div>
            <div className="flex flex-col gap-6">
              <TeamMemberSection 
                items={settings.people || []} 
                details={settings.teamMemberDetails || {}}
                onAdd={(name, email, phone) => {
                  const newPeople = [...(settings.people || []), name];
                  const newDetails = { ...(settings.teamMemberDetails || {}), [name]: { email, phone } };
                  onUpdateSettings({ ...settings, people: newPeople, teamMemberDetails: newDetails });
                }}
                onRemove={(name) => {
                  const newPeople = (settings.people || []).filter(p => p !== name);
                  const newDetails = { ...(settings.teamMemberDetails || {}) };
                  delete newDetails[name];
                  onUpdateSettings({ ...settings, people: newPeople, teamMemberDetails: newDetails });
                }}
                onUpdateDetails={(name, email, phone) => {
                  const newDetails = { ...(settings.teamMemberDetails || {}), [name]: { email, phone } };
                  onUpdateSettings({ ...settings, teamMemberDetails: newDetails });
                }}
              />
              <SettingsSection title="Task Statuses" icon={<CheckCircle2 size={18} />} items={settings.statuses} onAdd={(v) => updateList('statuses', v, 'add')} onRemove={(v) => updateList('statuses', v, 'remove')} />
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-slate-800 font-bold mb-1 border-b border-slate-100 pb-2">
                  <LucideType size={18} />
                  Date Format
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => onUpdateSettings({ ...settings, dateFormat: 'DD/MM/YY' })}
                    className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all border ${settings.dateFormat === 'DD/MM/YY' ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg' : 'bg-slate-50 text-slate-500 border-slate-200'}`}
                  >
                    DD/MM/YY
                  </button>
                  <button 
                    onClick={() => onUpdateSettings({ ...settings, dateFormat: 'MM/DD/YY' })}
                    className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all border ${settings.dateFormat === 'MM/DD/YY' ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg' : 'bg-slate-50 text-slate-500 border-slate-200'}`}
                  >
                    MM/DD/YY
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-10 mb-16">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <h4 className="text-slate-800 font-black text-lg flex items-center gap-3"><Briefcase size={24} className="text-violet-600" /> Service Projects</h4>
              <div className="flex gap-2"><button type="button" onClick={() => setServiceWizard({ template: 'email_triage' })} className="rounded-xl border border-violet-200 px-4 py-2 text-sm font-bold text-violet-700">New email triage</button><button type="button" onClick={() => setServiceWizard({ template: 'daily_coaching' })} className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-bold text-white">New daily coaching</button></div>
            </div>
            <div className="space-y-3">
              {!serviceProjects.length && <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">No service projects yet. Use the guided setup above; raw JSON is not required.</div>}
              {serviceProjects.map(project => {
                const status = serviceStatuses[String(project.id)] || {};
                const schedule = status.schedules?.[0] as TenantSchedule | undefined;
                const mailboxId = project.projectData?.triage_connection_id;
                const mailbox = status.mailboxes?.find((item: any) => item.id === mailboxId);
                const workspaceId = project.projectData?.coaching_workspace_connection_id;
                const workspace = status.workspaces?.find((item: any) => item.id === workspaceId);
                return <div key={project.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3"><div><h5 className="font-black text-slate-900">{project.name}</h5><p className="text-xs text-slate-500">{project.projectData?.project_template === 'daily_coaching' ? 'Daily Coaching' : 'Email Triage'} · {mailbox?.mailboxAddress || workspace?.accountEmail || 'connection pending'}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${schedule?.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{schedule?.enabled ? 'Active' : 'Paused'}</span></div>
                  {status.error ? <p className="mt-3 text-sm text-red-600">{status.error}</p> : <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-600 md:grid-cols-3"><div><b>Previous run:</b> {status.lastRun ? `${status.lastRun.status} · ${status.lastRun.processedCount ?? 0} processed` : 'none'}</div><div><b>Next run:</b> {schedule ? new Date(schedule.nextRunAt).toLocaleString() : 'not scheduled'}</div><div><b>Scheduler:</b> {status.scheduler?.lastTickAt ? new Date(status.scheduler.lastTickAt).toLocaleString() : 'no tick recorded'}{status.scheduler?.overdue ? ' · OVERDUE' : ''}</div></div>}
                  {status.lastDigest?.summary && <p className="mt-3 line-clamp-2 rounded-lg bg-white p-2 text-xs text-slate-600"><b>Last digest:</b> {status.lastDigest.summary}</p>}
                  {status.scheduler?.warning && <p className="mt-3 text-xs font-bold text-amber-700">{status.scheduler.warning}</p>}
                  <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => setServiceWizard({ template: project.projectData?.project_template === 'daily_coaching' ? 'daily_coaching' : 'email_triage', project })} className="rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-bold text-indigo-700">Edit / reconnect / validate</button>{schedule && <><button type="button" onClick={() => void runScheduleNow(schedule.id)} className="rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-bold text-emerald-700">Run now</button><button type="button" onClick={() => void toggleServiceSchedule(schedule)} className="rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-bold text-amber-700">{schedule.enabled ? 'Pause' : 'Resume'}</button></>}</div>
                </div>;
              })}
            </div>
          </div>

          <div className="border-t border-slate-100 pt-10 mb-16">
            <h4 className="text-slate-800 font-black text-lg mb-6 flex items-center gap-3"><RefreshCw size={24} className="text-indigo-600" /> Daily Automations</h4>
            <div className="bg-slate-50 rounded-3xl p-8 border border-slate-200 space-y-8">
              {(automationStatus.message || automationStatus.error) && <div className={`rounded-xl border p-3 text-sm font-semibold ${automationStatus.error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{automationStatus.error || automationStatus.message}</div>}

              <div>
                <h5 className="font-black text-slate-800 mb-3">Create daily schedule</h5>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <input aria-label="Schedule name" value={scheduleDraft.name} onChange={event => setScheduleDraft(current => ({ ...current, name: event.target.value }))} className="bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm" />
                  <select aria-label="Schedule activity" value={scheduleDraft.activity} onChange={event => setScheduleDraft(current => ({ ...current, activity: event.target.value as TenantSchedule['activity'], name: event.target.value === 'flow_start' ? 'Daily coaching' : 'Daily email triage' }))} className="bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm">
                    <option value="flow_start">Start project flow</option>
                    <option value="communications_triage">Email triage reconciliation</option>
                  </select>
                  {scheduleDraft.activity === 'flow_start' ? <select aria-label="Scheduled project" value={scheduleDraft.projectId} onChange={event => setScheduleDraft(current => ({ ...current, projectId: event.target.value }))} className="bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm"><option value="">Select project</option>{projects.filter(project => !project.isArchived).map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select> : <div className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-600">Mailbox: {integrationStatus.mailboxes.find(item => item.id === settings.communications?.mailboxConnectionId)?.mailboxAddress || 'not connected'}</div>}
                  <input aria-label="Daily local time" type="time" value={scheduleDraft.localTime} onChange={event => setScheduleDraft(current => ({ ...current, localTime: event.target.value }))} className="bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm" />
                  <input aria-label="Schedule timezone" value={scheduleDraft.timezone} onChange={event => setScheduleDraft(current => ({ ...current, timezone: event.target.value }))} className="bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm" />
                  <select aria-label="Misfire policy" value={scheduleDraft.misfirePolicy} onChange={event => setScheduleDraft(current => ({ ...current, misfirePolicy: event.target.value as TenantSchedule['misfirePolicy'] }))} className="bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm"><option value="run_once">Run once after downtime</option><option value="catch_up">Catch up every occurrence</option><option value="skip">Skip missed occurrences</option></select>
                  {scheduleDraft.activity === 'communications_triage' && <select aria-label="Digest channel" value={scheduleDraft.digestChannel} onChange={event => setScheduleDraft(current => ({ ...current, digestChannel: event.target.value as 'web' | 'email' | 'sms' }))} className="bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm"><option value="web">Show in HyperFlow</option><option value="email">Email digest</option><option value="sms">SMS digest</option></select>}
                  {scheduleDraft.activity === 'communications_triage' && scheduleDraft.digestChannel !== 'web' && <input aria-label="Digest recipient" type={scheduleDraft.digestChannel === 'email' ? 'email' : 'tel'} value={scheduleDraft.digestRecipient} onChange={event => setScheduleDraft(current => ({ ...current, digestRecipient: event.target.value }))} placeholder={scheduleDraft.digestChannel === 'email' ? 'you@example.com' : '+61411111111'} className="bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm" />}
                </div>
                {scheduleDraft.activity === 'communications_triage' && scheduleDraft.digestChannel !== 'web' && <p className="mt-3 text-xs text-slate-500">Connected Gmail creates a draft for review. Automatic SMS or transactional email delivery also requires Automatic send policy and the send_reply permission.</p>}
                <button type="button" onClick={() => void createDailySchedule()} disabled={automationStatus.working || !scheduleDraft.name.trim() || (scheduleDraft.activity === 'flow_start' && !scheduleDraft.projectId) || (scheduleDraft.activity === 'communications_triage' && scheduleDraft.digestChannel !== 'web' && !scheduleDraft.digestRecipient.trim())} className="mt-4 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">Create schedule</button>
              </div>

              <div>
                <h5 className="font-black text-slate-800 mb-3">Active schedules</h5>
                {scheduleStatus.loading ? <p className="text-sm text-slate-500">Loading schedules…</p> : scheduleStatus.error ? <p className="text-sm text-red-600">{scheduleStatus.error}</p> : scheduleStatus.items.length === 0 ? <p className="text-sm text-slate-500">No schedules configured.</p> : <div className="space-y-2">{scheduleStatus.items.map(schedule => <div key={schedule.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 md:flex-row md:items-center md:justify-between"><div><div className="font-bold text-slate-800">{schedule.name}</div><div className="text-xs text-slate-500">{schedule.activity.replaceAll('_', ' ')} · {schedule.recurrence?.kind === 'daily' ? `${schedule.recurrence.localTime} ${schedule.timezone}` : `every ${schedule.intervalMinutes} minutes`} · next {new Date(schedule.nextRunAt).toLocaleString()}{schedule.activity === 'communications_triage' ? ` · digest ${schedule.digestChannel || 'web'}` : ''}</div></div><div className="flex gap-2"><button type="button" onClick={() => void runScheduleNow(schedule.id)} disabled={automationStatus.working} className="rounded-lg border border-indigo-200 px-3 py-1.5 text-xs font-bold text-indigo-700">Run now</button><button type="button" onClick={() => void deleteSchedule(schedule.id)} disabled={automationStatus.working} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-700">Delete</button></div></div>)}</div>}
              </div>

              <div className="border-t border-slate-200 pt-6">
                <h5 className="font-black text-slate-800 mb-1">Project Google resources</h5>
                <p className="mb-4 text-xs text-slate-500">Allowlist one coaching Doc and one Sheet range for a project. Flow nodes cannot supply arbitrary file IDs.</p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <select aria-label="Workspace project" value={workspaceGrantDraft.projectId} onChange={event => setWorkspaceGrantDraft(current => ({ ...current, projectId: event.target.value }))} className="bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm"><option value="">Select project</option>{projects.filter(project => !project.isArchived).map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
                  <select aria-label="Workspace connection" value={workspaceGrantDraft.connectionId} onChange={event => setWorkspaceGrantDraft(current => ({ ...current, connectionId: event.target.value }))} className="bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm"><option value="">Select Google connection</option>{integrationStatus.workspaces.filter(item => item.state === 'connected').map(item => <option key={item.id} value={item.id}>{item.accountEmail}</option>)}</select>
                  <select aria-label="Coaching Google Doc" value={workspaceGrantDraft.documentId} onChange={event => setWorkspaceGrantDraft(current => ({ ...current, documentId: event.target.value }))} className="bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm"><option value="">Select coaching Doc</option>{googleResources.filter(item => item.kind === 'document').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                  <select aria-label="Coaching Google Sheet" value={workspaceGrantDraft.spreadsheetId} onChange={event => setWorkspaceGrantDraft(current => ({ ...current, spreadsheetId: event.target.value }))} className="bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm"><option value="">Select coaching Sheet</option>{googleResources.filter(item => item.kind === 'spreadsheet').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                  <input aria-label="Allowlisted Sheet range" value={workspaceGrantDraft.sheetRange} onChange={event => setWorkspaceGrantDraft(current => ({ ...current, sheetRange: event.target.value }))} placeholder="Coaching!A:G" className="bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm" />
                  <div className="flex gap-2"><button type="button" onClick={() => void loadGoogleResources()} disabled={automationStatus.working || !workspaceGrantDraft.connectionId} className="flex-1 rounded-xl border border-indigo-200 bg-white px-4 py-2.5 text-sm font-bold text-indigo-700 disabled:opacity-50">Load files</button><button type="button" onClick={() => void saveWorkspaceGrant()} disabled={automationStatus.working || !workspaceGrantDraft.projectId || !workspaceGrantDraft.connectionId} className="flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">Save allowlist</button></div>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-10 mb-16">
            <h4 className="text-slate-800 font-black text-lg mb-6 flex items-center gap-3"><Bot size={24} className="text-indigo-600" /> Agent &amp; Connections</h4>
            <div className="bg-slate-50 rounded-3xl p-8 border border-slate-200 space-y-6">
              <div className={`rounded-xl border p-4 text-sm font-semibold ${integrationStatus.error ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-700'}`} role="status">
                {integrationStatus.loading
                  ? 'Loading tenant agent and connection health…'
                  : integrationStatus.error
                    ? integrationStatus.error
                    : `${integrationStatus.mailboxes.length} mailbox and ${integrationStatus.workspaces.length} Workspace connection${integrationStatus.workspaces.length === 1 ? '' : 's'} available`}
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2" htmlFor="agent-display-name">Agent display name</label>
                  <input id="agent-display-name" value={agentDraft.displayName || ''} onChange={event => setAgentDraft(current => ({ ...current, displayName: event.target.value }))} className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2" htmlFor="agent-timezone">Agent timezone</label>
                  <input id="agent-timezone" value={agentDraft.timezone || 'Australia/Brisbane'} onChange={event => setAgentDraft(current => ({ ...current, timezone: event.target.value }))} className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2" htmlFor="agent-primary-person">Primary Communications person</label>
                  <select id="agent-primary-person" value={agentDraft.primaryPersonId || ''} onChange={event => setAgentDraft(current => ({ ...current, primaryPersonId: event.target.value || undefined }))} className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm">
                    <option value="">Not selected</option>
                    {integrationStatus.people.map(person => <option key={person.id} value={person.id}>{person.name || person.email || person.phone || person.id}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2" htmlFor="agent-clarification">Ambiguous project routing</label>
                  <select id="agent-clarification" value={agentDraft.clarificationPolicy || 'when_ambiguous'} onChange={event => setAgentDraft(current => ({ ...current, clarificationPolicy: event.target.value as TenantAgentProfile['clarificationPolicy'] }))} className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm">
                    <option value="when_ambiguous">Ask only when ambiguous</option>
                    <option value="always">Always confirm the project</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2" htmlFor="agent-phone">Agent voice/SMS identity</label>
                  <input id="agent-phone" type="tel" value={agentDraft.serviceIdentities?.phone || ''} onChange={event => setAgentDraft(current => ({ ...current, serviceIdentities: { ...current.serviceIdentities, phone: event.target.value || undefined, sms: event.target.value || undefined } }))} placeholder="+61411111111" className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-900 font-mono outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2" htmlFor="agent-email">Agent email identity</label>
                  <input id="agent-email" type="email" value={agentDraft.serviceIdentities?.email || ''} onChange={event => setAgentDraft(current => ({ ...current, serviceIdentities: { ...current.serviceIdentities, email: event.target.value || undefined } }))} placeholder="agent@example.com" className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2" htmlFor="mailbox-connection"><Link2 size={14} className="inline mr-1" />Connected mailbox</label>
                  <select id="mailbox-connection" value={settings.communications?.mailboxConnectionId || ''} onChange={event => updateCommunications({ mailboxConnectionId: event.target.value || undefined })} className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm">
                    <option value="">No connected mailbox</option>
                    {integrationStatus.mailboxes.map(connection => <option key={connection.id} value={connection.id}>{connection.provider}: {connection.mailboxAddress} ({connection.state})</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2" htmlFor="workspace-connection"><Link2 size={14} className="inline mr-1" />Google Workspace</label>
                  <select id="workspace-connection" value={settings.activeWorkspaceConnectionId || ''} onChange={event => onUpdateSettings({ ...settings, activeWorkspaceConnectionId: event.target.value || undefined })} className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm">
                    <option value="">No Workspace connection</option>
                    {integrationStatus.workspaces.map(connection => <option key={connection.id} value={connection.id}>{connection.accountEmail} ({connection.state})</option>)}
                  </select>
                </div>
              </div>

              <fieldset>
                <legend className="text-sm font-bold text-slate-700 mb-2">Person-specific project access</legend>
                <p className="mb-3 text-xs text-slate-500">Grant projects to stable Communications people. Once any grants exist, people without a row cannot use the agent.</p>
                <div className="space-y-3">
                  {integrationStatus.people.map(person => {
                    const grants = agentDraft.personProjectAccess || [];
                    const entry = grants.find(item => item.personId === person.id);
                    return <div key={person.id} className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="mb-2 text-sm font-bold text-slate-800">{person.name || person.email || person.phone || person.id}</div>
                      <div className="flex flex-wrap gap-2">{projects.filter(project => !project.isArchived).map(project => {
                        const selected = Boolean(entry?.projectIds.includes(String(project.id)));
                        return <label key={project.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={selected} onChange={() => setAgentDraft(current => {
                          const currentGrants = current.personProjectAccess || [];
                          const currentEntry = currentGrants.find(item => item.personId === person.id);
                          const projectIds = currentEntry?.projectIds || [];
                          const nextProjectIds = selected ? projectIds.filter(id => id !== String(project.id)) : [...projectIds, String(project.id)];
                          const withoutPerson = currentGrants.filter(item => item.personId !== person.id);
                          return { ...current, personProjectAccess: nextProjectIds.length ? [...withoutPerson, { personId: person.id, projectIds: nextProjectIds }] : withoutPerson };
                        })} />{project.name}</label>;
                      })}</div>
                    </div>;
                  })}
                  {!integrationStatus.people.length && <p className="text-xs text-amber-700">No Communications people are available. Receive or create the contact in Communications Service, then reload Settings.</p>}
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-sm font-bold text-slate-700 mb-2">Agent automatic-action policy</legend>
                <div className="flex flex-wrap gap-3">
                  {(['draft', 'send', 'call', 'sheet_write'] as const).map(action => {
                    const selected = (agentDraft.automaticActions || []).includes(action);
                    return <label key={action} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={selected} onChange={() => setAgentDraft(current => ({ ...current, automaticActions: selected ? (current.automaticActions || []).filter(item => item !== action) : [...(current.automaticActions || []), action] }))} />{action.replaceAll('_', ' ')}</label>;
                  })}
                </div>
                <p className="text-xs text-slate-500 mt-2">Draft is safe by default. Send, call, and Sheet writes remain disabled until explicitly selected and are still subject to workflow policy.</p>
              </fieldset>

              <div className="flex justify-end">
                <div className="flex flex-wrap justify-end gap-3">
                <button type="button" onClick={() => void connectGmailMailbox()} disabled={integrationStatus.loading || integrationStatus.saving} className="rounded-xl border border-indigo-200 bg-white px-5 py-2.5 text-sm font-bold text-indigo-700 shadow-sm transition-colors hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50">
                  {integrationStatus.mailboxes.some(item => item.provider === 'gmail') ? 'Reconnect Gmail' : 'Connect Gmail mailbox'}
                </button>
                <button type="button" onClick={() => void syncSelectedMailbox()} disabled={integrationStatus.loading || integrationStatus.saving || !settings.communications?.mailboxConnectionId} className="rounded-xl border border-indigo-200 bg-white px-5 py-2.5 text-sm font-bold text-indigo-700 shadow-sm transition-colors hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50">
                  Sync mailbox now
                </button>
                <button type="button" onClick={() => void connectGoogleWorkspace()} disabled={integrationStatus.loading || integrationStatus.saving} className="rounded-xl border border-indigo-200 bg-white px-5 py-2.5 text-sm font-bold text-indigo-700 shadow-sm transition-colors hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50">
                  {integrationStatus.workspaces.length ? 'Reconnect Google Workspace' : 'Connect Google Workspace'}
                </button>
                <button type="button" onClick={() => void saveAgentProfile()} disabled={integrationStatus.loading || integrationStatus.saving} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
                  {integrationStatus.saving ? 'Saving agent…' : 'Save agent profile'}
                </button>
                </div>
              </div>
              <p className="text-xs text-slate-500">Only opaque connection references are shown here. OAuth tokens and provider credentials remain in protected backend stores.</p>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-10 mb-16">
            <h4 className="text-slate-800 font-black text-lg mb-6 flex items-center gap-3"><Mail size={24} className="text-indigo-600" /> Communications</h4>
            <div className="bg-slate-50 rounded-3xl p-8 border border-slate-200 space-y-6">
              <div className={`rounded-xl border p-4 text-sm font-semibold ${communicationsStatus.connected ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`} role="status">
                {communicationsStatus.loading
                  ? 'Checking Communications Service…'
                  : communicationsStatus.connected
                    ? communicationsStatus.emailReady ? 'Communications Service connected; email identity selected' : 'Communications Service connected; select an outbound email identity below'
                    : `Communications Service not connected${communicationsStatus.error ? `: ${communicationsStatus.error}` : ''}`}
              </div>
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2" htmlFor="communications-from-number">Sending phone number</label>
                  <input id="communications-from-number" type="tel" pattern="\+[1-9][0-9]{7,14}" aria-describedby="communications-from-number-help" value={communicationsDraft} onChange={(e) => setCommunicationsDraft(e.target.value)} onBlur={() => { if (communicationsNumberValid) updateCommunications({ fromNumber: communicationsDraft.trim() || undefined }); }} placeholder="+61411111111" className={`w-full bg-white border rounded-xl px-4 py-2.5 text-sm text-slate-900 font-mono outline-none focus:ring-2 shadow-sm ${communicationsNumberValid ? 'border-slate-300 focus:ring-indigo-500' : 'border-red-400 focus:ring-red-500'}`} />
                  <p id="communications-from-number-help" className="text-xs text-slate-500 mt-2">E.164 sender for SMS and voice.</p>
                  {!communicationsNumberValid && <p className="text-xs text-red-600 mt-2">Enter an E.164 number such as +61411111111.</p>}
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2" htmlFor="communications-connection-id">Provider connection ID</label>
                  <input id="communications-connection-id" type="text" defaultValue={settings.communications?.connectionId || ''} onBlur={e => updateCommunications({ connectionId: e.target.value.trim() || undefined })} placeholder="Provider connection UUID" className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-900 font-mono outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2" htmlFor="communications-email-identity">Outbound email service identity</label>
                  <input id="communications-email-identity" type="text" defaultValue={settings.communications?.defaultEmailIdentity || ''} onBlur={e => updateCommunications({ defaultEmailIdentity: e.target.value.trim() || undefined })} placeholder="Service identity UUID" className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-900 font-mono outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2" htmlFor="communications-reply-identity">Reply-to address override</label>
                  <input id="communications-reply-identity" type="text" defaultValue={settings.communications?.replyServiceIdentity || ''} onBlur={e => updateCommunications({ replyServiceIdentity: e.target.value.trim() || undefined })} placeholder="inbox@example.com" className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2" htmlFor="communications-timezone">Timezone</label>
                  <input id="communications-timezone" type="text" value={settings.communications?.timezone || 'Australia/Brisbane'} onChange={e => updateCommunications({ timezone: e.target.value })} className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2" htmlFor="communications-triage-policy">Inbound triage policy</label>
                  <select id="communications-triage-policy" value={settings.communications?.triagePolicy || 'human_only'} onChange={e => updateCommunications({ triagePolicy: e.target.value as NonNullable<AppSettings['communications']>['triagePolicy'] })} className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm">
                    <option value="human_only">Human messages only</option><option value="all_inbound">All inbound</option><option value="correlated_only">Correlated replies only</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2" htmlFor="communications-send-policy">Outbound send policy</label>
                  <select id="communications-send-policy" value={settings.communications?.sendPolicy || 'draft_only'} onChange={e => updateCommunications({ sendPolicy: e.target.value as NonNullable<AppSettings['communications']>['sendPolicy'] })} className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm">
                    <option value="draft_only">Draft only</option><option value="allow_approved_send">Allow approved sends</option><option value="automatic">Automatic sends</option>
                  </select>
                </div>
              </div>
              <fieldset>
                <legend className="text-sm font-bold text-slate-700 mb-2">Allowed automatic actions</legend>
                <div className="flex flex-wrap gap-3">
                  {(['classify', 'link_workflow', 'progress_ask', 'create_draft', 'send_reply'] as const).map(action => {
                    const selected = (settings.communications?.allowedAutomaticActions || ['classify', 'create_draft']).includes(action);
                    return <label key={action} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={selected} onChange={() => updateCommunications({ allowedAutomaticActions: selected ? (settings.communications?.allowedAutomaticActions || ['classify', 'create_draft']).filter(item => item !== action) : [...(settings.communications?.allowedAutomaticActions || ['classify', 'create_draft']), action] })} />{action.replaceAll('_', ' ')}</label>;
                  })}
                </div>
              </fieldset>
              <p className="text-xs text-slate-500 max-w-3xl">These are non-secret tenant settings. API keys, webhook secrets, and scheduler secrets remain backend environment variables and are never stored here.</p>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-10 mb-16">
            <h4 className="text-slate-800 font-black text-lg mb-6 flex items-center gap-3"><Cloud size={24} className="text-indigo-600" /> Cloud & Organization</h4>
            <div className="bg-slate-50 rounded-3xl p-8 border border-slate-200 flex flex-col md:flex-row gap-8 items-center justify-between">
               <div>
                  <p className="text-slate-700 font-bold mb-1">Organization ID</p>
                  <p className="text-sm text-slate-500 font-medium md:max-w-md">Your current organization ID is <span className="font-mono text-indigo-600 font-bold">{currentOrgId}</span>. All cloud data is scoped to this organization.</p>
               </div>
               
               {isCloudConfigured ? (
                 <button 
                   onClick={() => { onClose(); onOpenCloudSetup(); }}
                   className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all shadow-sm ${
                     cloudStatus === 'connected' ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' :
                     cloudStatus === 'syncing' ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200' :
                     'bg-red-100 text-red-700 hover:bg-red-200'
                   }`}
                 >
                   {cloudStatus === 'syncing' ? <RefreshCw size={18} className="animate-spin" /> : <Cloud size={18} />}
                   {cloudStatus === 'syncing' ? 'CLOUD SYNCING...' : 'CLOUD SETTINGS'}
                 </button>
               ) : (
                 <button onClick={() => { onClose(); onOpenCloudSetup(); }} className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold bg-amber-100 text-amber-700 hover:bg-amber-200 transition-all shadow-sm">
                   <CloudOff size={18} /> LOCAL (SETUP CLOUD)
                 </button>
               )}
            </div>
          </div>

          <div className="border-t border-slate-100 pt-10 mb-16">
            <h4 className="text-slate-800 font-black text-lg mb-6 flex items-center gap-3"><RefreshCw size={24} className="text-indigo-600" /> Administrative Operations</h4>
            <div className="bg-slate-50 rounded-3xl p-8 border border-slate-200">
              <div className="max-w-2xl">
                <p className="text-slate-700 font-bold mb-2">Global Name Replacement</p>
                <p className="text-sm text-slate-500 mb-6 font-medium">Replace all occurrences of a team member's name with another name across all <span className="text-indigo-600 font-bold">active</span> projects. This is useful when someone leaves the company.</p>
                
                <div className="flex flex-col md:flex-row items-end gap-4">
                  <div className="flex-1 w-full">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Current Name</label>
                    <select 
                      className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-900 font-bold outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
                      value={replaceOldName}
                      onChange={(e) => setReplaceOldName(e.target.value)}
                    >
                      <option value="">Select current member...</option>
                      {(settings.people || []).map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  
                  <div className="flex-1 w-full">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Replacement Name</label>
                    <select 
                      className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-900 font-bold outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
                      value={replaceNewName}
                      onChange={(e) => setReplaceNewName(e.target.value)}
                    >
                      <option value="">Select replacement...</option>
                      {(settings.people || []).filter(p => p !== replaceOldName).map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>

                  <button 
                    disabled={!replaceOldName || !replaceNewName || isReplacing}
                    onClick={() => {
                      if (window.confirm(`Are you sure you want to replace "${replaceOldName}" with "${replaceNewName}" across all active projects? This cannot be undone.`)) {
                        setIsReplacing(true);
                        onBulkReplaceNameGlobal(replaceOldName, replaceNewName);
                        setTimeout(() => {
                          setIsReplacing(false);
                          setReplaceOldName('');
                          setReplaceNewName('');
                          alert('Replacement complete.');
                        }, 1000);
                      }
                    }}
                    className="bg-indigo-600 text-white font-black px-6 py-3 rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 disabled:opacity-50 disabled:shadow-none flex items-center gap-2 whitespace-nowrap"
                  >
                    {isReplacing ? <RefreshCw className="animate-spin" size={18} /> : <RefreshCw size={18} />}
                    RUN REPLACEMENT
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-10">
            <h4 className="text-slate-800 font-black text-lg mb-6 flex items-center gap-3"><Download size={24} className="text-indigo-600" /> Disaster Recovery</h4>
            <div className="bg-slate-50 rounded-3xl p-8 border border-slate-200">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
                <div className="max-w-md">
                  <p className="text-slate-700 font-semibold mb-2">Full Project Backup</p>
                  <p className="text-sm text-slate-500 leading-relaxed">Download your entire project history and configurations as a secure JSON file. You can restore this at any time to recover your work.</p>
                  <div className="mt-4 flex items-center gap-2 text-amber-600 font-bold text-[10px] bg-amber-50 px-3 py-1.5 rounded-full w-fit border border-amber-100">
                    <AlertTriangle size={14} /> WARNING: IMPORT OVERWRITES ALL LOCAL DATA
                  </div>
                </div>
                <div className="flex flex-col gap-3 min-w-[200px]">
                  <button onClick={onExportBackup} className="bg-white border-2 border-slate-200 text-slate-700 font-black py-3 rounded-2xl flex items-center justify-center gap-2 hover:bg-slate-50 hover:border-indigo-200 transition-all shadow-sm active:scale-95"><Download size={20} /> Export (.json)</button>
                  <input type="file" ref={fileInputRef} onChange={onImportBackup} accept=".json" className="hidden" />
                  <button onClick={() => fileInputRef.current?.click()} className="bg-indigo-600 text-white font-black py-3 rounded-2xl flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all shadow-indigo-200 shadow-lg active:scale-95"><Upload size={20} /> Import Backup</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <ServiceProjectWizard
        isOpen={Boolean(serviceWizard)}
        template={serviceWizard?.template}
        settings={settings}
        initial={serviceWizard?.project ? setupFromProject(serviceWizard.project) : undefined}
        onClose={() => setServiceWizard(null)}
        onComplete={async setup => {
          await onConfigureService(setup, serviceWizard?.project ? String(serviceWizard.project.id) : setup.serviceProjectId);
          await refreshServiceStatuses();
        }}
      />
    </div>
  );
};
