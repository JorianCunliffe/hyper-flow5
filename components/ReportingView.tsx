import React, { useState, useMemo } from 'react';
import { Project, AppSettings, Subtask, Milestone, ActivityLog } from '../types';
import { BarChart3, Filter, Calendar, CheckCircle2, Circle, AlertCircle, Clock, Activity, Target } from 'lucide-react';

interface ReportingViewProps {
  projects: Project[];
  settings: AppSettings;
  activityLogs: ActivityLog[];
  onTaskClick?: (projectId: string, taskId: string) => void;
}

export const ReportingView: React.FC<ReportingViewProps> = ({ projects, settings, activityLogs, onTaskClick }) => {
  const [activeTab, setActiveTab] = useState<'current' | 'progress'>('progress');
  const [filterProject, setFilterProject] = useState<string>('ALL');
  const [filterMember, setFilterMember] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });

  // Flatten all tasks from non-archived projects
  const allTasks = useMemo(() => {
    const list: { task: Subtask, milestone: Milestone, project: Project }[] = [];
    projects.filter(p => !p.isArchived).forEach(project => {
      project.milestones.forEach(milestone => {
        milestone.subtasks.forEach(task => {
          list.push({ task, milestone, project });
        });
      });
    });
    return list;
  }, [projects]);

  const filteredTasks = useMemo(() => {
    let result = allTasks;

    if (filterProject !== 'ALL') {
      result = result.filter(item => item.project.id === filterProject);
    }
    if (filterMember !== 'ALL') {
      result = result.filter(item => item.task.assignedTo === filterMember);
    }
    if (filterStatus !== 'ALL') {
      result = result.filter(item => item.task.status === filterStatus);
    }
    if (startDate) {
      const startMs = new Date(startDate).getTime();
      result = result.filter(item => item.task.dueDate && item.task.dueDate >= startMs);
    }
    if (endDate) {
      const endMs = new Date(endDate).getTime();
      result = result.filter(item => item.task.dueDate && item.task.dueDate <= (endMs + 86399999));
    }

    result.sort((a, b) => {
      if (a.task.dueDate && b.task.dueDate) return a.task.dueDate - b.task.dueDate;
      if (a.task.dueDate) return -1;
      if (b.task.dueDate) return 1;
      return a.project.name.localeCompare(b.project.name);
    });

    return result;
  }, [allTasks, filterProject, filterMember, filterStatus, startDate, endDate]);

  // Activity logs filtered for the progress report
  const progressLogs = useMemo(() => {
    let logs = activityLogs.filter(log => log.action === 'updated' && log.details && (log.details.includes('Status') || log.details.includes('Completed')));

    if (filterProject !== 'ALL') {
      logs = logs.filter(log => log.projectId === filterProject);
    }
    if (filterMember !== 'ALL') {
      // Find the task to check assigned member, or use userId
      logs = logs.filter(log => {
        const taskObj = allTasks.find(t => t.task.id === log.taskId);
        return taskObj?.task.assignedTo === filterMember;
      });
    }
    if (startDate) {
      const startMs = new Date(startDate).getTime();
      logs = logs.filter(log => log.timestamp >= startMs);
    }
    if (endDate) {
      const endMs = new Date(endDate).getTime();
      logs = logs.filter(log => log.timestamp <= (endMs + 86399999));
    }

    // Sort newest first
    logs.sort((a, b) => b.timestamp - a.timestamp);
    return logs;
  }, [activityLogs, filterProject, filterMember, startDate, endDate, allTasks]);

  // Progress summary metrics
  const progressSummary = useMemo(() => {
    let completed = 0;
    let otherUpdates = 0;

    progressLogs.forEach(log => {
      if (log.details?.includes('Completed') || log.details?.includes('Status changed to Complete')) {
        completed++;
      } else {
        otherUpdates++;
      }
    });

    // Determine total actual time grouped by task in these logs
    const taskIdsInLogs = new Set(progressLogs.map(l => l.taskId));
    let totalActualTimeInPeriod = 0;
    allTasks.forEach(({ task }) => {
      if (taskIdsInLogs.has(task.id) && task.actualTime) {
        totalActualTimeInPeriod += task.actualTime;
      }
    });

    return { completed, otherUpdates, totalActualTimeInPeriod };
  }, [progressLogs, allTasks]);

  // Current state summary
  const currentSummary = useMemo(() => {
    let totalTasks = filteredTasks.length;
    let completedTasks = 0; let totalEstimated = 0; let totalActual = 0; let overdueTasks = 0;
    const now = Date.now();

    filteredTasks.forEach(({ task }) => {
      if (task.status === 'Complete') completedTasks++;
      if (task.estimatedTime) totalEstimated += task.estimatedTime;
      if (task.actualTime) totalActual += task.actualTime;
      if (task.dueDate && task.dueDate < now && task.status !== 'Complete') overdueTasks++;
    });

    return { totalTasks, completedTasks, totalEstimated, totalActual, overdueTasks };
  }, [filteredTasks]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50">
      <div className="p-6 border-b border-slate-200 bg-white shrink-0">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <BarChart3 className="text-indigo-600" size={24} /> 
            Reporting
          </h2>
          
          <div className="flex bg-slate-100 p-1 rounded-lg">
            <button
              onClick={() => setActiveTab('progress')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold transition-all ${
                activeTab === 'progress' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Activity size={16} /> Progress Report
            </button>
            <button
              onClick={() => setActiveTab('current')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold transition-all ${
                activeTab === 'current' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Target size={16} /> Current State
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-4 items-end">
          <div className="w-48">
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Project</label>
            <select 
              value={filterProject} 
              onChange={e => setFilterProject(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="ALL">All Projects</option>
              {projects.filter(p => !p.isArchived).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="w-40">
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Member</label>
            <select 
              value={filterMember} 
              onChange={e => setFilterMember(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="ALL">All Members</option>
              {(settings.people || []).map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
              <option value="">Unassigned</option>
            </select>
          </div>
          {activeTab === 'current' && (
            <div className="w-40">
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Status</label>
              <select 
                value={filterStatus} 
                onChange={e => setFilterStatus(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="ALL">All Statuses</option>
                {(settings.statuses || []).map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}
          <div className="w-40">
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1"><Calendar size={10}/> {activeTab === 'progress' ? 'From' : 'Due After'}</label>
            <input 
              type="date" 
              value={startDate} 
              onChange={e => setStartDate(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="w-40">
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1"><Calendar size={10}/> {activeTab === 'progress' ? 'To' : 'Due Before'}</label>
            <input 
              type="date" 
              value={endDate} 
              onChange={e => setEndDate(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button 
            onClick={() => {
              setFilterProject('ALL');
              setFilterMember('ALL');
              setFilterStatus('ALL');
              const d = new Date();
              setEndDate(d.toISOString().split('T')[0]);
              d.setDate(d.getDate() - 7);
              setStartDate(d.toISOString().split('T')[0]);
            }}
            className="px-4 py-2 hover:bg-slate-100 rounded-xl text-xs font-bold text-slate-500 transition-colors uppercase tracking-wider"
          >
            Clear Filters
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        
        {activeTab === 'progress' ? (
          <>
            {/* Progress Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 shadow-sm">
                <div className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-1">Tasks Completed</div>
                <div className="text-3xl font-black text-emerald-900">{progressSummary.completed}</div>
              </div>
              <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 shadow-sm">
                <div className="text-[10px] font-black text-indigo-600 uppercase tracking-widest mb-1">Other Status Moves</div>
                <div className="text-3xl font-black text-indigo-900">{progressSummary.otherUpdates}</div>
              </div>
              <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 shadow-sm">
                <div className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-1">Total Actual Time Logged (for touched tasks)</div>
                <div className="text-3xl font-black text-amber-900">{progressSummary.totalActualTimeInPeriod.toFixed(1)} <span className="text-sm font-bold text-amber-500">units</span></div>
              </div>
            </div>

            {/* Progress Table */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    <th className="p-4">Date/Time</th>
                    <th className="p-4">Task Name</th>
                    <th className="p-4">Project</th>
                    <th className="p-4">Change</th>
                    <th className="p-4">Assignee</th>
                  </tr>
                </thead>
                <tbody>
                  {progressLogs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-12 text-center text-slate-400 font-medium">
                        No progress logged matching your criteria.
                      </td>
                    </tr>
                  ) : (
                    progressLogs.map(log => {
                      const taskObj = allTasks.find(t => t.task.id === log.taskId);
                      const projectName = projects.find(p => p.id === log.projectId)?.name || 'Unknown Project';
                      return (
                        <tr 
                          key={log.id} 
                          className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors group"
                          onClick={() => onTaskClick?.(log.projectId, log.taskId)}
                        >
                          <td className="p-4 text-sm font-medium text-slate-500 whitespace-nowrap">
                            {new Date(log.timestamp).toLocaleString()}
                          </td>
                          <td className="p-4">
                            <div className="font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                              {log.taskName}
                            </div>
                            {taskObj?.task.displayId && <div className="text-[10px] text-slate-400 mt-0.5">{taskObj.task.displayId}</div>}
                          </td>
                          <td className="p-4 text-sm font-medium text-slate-600">{projectName}</td>
                          <td className="p-4">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                              <Activity size={12} />
                              {log.details || 'Status updated'}
                            </span>
                          </td>
                          <td className="p-4 text-sm font-medium text-slate-700">{taskObj?.task.assignedTo || <span className="text-slate-400">Unassigned</span>}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            {/* Current Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Tasks</div>
                <div className="text-3xl font-black text-slate-900">{currentSummary.totalTasks}</div>
              </div>
              <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 shadow-sm">
                <div className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-1">Completed</div>
                <div className="text-3xl font-black text-emerald-900">{currentSummary.completedTasks}</div>
              </div>
              <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4 shadow-sm">
                <div className="text-[10px] font-black text-rose-600 uppercase tracking-widest mb-1">Overdue</div>
                <div className="text-3xl font-black text-rose-900">{currentSummary.overdueTasks}</div>
              </div>
              <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 shadow-sm">
                <div className="text-[10px] font-black text-indigo-600 uppercase tracking-widest mb-1">Est. Time</div>
                <div className="text-3xl font-black text-indigo-900">{currentSummary.totalEstimated.toFixed(1)} <span className="text-sm font-bold text-indigo-500 line-clamp-1">units</span></div>
              </div>
              <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 shadow-sm">
                <div className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-1">Actual Time</div>
                <div className="text-3xl font-black text-amber-900">{currentSummary.totalActual.toFixed(1)} <span className="text-sm font-bold text-amber-500 line-clamp-1">units</span></div>
              </div>
            </div>

            {/* Current Data Table */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    <th className="p-4">Task Name</th>
                    <th className="p-4">Project</th>
                    <th className="p-4">Status</th>
                    <th className="p-4">Assignee</th>
                    <th className="p-4">Due Date</th>
                    <th className="p-4 text-right">Est. Time</th>
                    <th className="p-4 text-right">Actual</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTasks.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-12 text-center text-slate-400 font-medium">
                        No tasks found matching your criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredTasks.map(({ task, project }) => (
                      <tr 
                        key={`${project.id}-${task.id}`} 
                        className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors group"
                        onClick={() => onTaskClick?.(project.id, task.id)}
                      >
                        <td className="p-4">
                          <div className="font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                            {task.name}
                          </div>
                          {task.displayId && <div className="text-[10px] text-slate-400 mt-0.5">{task.displayId}</div>}
                        </td>
                        <td className="p-4 text-sm font-medium text-slate-600">{project.name}</td>
                        <td className="p-4">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                            task.status === 'Complete' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 
                            task.status === 'Not started' ? 'bg-slate-100 text-slate-600 border-slate-200' : 
                            'bg-indigo-50 text-indigo-700 border-indigo-200'
                          }`}>
                            {task.status === 'Complete' ? <CheckCircle2 size={12} /> : task.status === 'Not started' ? <Circle size={12} /> : <AlertCircle size={12} />}
                            {task.status}
                          </span>
                        </td>
                        <td className="p-4 text-sm font-medium text-slate-700">{task.assignedTo || <span className="text-slate-400">Unassigned</span>}</td>
                        <td className="p-4 text-sm font-medium text-slate-600">
                          {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : '-'}
                        </td>
                        <td className="p-4 text-right text-sm font-medium text-slate-600">{task.estimatedTime || '-'}</td>
                        <td className="p-4 text-right text-sm font-medium text-slate-600">{task.actualTime || '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

      </div>
    </div>
  );
};

