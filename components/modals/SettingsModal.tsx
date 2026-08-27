import React, { useEffect, useState } from 'react';
import { Settings, X, Plus, Tags, Building, User, CheckCircle2, Type as LucideType, Download, Upload, AlertTriangle, Mail, Phone, Briefcase, RefreshCw, Cloud, CloudOff } from 'lucide-react';
import { AppSettings, TeamMemberDetails } from '../../types';

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
  isOpen, onClose, settings, onUpdateSettings, onExportBackup, onImportBackup, onBulkReplaceNameGlobal, currentOrgId, isCloudConfigured, cloudStatus, onOpenCloudSetup
}) => {
  const [communicationsDraft, setCommunicationsDraft] = useState(settings.communications?.fromNumber || '');
  const communicationsNumberValid = !communicationsDraft || /^\+[1-9]\d{7,14}$/.test(communicationsDraft.trim());
  const [replaceOldName, setReplaceOldName] = useState('');
  const [replaceNewName, setReplaceNewName] = useState('');
  const [isReplacing, setIsReplacing] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCommunicationsDraft(settings.communications?.fromNumber || '');
  }, [settings.communications?.fromNumber]);

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
            <h4 className="text-slate-800 font-black text-lg mb-6 flex items-center gap-3"><Phone size={24} className="text-indigo-600" /> Communications</h4>
            <div className="bg-slate-50 rounded-3xl p-8 border border-slate-200">
              <label className="block text-sm font-bold text-slate-700 mb-2" htmlFor="communications-from-number">Sending phone number</label>
              <input
                id="communications-from-number"
                type="tel"
                pattern="\+[1-9][0-9]{7,14}"
                aria-describedby="communications-from-number-help"
                value={communicationsDraft}
                onChange={(e) => setCommunicationsDraft(e.target.value)}
                onBlur={() => {
                  if (!communicationsNumberValid) return;
                  onUpdateSettings({
                    ...settings,
                    communications: { ...settings.communications, fromNumber: communicationsDraft.trim() || undefined }
                  });
                }}
                placeholder="+61411111111"
                className={`w-full max-w-md bg-white border rounded-xl px-4 py-2.5 text-sm text-slate-900 font-mono outline-none focus:ring-2 shadow-sm ${communicationsNumberValid ? 'border-slate-300 focus:ring-indigo-500' : 'border-red-400 focus:ring-red-500'}`}
              />
              <p id="communications-from-number-help" className="text-xs text-slate-500 mt-3 max-w-2xl">
                Use E.164 format. This non-secret tenant setting supplies the SMS and voice sender. Communications API keys and webhook secrets remain backend environment variables and are never stored here.
              </p>
              {!communicationsNumberValid && <p className="text-xs text-red-600 mt-2">Enter an E.164 number such as +61411111111 before using SMS or voice.</p>}
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
    </div>
  );
};
