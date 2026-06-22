import React, { useState, useMemo } from 'react';
import { User, ChevronDown, Filter, RefreshCw, Building, Clock, CheckCircle2, Eye, PenSquare, Copy, X, Banknote } from 'lucide-react';
import { Project, AppSettings } from '../types';
import { getStatusBorderColor } from '../constants';

interface DashboardProps {
  projects: Project[];
  settings: AppSettings;
  onSelectProject: (id: string) => void;
  onEditProject: (project: Project) => void;
  onDuplicateProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  formatDate: (date: Date | number) => string;
}

export const Dashboard: React.FC<DashboardProps> = ({
  projects,
  settings,
  onSelectProject,
  onEditProject,
  onDuplicateProject,
  onDeleteProject,
  formatDate
}) => {
  const [filterType, setFilterType] = useState<string>('ALL');
  const [filterCompany, setFilterCompany] = useState<string>('ALL');
  const [filterAssignee, setFilterAssignee] = useState<string>('ALL');

  const filteredProjects = useMemo(() => {
    return projects.filter(p => {
      const matchesAssignee = filterAssignee === 'ALL' || p.milestones.some(m => {
        const tasks = Array.isArray(m.subtasks) ? m.subtasks : [];
        return tasks.some(s => s.assignedTo === filterAssignee);
      });
      const matchesType = filterType === 'ALL' || p.type === filterType;
      const matchesCompany = filterCompany === 'ALL' || p.company === filterCompany;
      return matchesAssignee && matchesType && matchesCompany;
    });
  }, [projects, filterAssignee, filterType, filterCompany]);

  return (
    <div className="flex-1 p-4 md:p-8 max-w-7xl mx-auto h-full overflow-y-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <h2 className="text-2xl font-bold text-slate-800">Your Projects</h2>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <select 
              className="bg-white border border-slate-300 rounded-lg pl-9 pr-8 py-1.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 w-56 shadow-sm appearance-none cursor-pointer"
              value={filterAssignee}
              onChange={(e) => setFilterAssignee(e.target.value)}
            >
              <option value="ALL">Filter by Assignee</option>
              {(settings.people || []).map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>
          <div className="flex items-center gap-2">
            <Filter size={18} className="text-slate-400" />
            <select 
              className="bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
            >
              <option value="ALL">All Types</option>
              {(settings.projectTypes || []).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select 
              className="bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
              value={filterCompany}
              onChange={(e) => setFilterCompany(e.target.value)}
            >
              <option value="ALL">All Companies</option>
              {(settings.companies || []).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredProjects.map(p => {
          const allTasks = p.milestones.flatMap(m => m.subtasks || []);
          
          const relevantTasks = filterAssignee === 'ALL' 
            ? allTasks 
            : allTasks.filter(t => t.assignedTo === filterAssignee);

          const totalTasks = relevantTasks.length;
          const completedTasks = relevantTasks.filter(t => t.status === 'Complete').length;
          const progressPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
          
          const nextTask = relevantTasks.find(t => t.status === 'Not started');

          return (
          <div 
            key={p.id}
            className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow group relative flex flex-col"
          >
            <div className="flex justify-between items-start mb-2">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  {p.displayId && (
                    <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 tracking-tighter shrink-0">
                      {p.displayId}
                    </span>
                  )}
                  <h3 className="text-lg font-bold text-slate-900 leading-tight truncate">{p.name}</h3>
                </div>
                <div className="flex items-center gap-1.5 text-slate-500 text-sm">
                  <Building size={14} />
                  <span>{p.company}</span>
                </div>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                {p.type}
              </span>
            </div>

            <div className="flex items-center gap-2 text-[10px] text-slate-400 mb-4">
              <RefreshCw size={10} />
              <span>Last updated {formatDate(p.updatedAt)}</span>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-4 text-[10px] text-slate-600">
                <div className="bg-slate-50 p-1.5 rounded border border-slate-100 flex justify-between">
                  <span>Cash Req:</span> <span className="font-bold">${p.cashRequirement || 0}k</span>
                </div>
                <div className="bg-slate-50 p-1.5 rounded border border-slate-100 flex justify-between">
                  <span>Debt Req:</span> <span className="font-bold">${p.debtRequirement || 0}k</span>
                </div>
                <div className="bg-slate-50 p-1.5 rounded border border-slate-100 flex justify-between">
                  <span>VAC:</span> <span className="font-bold">${p.valueAtCompletion || 0}k</span>
                </div>
                <div className="bg-emerald-50 text-emerald-700 p-1.5 rounded border border-emerald-100 flex justify-between font-bold">
                  <span>Profit:</span> <span>${p.profit || 0}k</span>
                </div>
            </div>

            <div className="mb-5 space-y-3">
              <div>
                <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                  <span>{filterAssignee !== 'ALL' ? `${filterAssignee}'s Progress` : 'Progress'}</span>
                  <span className="text-slate-900">{progressPct}%</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                  <div 
                    className="bg-indigo-500 h-full rounded-full" 
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
              
              {nextTask ? (
                <div className="bg-slate-50 border border-slate-100 rounded-lg p-2.5">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-indigo-600 uppercase tracking-wider mb-1">
                      <Clock size={10} /> Next Action {filterAssignee !== 'ALL' && `for ${filterAssignee}`}
                    </div>
                    <div className="flex justify-between items-start gap-2">
                      <span className="text-xs font-semibold text-slate-800 line-clamp-1" title={nextTask.name}>
                        {nextTask.name}
                      </span>
                      {nextTask.assignedTo && (
                        <div className="shrink-0 flex items-center gap-1 text-[10px] text-slate-500 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                          <User size={10} />
                          <span className="max-w-[60px] truncate">{nextTask.assignedTo}</span>
                        </div>
                      )}
                    </div>
                </div>
              ) : (
                  <div className="bg-slate-50 border border-slate-100 rounded-lg p-2.5 text-center">
                    <div className="flex items-center justify-center gap-1.5 text-emerald-600 text-xs font-bold">
                      <CheckCircle2 size={12} /> {filterAssignee !== 'ALL' ? 'No pending tasks' : 'All tasks complete'}
                    </div>
                  </div>
              )}
            </div>

            <div className="flex gap-2 mb-6 overflow-x-auto pb-2 scrollbar-hide flex-1">
              {(p.milestones || []).slice(0, 4).map(m => {
                const safeSubtasks = m.subtasks || [];
                const complete = safeSubtasks.filter((s: any) => s.status === 'Complete').length;
                const total = safeSubtasks.length || 1;
                const progress = (complete / total) * 360;
                return (
                  <div key={m.id} className="shrink-0 flex flex-col items-center">
                    <div className="w-8 h-8 rounded-full bg-slate-50 ring-1 ring-slate-100 flex items-center justify-center">
                      <div 
                        className="w-5 h-5 rounded-full" 
                        style={{ background: `conic-gradient(#22c55e ${progress}deg, #f1f5f9 0deg)` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-2 mt-auto">
              <button 
                onClick={() => onSelectProject(p.id)}
                className="flex-1 bg-slate-50 hover:bg-indigo-50 hover:text-indigo-600 text-slate-700 font-semibold py-2 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
              >
                <Eye size={16} /> Open
              </button>
              <button onClick={() => onEditProject(p)} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="Edit Project Settings"><PenSquare size={16} /></button>
              <button onClick={() => onDuplicateProject(p.id)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"><Copy size={16} /></button>
              <button onClick={() => onDeleteProject(p.id)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><X size={16} /></button>
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
};