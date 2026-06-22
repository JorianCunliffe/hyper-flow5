import React from 'react';
import { Activity, Calendar, Wand2 } from 'lucide-react';
import { AppSettings } from '../types';
import { getStatusBorderColor } from '../constants';

interface ProjectSidebarProps {
  stats: {
    totalTasks: number;
    completedTasks: number;
    totalEstimatedDays: number;
    totalEstimatedInUnit: number;
    bufferUsedInUnit: number;
    finishDate: Date;
    statusCount: Record<string, number>;
  } | null;
  settings: AppSettings;
  formatDate: (date: Date | number) => string;
  projectTimeUnit: string;
  projectTimeBuffer: number;
}

export const ProjectSidebar: React.FC<ProjectSidebarProps> = ({ stats, settings, formatDate, projectTimeUnit, projectTimeBuffer }) => {
  if (!stats) return null;
  
  const bufferRemaining = projectTimeBuffer - stats.bufferUsedInUnit;
  // If buffer usage exceeds the allocated buffer, remaining is negative.
  const bufferColor = bufferRemaining < 0 ? 'text-rose-600' : 'text-emerald-600';
  const bufferBg = bufferRemaining < 0 ? 'bg-rose-50 border-rose-100' : 'bg-emerald-50 border-emerald-100';
  
  return (
    <div className="hidden lg:flex w-80 bg-white border-l border-slate-200 shrink-0 flex-col z-30 shadow-xl shadow-slate-200/50 print:hidden">
        <div className="p-6 border-b border-slate-100">
        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-widest flex items-center gap-2">
          <Activity size={16} className="text-indigo-600" /> Project Intelligence
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto p-6 space-y-8">
          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 space-y-3">
            <div className="flex items-center gap-2 text-slate-800 font-bold text-xs uppercase tracking-wider mb-2">
              <Calendar size={14} className="text-indigo-600" /> Timeline Summary
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">Est. Duration</span>
                <span className="text-sm font-black text-slate-900 capitalize">{stats.totalEstimatedInUnit} {projectTimeUnit}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">Target Finish</span>
                <span className="text-sm font-black text-slate-900">{formatDate(stats.finishDate)}</span>
              </div>
            </div>
          </div>

          <div className={`rounded-2xl p-4 border space-y-3 ${bufferBg}`}>
            <div className={`flex items-center gap-2 ${bufferColor} font-bold text-xs uppercase tracking-wider mb-2`}>
              <Activity size={14} /> Time Buffer
            </div>
            <div className="grid grid-cols-3 gap-2">
               <div className="flex flex-col">
                 <span className="text-[9px] font-black opacity-60 uppercase tracking-tighter">Allocated</span>
                 <span className="text-sm font-black capitalize">{projectTimeBuffer} {projectTimeUnit?.[0] || 'd'}</span>
               </div>
               <div className="flex flex-col">
                 <span className="text-[9px] font-black opacity-60 uppercase tracking-tighter">Used</span>
                 <span className="text-sm font-black capitalize">{stats.bufferUsedInUnit} {projectTimeUnit?.[0] || 'd'}</span>
               </div>
               <div className="flex flex-col">
                 <span className="text-[9px] font-black opacity-60 uppercase tracking-tighter">Remaining</span>
                 <span className="text-sm font-black capitalize">{bufferRemaining} {projectTimeUnit?.[0] || 'd'}</span>
               </div>
            </div>
          </div>

          <div>
            <div className="flex justify-between items-end mb-2">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Overall Progress</span>
              <span className="text-lg font-black text-slate-900">{Math.round((stats.completedTasks / (stats.totalTasks || 1)) * 100)}%</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden shadow-inner">
              <div 
                className="bg-gradient-to-r from-indigo-500 to-emerald-500 h-full transition-all duration-1000"
                style={{ width: `${(stats.completedTasks / (stats.totalTasks || 1)) * 100}%` }}
              />
            </div>
            <p className="text-[10px] text-slate-400 mt-2 font-medium">{stats.completedTasks} of {stats.totalTasks} tasks finished</p>
          </div>

          <div className="space-y-4">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Breakdown</span>
            {(settings.statuses || []).map(status => {
              const count = stats.statusCount[status] || 0;
              const pct = (count / (stats.totalTasks || 1)) * 100;
              return (
                <div key={status} className="space-y-1">
                  <div className="flex justify-between text-xs font-semibold text-slate-700">
                    <span className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getStatusBorderColor(status) }} />
                      {status}
                    </span>
                    <span>{count}</span>
                  </div>
                  <div className="w-full bg-slate-50 h-1.5 rounded-full">
                    <div 
                      className="h-full rounded-full opacity-60" 
                      style={{ width: `${pct}%`, backgroundColor: getStatusBorderColor(status) }} 
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-indigo-50 rounded-2xl p-4 border border-indigo-100">
            <h4 className="text-[10px] font-bold text-indigo-700 uppercase tracking-widest mb-2 flex items-center gap-1">
              <Wand2 size={12} /> AI Insights
            </h4>
            <p className="text-xs text-indigo-900 leading-relaxed font-medium">
              {stats.completedTasks === 0 
                ? "Project baseline established. AI suggests focusing on the initial conceptual milestones."
                : `The project is currently tracking towards ${formatDate(stats.finishDate)}. Ensure estimated days for future milestones are updated for accurate forecasting.`}
            </p>
          </div>
      </div>
    </div>
  );
};