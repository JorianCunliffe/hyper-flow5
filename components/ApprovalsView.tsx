import React, { useState } from 'react';
import { Project, Subtask, AppSettings, HumanAsk, Milestone } from '../types';
import { AlertCircle, CheckCircle, Clock, FileText, RotateCcw } from 'lucide-react';
import { isOverdue } from '../lib/humanAsk';

export interface OpenAskEntry {
  project: Project;
  node: Milestone;
  ask: HumanAsk;
}

interface ApprovalsViewProps {
  projects: Project[];
  currentUser: any;
  settings: AppSettings;
  onEditTask: (projectId: string, milestoneId: string, subtaskIndex: number) => void;
  openAsks: OpenAskEntry[];
  onReviewAsk: (projectId: string, nodeId: string, askId: string) => void;
}

export const ApprovalsView: React.FC<ApprovalsViewProps> = ({
  projects, currentUser, settings, onEditTask, openAsks, onReviewAsk
}) => {
  const [filterMode, setFilterMode] = useState<'me' | 'all'>('me');

  const isMe = (nameStr?: string) => {
    if (!nameStr) return false;
    const n = nameStr.toLowerCase();
    const emailStr = (currentUser?.email || currentUser?.uid || '').toLowerCase();
    const displayNameStr = (currentUser?.displayName || '').toLowerCase();

    if (emailStr && n === emailStr) return true;
    if (displayNameStr && n === displayNameStr) return true;

    // Fuzzy matching for typed names vs emails
    if (emailStr && emailStr.includes(n.split(' ')[0])) return true;
    if (displayNameStr && displayNameStr.includes(n.split(' ')[0])) return true;

    return false;
  };

  const visibleAsks = openAsks.filter(
    entry => filterMode === 'all' || entry.ask.assignees.length === 0 || entry.ask.assignees.some(isMe)
  );

  const tasksPendingApproval: { p: Project, m: any, s: Subtask, sIdx: number }[] = [];

  projects.forEach(p => {
    if (p.isArchived) return;
    p.milestones.forEach(m => {
      m.subtasks.forEach((s, sIdx) => {
        // Show tasks where approval is required or pending.
        if (s.accountable && s.approvalStatus !== 'approved' && (s.status === 'Completed' || s.status === 'Submitted')) {
          if (filterMode === 'me' && !isMe(s.accountable)) return;
          tasksPendingApproval.push({ p, m, s, sIdx });
        }
      });
    });
  });

  const relative = (ts: number) => {
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 60) return `${Math.max(mins, 1)}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  };

  const isEmpty = visibleAsks.length === 0 && tasksPendingApproval.length === 0;

  return (
    <div className="p-8 max-w-4xl mx-auto flex-1 overflow-y-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <CheckCircle className="text-emerald-600" /> Pending Approvals
        </h2>

        <div className="flex bg-slate-100 p-1 rounded-lg">
          <button
            className={`px-4 py-1.5 rounded-md text-sm font-bold transition-colors ${filterMode === 'me' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
            onClick={() => setFilterMode('me')}
          >
            Assigned to Me
          </button>
          <button
            className={`px-4 py-1.5 rounded-md text-sm font-bold transition-colors ${filterMode === 'all' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
            onClick={() => setFilterMode('all')}
          >
            All Pending
          </button>
        </div>
      </div>

      {/* Flow review gates — work an agent produced that is waiting on a person */}
      {visibleAsks.length > 0 && (
        <div className="mb-8">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
            Awaiting your review ({visibleAsks.length})
          </div>
          <div className="space-y-4">
            {visibleAsks.map(({ project, node, ask }) => {
              const overdue = isOverdue(ask);
              return (
                <div
                  key={ask.id}
                  onClick={() => onReviewAsk(project.id, node.id, ask.id)}
                  className={`bg-white p-4 rounded-lg shadow-sm border flex gap-4 items-center cursor-pointer transition-all group ${overdue ? 'border-rose-200 hover:border-rose-400' : 'border-slate-200 hover:border-indigo-400'} hover:shadow`}
                >
                  <div className={`p-2 rounded-full shrink-0 transition-colors ${overdue ? 'bg-rose-100 text-rose-600' : 'bg-indigo-100 text-indigo-600'}`}>
                    <FileText size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-slate-900">{node.name}</span>
                      <span className="text-[10px] font-black uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                        {ask.kind}
                      </span>
                      {(ask.revision ?? 0) > 0 && (
                        <span className="text-[10px] font-black uppercase px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 flex items-center gap-1">
                          <RotateCcw size={9} /> rev {ask.revision}
                        </span>
                      )}
                      {overdue && (
                        <span className="text-[10px] font-black uppercase px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 flex items-center gap-1">
                          <Clock size={9} /> overdue
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mb-1 truncate">
                      Project: <span className="font-medium text-slate-700">{project.name}</span>
                    </div>
                    <div className="text-xs text-slate-400 truncate">{ask.prompt}</div>
                    <div className="text-[11px] text-slate-400 mt-1">
                      Asked {relative(ask.createdAt)}
                      {ask.assignees.length > 0 && ` · ${ask.assignees.join(', ')}`}
                    </div>
                  </div>
                  <div className="px-4 py-2 bg-indigo-50 text-indigo-700 rounded text-sm font-bold opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    Review
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Legacy per-subtask approvals */}
      {tasksPendingApproval.length > 0 && (
        <div>
          {visibleAsks.length > 0 && (
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
              Task sign-offs ({tasksPendingApproval.length})
            </div>
          )}
          <div className="space-y-4">
            {tasksPendingApproval.map(({ p, m, s, sIdx }) => (
              <div key={s.id} onClick={() => onEditTask(p.id, m.id, sIdx)} className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 flex gap-4 items-center cursor-pointer hover:border-indigo-400 hover:shadow transition-all group">
                <div className="bg-amber-100 p-2 rounded-full shrink-0 group-hover:bg-amber-200 transition-colors text-amber-600">
                  <AlertCircle size={20} />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-slate-900">
                    {s.name}
                  </div>
                  <div className="text-xs text-slate-500 mb-1">
                    Project: <span className="font-medium text-slate-700">{p.name}</span> | Milestone: <span className="font-medium text-slate-700">{m.name}</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                    <span>Assigned to: {s.assignedTo || 'Unassigned'}</span>
                    {s.completedAt && <span>• Completed: {new Date(s.completedAt).toLocaleDateString()}</span>}
                  </div>
                </div>
                <div className="px-4 py-2 bg-indigo-50 text-indigo-700 rounded text-sm font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                  Review
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {isEmpty && (
        <div className="text-center py-12 text-slate-500 border border-dashed border-slate-300 rounded-lg">
          You have no tasks pending approval.
        </div>
      )}
    </div>
  );
};
