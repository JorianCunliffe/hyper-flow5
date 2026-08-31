import React, { useState } from 'react';
import { Wand2, Banknote, Copy } from 'lucide-react';
import { AppSettings, ProjectType, Project } from '../../types';
import type { ServiceSetupInput } from '../../lib/serviceSetup';
import { ServiceProjectWizard } from '../ServiceProjectWizard';

interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  isGenerating: boolean;
  onCreate: (projectData: any, useAI: boolean) => Promise<void> | void;
  archivedProjects: Project[];
  activeProjects: Project[];
  onReinstate: (projectId: string) => void;
}

export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({ 
  isOpen, onClose, settings, isGenerating, onCreate, archivedProjects, activeProjects, onReinstate 
}) => {
  const [serviceWizardOpen, setServiceWizardOpen] = useState(false);
  const [newProject, setNewProject] = useState({ 
    name: '', 
    company: '', 
    type: '', 
    template: 'blank',
    coachPerson: '',
    cloneFromId: '',
    startDate: new Date().toISOString().split('T')[0],
    timeUnit: 'days',
    timeBuffer: 0,
    cashRequirement: 0,
    debtRequirement: 0,
    valueAtCompletion: 0,
    profit: 0
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl p-8 overflow-hidden relative border border-slate-200">
        {isGenerating && (
          <div className="absolute inset-0 bg-white/90 z-10 flex flex-col items-center justify-center p-8 text-center animate-in zoom-in duration-300">
            <div className="w-20 h-20 bg-indigo-50 rounded-3xl flex items-center justify-center mb-6 border border-indigo-100 relative">
              <Wand2 className="w-10 h-10 text-indigo-600 animate-bounce" />
              <div className="absolute inset-0 rounded-3xl ring-4 ring-indigo-500/20 animate-ping" />
            </div>
            <p className="text-slate-900 font-black text-xl mb-2">Gemini is Strategizing...</p>
            <p className="text-slate-500 text-sm font-medium">Constructing a dependency map and detailed subtask hierarchy for your project.</p>
          </div>
        )}
        <h3 className="text-2xl font-black text-slate-900 mb-6">Start New Project</h3>
        <div className="grid grid-cols-2 gap-6 mb-6">
          <div className="col-span-2">
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Project Identity</label>
            <input 
              type="text" 
              className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3 outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 text-slate-900 font-bold placeholder-slate-300 transition-all"
              value={newProject.name}
              onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
              placeholder="e.g. Skyline Towers Phase 1"
            />
          </div>
          <div>
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Company</label>
            <select className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3 outline-none focus:border-indigo-500 text-slate-900 font-bold shadow-sm transition-all" value={newProject.company} onChange={(e) => setNewProject({ ...newProject, company: e.target.value })}>
              <option value="">Select...</option>
              {(settings.companies || []).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Category</label>
            <select className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3 outline-none focus:border-indigo-500 text-slate-900 font-bold shadow-sm transition-all" value={newProject.type} onChange={(e) => setNewProject({ ...newProject, type: e.target.value })}>
              <option value="">Select...</option>
              {(settings.projectTypes || []).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-black text-violet-500 uppercase tracking-widest mb-2">HyperFlow Service Template</label>
            <select className="w-full bg-violet-50/50 border-2 border-violet-100 rounded-2xl px-5 py-3 outline-none focus:border-violet-500 text-violet-900 font-bold shadow-sm transition-all" value={newProject.template} onChange={(e) => setNewProject({ ...newProject, template: e.target.value, name: e.target.value === 'daily_coaching' && !newProject.name ? 'Daily Coaching' : e.target.value === 'email_triage' && !newProject.name ? 'Daily Email Triage' : newProject.name })}>
              <option value="blank">Blank project</option>
              <option value="daily_coaching">Daily Coaching</option>
              <option value="email_triage">Daily Email Triage</option>
            </select>
          </div>
          {['daily_coaching', 'email_triage'].includes(newProject.template) && <div className="col-span-2 rounded-2xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-900">Service projects use a guided setup that verifies connections, resources, recipients, permissions, and schedule before creating anything.</div>}
          <div className="col-span-2">
            <label className="block text-xs font-black text-indigo-400 uppercase tracking-widest mb-2 flex items-center gap-1"><Copy size={12}/> Clone From Existing Project (Optional)</label>
            <select className="w-full bg-indigo-50/50 border-2 border-indigo-100 rounded-2xl px-5 py-3 outline-none focus:border-indigo-500 text-indigo-900 font-bold shadow-sm transition-all" value={newProject.cloneFromId} onChange={(e) => setNewProject({ ...newProject, cloneFromId: e.target.value })}>
              <option value="">Do not clone...</option>
              {activeProjects.length > 0 && (
                <optgroup label="Active Projects">
                  {activeProjects.map(p => <option key={p.id} value={p.id}>{p.displayId} - {p.name}</option>)}
                </optgroup>
              )}
              {archivedProjects.length > 0 && (
                <optgroup label="Archived Projects">
                  {archivedProjects.map(p => <option key={p.id} value={p.id}>{p.displayId} - {p.name}</option>)}
                </optgroup>
              )}
            </select>
          </div>
          <div className="col-span-1">
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Start Date</label>
            <input 
              type="date" 
              className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3 outline-none focus:border-indigo-500 text-slate-900 font-bold shadow-sm transition-all"
              value={newProject.startDate}
              onChange={(e) => setNewProject({ ...newProject, startDate: e.target.value })}
            />
          </div>
          <div className="col-span-1">
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Estimates Time Unit</label>
            <select 
              className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3 outline-none focus:border-indigo-500 text-slate-900 font-bold shadow-sm transition-all"
              value={newProject.timeUnit}
              onChange={(e) => setNewProject({ ...newProject, timeUnit: e.target.value })}
            >
              <option value="hours">Hours</option>
              <option value="days">Days</option>
              <option value="weeks">Weeks</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Time Buffer ({newProject.timeUnit})</label>
            <input 
              type="number" 
              className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3 outline-none focus:border-indigo-500 text-slate-900 font-bold shadow-sm transition-all"
              value={newProject.timeBuffer || ''}
              onChange={(e) => setNewProject({ ...newProject, timeBuffer: parseFloat(e.target.value) || 0 })}
              placeholder="0"
            />
          </div>
        </div>

        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 mb-8">
            <div className="flex items-center gap-2 mb-3 text-indigo-600 font-bold text-sm uppercase tracking-wider">
              <Banknote size={16} /> Financial Projections (in $K)
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Cash Required ($K)</label>
                <input 
                  type="number" 
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-bold outline-none focus:border-indigo-500"
                  value={newProject.cashRequirement || ''}
                  onChange={(e) => setNewProject({ ...newProject, cashRequirement: parseFloat(e.target.value) || 0 })}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Debt Required ($K)</label>
                <input 
                  type="number" 
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-bold outline-none focus:border-indigo-500"
                  value={newProject.debtRequirement || ''}
                  onChange={(e) => setNewProject({ ...newProject, debtRequirement: parseFloat(e.target.value) || 0 })}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Value at Completion ($K)</label>
                <input 
                  type="number" 
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-bold outline-none focus:border-indigo-500"
                  value={newProject.valueAtCompletion || ''}
                  onChange={(e) => setNewProject({ ...newProject, valueAtCompletion: parseFloat(e.target.value) || 0 })}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-emerald-600 uppercase mb-1">Profit ($K)</label>
                <input 
                  type="number" 
                  className="w-full bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-emerald-800 font-bold outline-none focus:border-emerald-500"
                  value={newProject.profit || ''}
                  onChange={(e) => setNewProject({ ...newProject, profit: parseFloat(e.target.value) || 0 })}
                  placeholder="0"
                />
              </div>
            </div>
        </div>

        {archivedProjects.length > 0 && (
          <div className="bg-amber-50 rounded-2xl p-4 border border-amber-100 mb-8">
            <label className="block text-xs font-black text-amber-600 uppercase tracking-widest mb-2">Reinstate Archived Project</label>
            <select 
              className="w-full bg-white border-2 border-amber-100 rounded-xl px-4 py-2 text-slate-900 font-bold outline-none focus:border-amber-500"
              onChange={(e) => {
                if (e.target.value) {
                  onReinstate(e.target.value);
                }
              }}
              defaultValue=""
            >
              <option value="" disabled>Select a project to reinstate...</option>
              {archivedProjects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <button onClick={onClose} className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-black py-4 rounded-2xl transition-all active:scale-95 shadow-sm">Cancel</button>
          <div className="flex flex-col gap-2">
            {!newProject.cloneFromId && !['daily_coaching', 'email_triage'].includes(newProject.template) ? (
              <>
                <button 
                  onClick={() => onCreate(newProject, false)} 
                  disabled={!newProject.name}
                  className="bg-white border-2 border-indigo-100 hover:border-indigo-600 text-indigo-700 font-bold py-3 rounded-2xl transition-all shadow-sm active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {newProject.template === 'blank' ? 'Create Blank' : 'Create from Template'}
                </button>
                {newProject.template === 'blank' && <button
                  onClick={() => onCreate(newProject, true)} 
                  disabled={!newProject.name}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-black py-4 rounded-2xl shadow-lg shadow-indigo-200 transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Wand2 size={18} /> AI Generate
                </button>}
              </>
            ) : newProject.cloneFromId ? (
              <button 
                onClick={() => onCreate(newProject, false)} 
                disabled={!newProject.name}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-black py-4 h-full rounded-2xl shadow-lg shadow-indigo-200 transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Copy size={18} /> Clone Project
              </button>
            ) : <button
              type="button"
              onClick={() => setServiceWizardOpen(true)}
              className="bg-violet-600 hover:bg-violet-700 text-white font-black py-4 h-full rounded-2xl shadow-lg shadow-violet-200 transition-all active:scale-95"
            >Configure service</button>}
          </div>
        </div>
      </div>
      <ServiceProjectWizard
        isOpen={serviceWizardOpen}
        template={newProject.template === 'daily_coaching' ? 'daily_coaching' : 'email_triage'}
        settings={settings}
        onClose={() => setServiceWizardOpen(false)}
        onComplete={async (serviceSetup: ServiceSetupInput) => {
          await onCreate({ ...newProject, name: serviceSetup.projectName, serviceSetup }, false);
        }}
      />
    </div>
  );
};
