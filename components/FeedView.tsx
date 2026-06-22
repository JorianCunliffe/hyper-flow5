import React, { useState } from 'react';
import { ActivityLog, Project, AppSettings, TeamMemberDetails } from '../types';
import { Activity, Clock } from 'lucide-react';

interface FeedViewProps {
  activityLogs: ActivityLog[];
  projects: Project[];
  currentUser: any;
  settings: AppSettings;
  onTaskClick?: (projectId: string, taskId: string) => void;
}

export const FeedView: React.FC<FeedViewProps> = ({ activityLogs, projects, currentUser, settings, onTaskClick }) => {
  const [filterMyAssigned, setFilterMyAssigned] = useState(false);
  const [filterRACI, setFilterRACI] = useState({
    responsible: false,
    accountable: false,
    consulted: false,
    informed: false,
  });

  const getProjectName = (projectId: string) => {
    return projects.find(p => p.id === projectId)?.name || 'Unknown Project';
  };

  const isMe = (nameStr?: string) => {
    if (!nameStr) return false;
    const n = nameStr.toLowerCase();
    const emailStr = (currentUser?.email || currentUser?.uid || '').toLowerCase();
    const displayNameStr = (currentUser?.displayName || '').toLowerCase();
    
    if (emailStr && n === emailStr) return true;
    if (displayNameStr && n === displayNameStr) return true;
    
    // Fuzzy matching
    if (emailStr && emailStr.includes(n.split(' ')[0])) return true;
    if (displayNameStr && displayNameStr.includes(n.split(' ')[0])) return true;

    return false;
  };

  const getPersonName = (emailOrName: string) => {
    if (!emailOrName) return 'Unknown User';
    
    // If it's the current user's email, try to use their displayName
    if (currentUser?.email && emailOrName.toLowerCase() === currentUser.email.toLowerCase() && currentUser.displayName) {
      return currentUser.displayName;
    }
    
    // Try to find a team member matching the email
    if (settings?.teamMemberDetails) {
      for (const [name, detailsData] of Object.entries(settings.teamMemberDetails)) {
        const details = detailsData as TeamMemberDetails;
        if (details.email && details.email.toLowerCase() === emailOrName.toLowerCase()) {
          return name;
        }
      }
    }
    
    // If it's an email format, returning the username part
    if (emailOrName.includes('@')) {
      return emailOrName.split('@')[0];
    }
    
    return emailOrName;
  };

  const filteredLogs = activityLogs.filter(log => {
    if (!filterMyAssigned && !filterRACI.responsible && !filterRACI.accountable && !filterRACI.consulted && !filterRACI.informed) {
      return true; // No filters active
    }

    const raci = log.raci || {};
    const me = currentUser?.email || currentUser?.uid;

    if (filterMyAssigned && log.userId === me) return true;
    if (filterRACI.responsible && isMe(raci.responsible)) return true;
    if (filterRACI.accountable && isMe(raci.accountable)) return true;
    if (filterRACI.consulted && [].concat(raci.consulted || []).some(isMe)) return true;
    if (filterRACI.informed && [].concat(raci.informed || []).some(isMe)) return true;

    return false;
  });

  return (
    <div className="p-8 max-w-4xl mx-auto flex-1 overflow-y-auto">
      <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <Activity className="text-indigo-600" /> Activity Feed
      </h2>

      <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 mb-6 font-medium text-sm text-slate-700">
        <h3 className="mb-3 text-slate-900 font-bold">Filters</h3>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={filterMyAssigned} onChange={e => setFilterMyAssigned(e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500" />
            Actions by Me
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={filterRACI.responsible} onChange={e => setFilterRACI({...filterRACI, responsible: e.target.checked})} className="rounded text-indigo-600 focus:ring-indigo-500" />
            Responsible
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={filterRACI.accountable} onChange={e => setFilterRACI({...filterRACI, accountable: e.target.checked})} className="rounded text-indigo-600 focus:ring-indigo-500" />
            Accountable
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={filterRACI.consulted} onChange={e => setFilterRACI({...filterRACI, consulted: e.target.checked})} className="rounded text-indigo-600 focus:ring-indigo-500" />
            Consulted
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={filterRACI.informed} onChange={e => setFilterRACI({...filterRACI, informed: e.target.checked})} className="rounded text-indigo-600 focus:ring-indigo-500" />
            Informed
          </label>
        </div>
      </div>

      <div className="space-y-4">
        {[...filteredLogs].sort((a,b) => b.timestamp - a.timestamp).map(log => (
          <div key={log.id} className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 flex gap-4 items-start">
            <div className="bg-slate-100 p-2 rounded-full shrink-0">
              <Clock size={20} className="text-slate-500" />
            </div>
            <div className="flex-1">
              <div 
                className="text-sm font-semibold text-slate-900 cursor-pointer hover:text-indigo-600 transition-colors"
                onClick={() => onTaskClick?.(log.projectId, log.taskId)}
              >
                {getPersonName(log.userId)} {log.action} task "{log.taskName}"
              </div>
              <div className="text-xs text-slate-500 mb-1">
                in <span className="font-medium text-slate-700">{getProjectName(log.projectId)}</span>
              </div>
              {log.details && (
                <div className="text-sm text-slate-600 bg-slate-50 p-2 rounded mt-2 border border-slate-100">
                  {log.details}
                </div>
              )}
              <div className="text-xs text-slate-400 mt-2">
                {new Date(log.timestamp).toLocaleString()}
              </div>
            </div>
          </div>
        ))}
        {filteredLogs.length === 0 && (
          <div className="text-center py-12 text-slate-500 border border-dashed border-slate-300 rounded-lg">
            No activity found matching your filters.
          </div>
        )}
      </div>
    </div>
  );
};
