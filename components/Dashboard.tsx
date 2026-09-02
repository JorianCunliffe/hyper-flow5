import React, { useState, useMemo } from 'react';
import { AlertTriangle, ArrowUpDown, Building, CalendarDays, CheckCircle2, ChevronDown, Copy, Eye, Filter, FolderKanban, PenSquare, RefreshCw, Search, User, UserX, X } from 'lucide-react';
import { Project, AppSettings } from '../types';
import { isTaskComplete } from '../lib/taskStatus';
import { isTaskDueToday, isTaskOverdue, pickNextTask, portfolioSummary, projectHealth } from '../lib/portfolioPresentation';

interface DashboardProps {
  projects: Project[];
  settings: AppSettings;
  onSelectProject: (id: string) => void;
  onEditProject: (project: Project) => void;
  onDuplicateProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  formatDate: (date: Date | number) => string;
  onOpenKanban: (focus: 'late' | 'today' | 'unassigned') => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  projects,
  settings,
  onSelectProject,
  onEditProject,
  onDuplicateProject,
  onDeleteProject,
  formatDate,
  onOpenKanban
}) => {
  const [filterType, setFilterType] = useState<string>('ALL');
  const [filterCompany, setFilterCompany] = useState<string>('ALL');
  const [filterAssignee, setFilterAssignee] = useState<string>('ALL');
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<'attention' | 'updated' | 'name'>('attention');

  const summary = useMemo(() => portfolioSummary(projects), [projects]);

  const filteredProjects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = projects.filter(p => {
      const matchesAssignee = filterAssignee === 'ALL' || p.milestones.some(m => {
        const tasks = Array.isArray(m.subtasks) ? m.subtasks : [];
        return tasks.some(s => s.assignedTo === filterAssignee);
      });
      const matchesType = filterType === 'ALL' || p.type === filterType;
      const matchesCompany = filterCompany === 'ALL' || p.company === filterCompany;
      const matchesQuery = !needle || [p.name, p.company, p.type, p.displayId].some(value => String(value || '').toLowerCase().includes(needle));
      return matchesAssignee && matchesType && matchesCompany && matchesQuery;
    });
    return filtered.sort((a, b) => {
      if (sortMode === 'updated') return b.updatedAt - a.updatedAt;
      if (sortMode === 'name') return a.name.localeCompare(b.name);
      const rank = { at_risk: 0, attention: 1, on_track: 2, complete: 3 };
      return rank[projectHealth(a).kind] - rank[projectHealth(b).kind] || b.updatedAt - a.updatedAt;
    });
  }, [projects, filterAssignee, filterType, filterCompany, query, sortMode]);

  const clearFilters = () => {
    setQuery('');
    setFilterType('ALL');
    setFilterCompany('ALL');
    setFilterAssignee('ALL');
  };

  return (
    <div className="flex-1 p-4 md:p-8 max-w-7xl mx-auto h-full overflow-y-auto">
      <div className="mb-6 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div><h2 className="text-2xl font-bold text-slate-800">Portfolio</h2><p className="mt-1 text-sm text-slate-500">See what needs attention across every active project.</p></div>
        <div className="text-xs font-semibold text-slate-400">{summary.completed} of {summary.tasks} tasks completed</div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wide text-slate-400">Active projects</span><FolderKanban size={18} className="text-indigo-500" /></div><div className="mt-2 text-2xl font-black text-slate-900">{summary.projects}</div></div>
        <button type="button" onClick={() => onOpenKanban('late')} className="rounded-2xl border border-red-100 bg-white p-4 text-left shadow-sm hover:border-red-300"><div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wide text-slate-400">Overdue</span><AlertTriangle size={18} className="text-red-500" /></div><div className="mt-2 text-2xl font-black text-red-700">{summary.overdue}</div></button>
        <button type="button" onClick={() => onOpenKanban('today')} className="rounded-2xl border border-indigo-100 bg-white p-4 text-left shadow-sm hover:border-indigo-300"><div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wide text-slate-400">Due today</span><CalendarDays size={18} className="text-indigo-500" /></div><div className="mt-2 text-2xl font-black text-indigo-700">{summary.dueToday}</div></button>
        <button type="button" onClick={() => onOpenKanban('unassigned')} className="rounded-2xl border border-amber-100 bg-white p-4 text-left shadow-sm hover:border-amber-300"><div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wide text-slate-400">Unassigned</span><UserX size={18} className="text-amber-500" /></div><div className="mt-2 text-2xl font-black text-amber-700">{summary.unassigned}</div></button>
      </div>

      <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <label className="relative min-w-0 flex-1"><span className="sr-only">Search projects</span><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search project, company, type or ID…" className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500" /></label>
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
          <label className="relative"><span className="sr-only">Sort projects</span><ArrowUpDown size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><select value={sortMode} onChange={event => setSortMode(event.target.value as typeof sortMode)} className="rounded-lg border border-slate-300 bg-white py-1.5 pl-9 pr-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500"><option value="attention">Needs attention first</option><option value="updated">Recently updated</option><option value="name">Project name</option></select></label>
          {(query || filterAssignee !== 'ALL' || filterType !== 'ALL' || filterCompany !== 'ALL') && <button type="button" onClick={clearFilters} className="rounded-lg px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-50">Clear filters</button>}
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
          const completedTasks = relevantTasks.filter(isTaskComplete).length;
          const progressPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
          const nextTask = pickNextTask(relevantTasks);
          const health = projectHealth(p);
          const healthClass = health.kind === 'at_risk' ? 'bg-red-50 text-red-700 border-red-100' : health.kind === 'attention' ? 'bg-amber-50 text-amber-700 border-amber-100' : health.kind === 'complete' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-slate-50 text-slate-600 border-slate-100';
          const nextTaskContext = nextTask ? isTaskOverdue(nextTask) ? 'Overdue' : isTaskDueToday(nextTask) ? 'Due today' : nextTask.isImportant ? 'Important' : nextTask.status === 'Started' ? 'In progress' : !nextTask.assignedTo ? 'Needs owner' : 'Next action' : undefined;

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
              <div className="flex flex-col items-end gap-1"><span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${healthClass}`}>{health.label}</span><span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">{p.type}</span></div>
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
                    <div className={`mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${nextTaskContext === 'Overdue' ? 'text-red-600' : 'text-indigo-600'}`}>
                      {nextTaskContext === 'Overdue' ? <AlertTriangle size={10} /> : <CalendarDays size={10} />} {nextTaskContext} {filterAssignee !== 'ALL' && `for ${filterAssignee}`}
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
                    {nextTask.dueDate && <div className="mt-1 text-[10px] font-medium text-slate-500">Due {formatDate(nextTask.dueDate)}</div>}
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
                const complete = safeSubtasks.filter(isTaskComplete).length;
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
              <button onClick={() => onEditProject(p)} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="Edit project settings" aria-label={`Edit ${p.name}`}><PenSquare size={16} /></button>
              <button onClick={() => onDuplicateProject(p.id)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition-colors" title="Duplicate project" aria-label={`Duplicate ${p.name}`}><Copy size={16} /></button>
              <button onClick={() => onDeleteProject(p.id)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Delete project" aria-label={`Delete ${p.name}`}><X size={16} /></button>
            </div>
          </div>
        );
      })}
      </div>
      {filteredProjects.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center"><FolderKanban className="mx-auto text-slate-300" size={32} /><h3 className="mt-3 font-bold text-slate-800">No projects match these filters</h3><p className="mt-1 text-sm text-slate-500">Clear the search and filters to return to the full portfolio.</p><button type="button" onClick={clearFilters} className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700">Clear filters</button></div>}
    </div>
  );
};
