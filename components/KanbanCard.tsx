import React, { useState } from 'react';
import { User, AlertTriangle, Clock, Calendar, Trash2, Mail, Loader2, Check, Video, Mic } from 'lucide-react';
import { Subtask, AppSettings } from '../types';
import { getStatusBorderColor } from '../constants';
import { sendTaskEmail } from '../lib/emailUtils';
import { isTaskOverdue } from '../lib/portfolioPresentation';

interface KanbanCardProps {
  task: Subtask;
  milestoneName: string;
  projectName: string;
  projectId: string;
  milestoneId: string;
  subtaskIndex: number;
  settings: AppSettings;
  projectTimeUnit: string;
  onClick?: () => void;
  onDelete?: () => void;
}

export const KanbanCard: React.FC<KanbanCardProps> = ({ 
  task, 
  milestoneName, 
  projectName, 
  projectId,
  milestoneId,
  subtaskIndex,
  settings,
  projectTimeUnit,
  onClick,
  onDelete
}) => {
  const [isSending, setIsSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/json', JSON.stringify({ 
      projectId, 
      milestoneId, 
      subtaskIndex 
    }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm("Are you sure you want to delete this task?")) {
      onDelete?.();
    }
  };

  const handleSendEmail = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isSending || sendSuccess) return;
    
    if (task.assignedTo && settings.teamMemberDetails?.[task.assignedTo]?.email) {
      setIsSending(true);
      try {
        await sendTaskEmail(
          settings.teamMemberDetails[task.assignedTo].email!,
          {
            name: task.name,
            displayId: task.displayId,
            description: task.description,
            notes: task.notes,
            status: task.status,
            dueDate: task.dueDate ? formatDate(task.dueDate) : undefined
          },
          projectName,
          milestoneName
        );
        setSendSuccess(true);
        setTimeout(() => setSendSuccess(false), 3000);
      } catch (err) {
        console.error("Failed to send email", err);
        alert("Failed to send email");
      } finally {
        setIsSending(false);
      }
    }
  };


  const isOverdue = isTaskOverdue(task);
  
  const formatDate = (date: Date | number | undefined) => {
    if (!date) return 'N/A';
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = String(d.getFullYear()).slice(-2);
    return settings.dateFormat === 'DD/MM/YY' ? `${day}/${month}/${year}` : `${month}/${day}/${year}`;
  };

  const dueDateString = task.dueDate 
    ? formatDate(task.dueDate)
    : null;

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onClick={onClick}
      className={`bg-white p-2 md:p-3 rounded-md md:rounded-lg shadow-sm border-l-2 md:border-l-4 hover:shadow-md transition-all cursor-pointer active:cursor-grabbing mb-1.5 md:mb-2 group animate-in fade-in duration-300 relative select-none ${task.isImportant ? 'ring-1 md:ring-2 ring-amber-100' : ''}`}
      style={{ borderLeftColor: getStatusBorderColor(task.status) }}
    >
      <div className="flex justify-between items-start mb-0.5 md:mb-1">
        {/* Milestone Name - Truncate heavily on mobile */}
        <div className="text-[8px] md:text-[10px] text-slate-400 font-bold uppercase tracking-wider truncate flex-1 pr-4" title={`${projectName} • ${milestoneName}`}>
          {milestoneName}
        </div>
        
        {/* Delete Button (Visible on Hover) - Hidden on mobile unless active/touched? keeping standard logic */}
        <button 
          onClick={handleDelete}
          className="absolute top-1 right-1 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-red-50 rounded hidden md:block"
          title="Delete Task"
        >
          <Trash2 size={12} />
        </button>
      </div>

      <div className="flex items-center gap-1.5 mb-1 md:mb-1.5">
        {task.displayId && (
          <span className="text-[8px] md:text-[10px] font-black text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 uppercase tracking-tighter shrink-0">
            {task.displayId}
          </span>
        )}
        {task.isImportant && (
          <AlertTriangle size={10} className="text-amber-500 fill-amber-100 shrink-0" title="Important" />
        )}
        {task.isToday && (
          <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-indigo-100 border border-indigo-200 text-indigo-600 text-[8px] md:text-[9px] font-black uppercase tracking-widest shrink-0" title="Today">
            <Calendar size={8} /> TODAY
          </span>
        )}
        {task.recordingUrl && (
          <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-600 shrink-0" title="Recording Attached">
            {task.recordingType === 'video' ? <Video size={8} /> : <Mic size={8} />}
          </span>
        )}
      </div>
      
      {/* Task Name - Smaller on mobile */}
      <div className="text-[10px] md:text-sm font-bold text-slate-800 mb-1.5 md:mb-2 line-clamp-3 leading-tight pr-0 md:pr-4 break-words">
        {task.name}
      </div>
      
      <div className="flex flex-col md:flex-row md:items-center justify-between mt-auto gap-1 md:gap-2">
        {/* Assignee */}
        <div className={`flex items-center gap-1 text-[9px] md:text-xs px-1.5 py-0.5 rounded-full border max-w-full md:max-w-[150px] self-start md:self-auto ${task.role && !task.assignedTo ? 'text-amber-600 bg-amber-50 border-amber-200' : 'text-slate-500 bg-slate-50 border-slate-100'}`} title={task.role ? `Role: ${task.role}${task.assignedTo ? ` | Assigned: ${task.assignedTo}` : ''}` : `Assigned: ${task.assignedTo || 'Unassigned'}`}>
          <User size={8} className={`${task.role && !task.assignedTo ? 'text-amber-500' : 'text-slate-400'} md:w-[10px] md:h-[10px]`} />
          <span className="truncate">
            {task.role ? `[${task.role}] ` : ''}{task.assignedTo || (task.role ? '' : 'Unassigned')}
          </span>
        </div>

        {/* Email Button - Conditionally rendered if assignee has email */} 
        {task.assignedTo && settings.teamMemberDetails?.[task.assignedTo]?.email && (
          <button 
            type="button"
            onClick={handleSendEmail}
            disabled={isSending || sendSuccess}
            className={`flex items-center gap-1 text-[9px] md:text-xs transition-colors ${sendSuccess ? 'text-green-600' : isSending ? 'text-slate-400' : 'text-blue-500 hover:text-blue-700'}`}
            title="Send Task via Email"
          >
            {isSending ? (
              <Loader2 size={10} className="md:w-[12px] md:h-[12px] animate-spin" />
            ) : sendSuccess ? (
              <Check size={10} className="md:w-[12px] md:h-[12px]" />
            ) : (
              <Mail size={10} className="md:w-[12px] md:h-[12px]" />
            )}
            <span>{sendSuccess ? 'Sent' : 'Email'}</span>
          </button>
        )}

        {/* Meta Info Row */}
        <div className="flex items-center gap-1 flex-wrap">
            {(task.estimatedTime && task.estimatedTime > 0) && (
                <div className="flex items-center gap-0.5 text-[8px] md:text-[10px] font-bold text-slate-400 bg-slate-50 px-1 py-0.5 rounded border border-slate-100 hidden md:flex" title={`Est: ${task.estimatedTime} ${projectTimeUnit}`}>
                    <Clock size={8} className="md:w-[10px] md:h-[10px]" />
                    <span>{task.estimatedTime}{projectTimeUnit?.[0] || 'd'}</span>
                </div>
            )}
            
            {dueDateString && (
                <div className={`flex items-center gap-0.5 text-[8px] md:text-[10px] font-bold px-1 py-0.5 rounded border ${isOverdue ? 'bg-red-50 text-red-600 border-red-100' : 'bg-slate-50 text-slate-400 border-slate-100'}`} title={isOverdue ? "Overdue" : "Due Date"}>
                    <Calendar size={8} className="md:w-[10px] md:h-[10px]" />
                    <span>{dueDateString}</span>
                </div>
            )}
        </div>
      </div>
    </div>
  );
};
