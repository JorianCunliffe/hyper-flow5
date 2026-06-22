import React, { useState } from 'react';
import { Settings, Banknote, RefreshCw, User, Briefcase, ChevronDown, ChevronUp } from 'lucide-react';
import { Project, AppSettings } from '../../types';

interface EditProjectModalProps {
  project: Project;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedProject: Project) => void;
  onBulkOperation: (projectId: string, operation: { type: 'replace_name' | 'assign_role', oldName?: string, newName: string, role?: string }) => void;
  settings: AppSettings;
}

export const EditProjectModal: React.FC<EditProjectModalProps> = ({ 
  project, isOpen, onClose, onSave, settings, onBulkOperation 
}) => {
  const [editedProject, setEditedProject] = useState<Project>(project);
  const [showBulkOps, setShowBulkOps] = useState(false);
  
  // Bulk Op Local State
  const [replaceOldName, setReplaceOldName] = useState('');
  const [replaceNewName, setReplaceNewName] = useState('');
  const [assignRole, setAssignRole] = useState('');
  const [assignNewName, setAssignNewName] = useState('');

  if (!isOpen) return null;

  const unstaffedRoles = project.milestones.flatMap(m => m.subtasks).filter(t => t.role && !t.assignedTo);
  const unstaffedRoleCounts = unstaffedRoles.reduce((acc, t) => {
    if (t.role) acc[t.role] = (acc[t.role] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const hasUnstaffedRoles = Object.keys(unstaffedRoleCounts).length > 0;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col relative border border-slate-200 animate-in fade-in zoom-in duration-200">
        <div className="p-8 overflow-y-auto flex-1">
          <div className="flex justify-between items-center mb-6">
          <h3 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <Settings className="text-slate-400" /> Edit Project Settings
          </h3>
          {project.displayId && (
            <span className="bg-slate-100 text-slate-500 text-xs font-black px-3 py-1 rounded-lg border border-slate-200 tracking-tighter">
              {project.displayId}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-6 mb-6">
          <div className="col-span-2">
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Project Name</label>
            <input 
              type="text" 
              className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3 outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 text-slate-900 font-bold placeholder-slate-300 transition-all"
              value={editedProject.name}
              onChange={(e) => setEditedProject({ ...editedProject, name: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Company</label>
            <select className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3 outline-none focus:border-indigo-500 text-slate-900 font-bold shadow-sm transition-all" value={editedProject.company} onChange={(e) => setEditedProject({ ...editedProject, company: e.target.value })}>
              <option value="">Select...</option>
              {(settings.companies || []).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Category</label>
            <select className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3 outline-none focus:border-indigo-500 text-slate-900 font-bold shadow-sm transition-all" value={editedProject.type} onChange={(e) => setEditedProject({ ...editedProject, type: e.target.value })}>
              <option value="">Select...</option>
              {(settings.projectTypes || []).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="col-span-1">
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Start Date</label>
            <input 
              type="date" 
              className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3 outline-none focus:border-indigo-500 text-slate-900 font-bold shadow-sm transition-all"
              value={new Date(editedProject.startDate).toISOString().split('T')[0]}
              onChange={(e) => setEditedProject({ ...editedProject, startDate: new Date(e.target.value).getTime() })}
            />
          </div>
          <div className="col-span-1">
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Estimates Time Unit</label>
            <select 
              className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3 outline-none focus:border-indigo-500 text-slate-900 font-bold shadow-sm transition-all"
              value={editedProject.timeUnit || 'days'}
              onChange={(e) => setEditedProject({ ...editedProject, timeUnit: e.target.value as any })}
            >
              <option value="hours">Hours</option>
              <option value="days">Days</option>
              <option value="weeks">Weeks</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Time Buffer ({editedProject.timeUnit || 'days'})</label>
            <input 
              type="number" 
              className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3 outline-none focus:border-indigo-500 text-slate-900 font-bold shadow-sm transition-all"
              value={editedProject.timeBuffer || ''}
              onChange={(e) => setEditedProject({ ...editedProject, timeBuffer: parseFloat(e.target.value) || 0 })}
              placeholder="0"
            />
          </div>
          <div className="col-span-2 flex items-center gap-3 bg-amber-50 p-4 rounded-2xl border border-amber-100">
            <input 
              type="checkbox" 
              id="isArchived"
              className="w-5 h-5 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
              checked={editedProject.isArchived || false}
              onChange={(e) => setEditedProject({ ...editedProject, isArchived: e.target.checked })}
            />
            <label htmlFor="isArchived" className="text-sm font-bold text-amber-900 cursor-pointer">
              Archive this project (removes from active view)
            </label>
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
                  value={editedProject.cashRequirement || ''}
                  onChange={(e) => setEditedProject({ ...editedProject, cashRequirement: parseFloat(e.target.value) || 0 })}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Debt Required ($K)</label>
                <input 
                  type="number" 
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-bold outline-none focus:border-indigo-500"
                  value={editedProject.debtRequirement || ''}
                  onChange={(e) => setEditedProject({ ...editedProject, debtRequirement: parseFloat(e.target.value) || 0 })}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Value at Completion ($K)</label>
                <input 
                  type="number" 
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-bold outline-none focus:border-indigo-500"
                  value={editedProject.valueAtCompletion || ''}
                  onChange={(e) => setEditedProject({ ...editedProject, valueAtCompletion: parseFloat(e.target.value) || 0 })}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-emerald-600 uppercase mb-1">Profit ($K)</label>
                <input 
                  type="number" 
                  className="w-full bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-emerald-800 font-bold outline-none focus:border-emerald-500"
                  value={editedProject.profit || ''}
                  onChange={(e) => setEditedProject({ ...editedProject, profit: parseFloat(e.target.value) || 0 })}
                  placeholder="0"
                />
              </div>
            </div>
        </div>

        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 mb-8">
            <div className="flex items-center gap-2 mb-3 text-indigo-600 font-bold text-sm uppercase tracking-wider">
              <Banknote size={16} /> Project Data (JSON)
            </div>
            <div>
              <textarea
                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-mono text-xs outline-none focus:border-indigo-500 min-h-[150px]"
                value={JSON.stringify(editedProject.projectData || {}, null, 2)}
                onChange={(e) => {
                  try {
                    const parsed = JSON.parse(e.target.value);
                    setEditedProject({ ...editedProject, projectData: parsed });
                  } catch(err) {
                    // ignore invalid JSON while typing
                  }
                }}
              />
              <p className="text-[10px] text-slate-400 mt-1">Edit the underlying project data store. Valid JSON required.</p>
            </div>
        </div>

        {/* Bulk Operations Section */}
        <div className="bg-slate-50 rounded-2xl border border-slate-100 mb-8 overflow-hidden">
          <button 
            onClick={() => setShowBulkOps(!showBulkOps)}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-100 transition-colors"
          >
            <div className={`flex items-center gap-2 font-bold text-sm uppercase tracking-wider ${hasUnstaffedRoles ? 'text-amber-600' : 'text-indigo-600'}`}>
              <RefreshCw size={16} /> Bulk Operations {hasUnstaffedRoles && <span className="bg-amber-200 text-amber-800 text-[10px] px-2 py-0.5 rounded-full ml-2">Unstaffed Roles</span>}
            </div>
            {showBulkOps ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
          </button>
          
          {showBulkOps && (
            <div className="p-4 border-t border-slate-200 bg-white space-y-6 animate-in slide-in-from-top-2 duration-200">
              {hasUnstaffedRoles && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <h4 className="text-xs font-black text-amber-800 uppercase mb-2 flex items-center gap-2">
                    <User size={14} className="text-amber-500" /> Unstaffed Roles Tracking
                  </h4>
                  <p className="text-[10px] text-amber-700 mb-3">The following roles are defined in tasks but currently have no person assigned:</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(unstaffedRoleCounts).map(([r, count]) => (
                      <div key={r} onClick={() => setAssignRole(r)} className="bg-white border border-amber-200 text-amber-800 text-xs font-bold px-3 py-1.5 rounded-lg cursor-pointer hover:bg-amber-100 transition-colors" title={`Click to select ${r} for bulk assignment`}>
                        {r} <span className="bg-amber-200 text-amber-900 rounded-full px-1.5 py-0.5 text-[9px] ml-1">{String(count)} task{Number(count) > 1 ? 's' : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Op 1: Replace Name */}
              <div>
                <h4 className="text-xs font-black text-slate-800 uppercase mb-3 flex items-center gap-2">
                  <User size={14} className="text-indigo-500" /> Replace Assignee Name
                </h4>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="block text-[8px] font-black text-slate-400 uppercase mb-1">Current</label>
                    <select 
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-900 outline-none focus:border-indigo-500"
                      value={replaceOldName}
                      onChange={(e) => setReplaceOldName(e.target.value)}
                    >
                      <option value="">Select...</option>
                      {settings.people.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-[8px] font-black text-slate-400 uppercase mb-1">Replace With</label>
                    <select 
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-900 outline-none focus:border-indigo-500"
                      value={replaceNewName}
                      onChange={(e) => setReplaceNewName(e.target.value)}
                    >
                      <option value="">Select...</option>
                      {settings.people.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <button 
                    disabled={!replaceOldName || !replaceNewName}
                    onClick={() => {
                      onBulkOperation(project.id, { type: 'replace_name', oldName: replaceOldName, newName: replaceNewName });
                      setReplaceOldName('');
                      setReplaceNewName('');
                      alert('Assignees replaced successfully.');
                    }}
                    className="bg-indigo-600 text-white font-bold p-1.5 px-3 rounded-lg text-[10px] hover:bg-indigo-700 disabled:opacity-50"
                  >
                    RUN
                  </button>
                </div>
              </div>

              {/* Op 2: Assign Name to Role */}
              <div>
                <h4 className="text-xs font-black text-slate-800 uppercase mb-3 flex items-center gap-2">
                  <Briefcase size={14} className="text-indigo-500" /> Assign Name to Role
                </h4>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="block text-[8px] font-black text-slate-400 uppercase mb-1">Target Role</label>
                    <select 
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-900 outline-none focus:border-indigo-500"
                      value={assignRole}
                      onChange={(e) => setAssignRole(e.target.value)}
                    >
                      <option value="">Select role...</option>
                      {settings.roles.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-[8px] font-black text-slate-400 uppercase mb-1">Assign Person</label>
                    <select 
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-900 outline-none focus:border-indigo-500"
                      value={assignNewName}
                      onChange={(e) => setAssignNewName(e.target.value)}
                    >
                      <option value="">Select person...</option>
                      {settings.people.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <button 
                    disabled={!assignRole || !assignNewName}
                    onClick={() => {
                      onBulkOperation(project.id, { type: 'assign_role', role: assignRole, newName: assignNewName });
                      setAssignRole('');
                      setAssignNewName('');
                      alert('Role assignments updated.');
                    }}
                    className="bg-indigo-600 text-white font-bold p-1.5 px-3 rounded-lg text-[10px] hover:bg-indigo-700 disabled:opacity-50"
                  >
                    RUN
                  </button>
                </div>
                <p className="text-[9px] text-slate-400 mt-2 italic">Assigns the selected person to ALL tasks in this project that have the selected Role.</p>
              </div>
            </div>
          )}
        </div>
        
        </div>
        <div className="p-6 border-t border-slate-100 bg-white rounded-b-3xl shrink-0">
          <div className="flex gap-4">
            <button onClick={onClose} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black py-4 rounded-2xl transition-all active:scale-95 shadow-sm">Cancel</button>
            <button 
              onClick={() => onSave(editedProject)} 
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-black py-4 rounded-2xl shadow-lg shadow-indigo-200 transition-all active:scale-95 flex items-center justify-center gap-2"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};