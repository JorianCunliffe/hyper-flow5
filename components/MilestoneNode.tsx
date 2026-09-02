import React, { useState, useEffect, useRef } from 'react';
import { Milestone, AppSettings, Subtask, NodeType } from '../types';
import { MilestonePieChart } from './PieChart';
import { Plus, ChevronRight, ChevronLeft, User, Edit2, Wand2, Clock, CalendarCheck, Trash2, ExternalLink, Link as LinkIcon, Move, X, ArrowRight, ArrowLeft, AlertTriangle, Calendar, Mail, Loader2, Check, Settings2, Play } from 'lucide-react';
import { getStatusBorderColor, NODE_TYPE_META } from '../constants';
import { getNodeType, isActionNode, isNodeComplete } from '../lib/flowEngine';
import { sendTaskEmail } from '../lib/emailUtils';
import { actionRunStatusLabel } from '../lib/actionRunPresentation';
import { isTaskComplete } from '../lib/taskStatus';

const TaskEmailButton: React.FC<{
  task: Subtask,
  settings: AppSettings,
  projectName: string,
  milestoneName: string,
  formatDate: (d: Date | number | undefined) => string
}> = ({ task, settings, projectName, milestoneName, formatDate }) => {
  const [isSending, setIsSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);

  if (!task.assignedTo || !settings.teamMemberDetails?.[task.assignedTo]?.email) return null;

  const handleSendEmail = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isSending || sendSuccess) return;
    
    setIsSending(true);
    try {
      await sendTaskEmail(
        settings.teamMemberDetails![task.assignedTo].email!,
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
  };

  return (
    <button 
      type="button"
      onClick={handleSendEmail}
      disabled={isSending || sendSuccess}
      className={`flex items-center gap-1 text-[9px] transition-colors ${sendSuccess ? 'text-green-600' : isSending ? 'text-slate-400' : 'text-blue-500 hover:text-blue-700'}`}
      title="Send Task via Email"
    >
      {isSending ? (
        <Loader2 size={10} className="animate-spin" />
      ) : sendSuccess ? (
        <Check size={10} />
      ) : (
        <Mail size={10} />
      )}
      <span>{sendSuccess ? 'Sent' : 'Email'}</span>
    </button>
  );
};

interface MilestoneNodeProps {
  milestone: Milestone;
  showSubtasks: boolean;
  onAddSubtask: (milestoneId: string) => void;
  onAddSequence: (milestoneId: string) => void;
  onAddPrevious: (milestoneId: string) => void;
  onAddParallel: (milestoneId: string) => void;
  onEditSubtask: (milestoneId: string, subtaskIndex: number) => void;
  onUpdateName: (milestoneId: string, newName: string) => void;
  onDeleteMilestone: (milestoneId: string) => void;
  onMove: (id: string, x: number, y: number, withSubtree: boolean) => void;
  onBrainstorm: (milestoneId: string) => void;
  onHover: (milestoneId: string | null) => void;
  
  // Linking props
  onStartLinking: (milestoneId: string) => void;
  onCompleteLinking: (milestoneId: string) => void;
  onRemoveLink: (otherId: string, type: 'parent' | 'child') => void;

  // Flow node system
  onOpenConfig: (milestoneId: string) => void;
  onRunAction: (milestoneId: string) => void;
  isRunningAction: boolean;
  parents: { id: string, name: string }[];
  children: { id: string, name: string }[];
  isLinkingMode: boolean;
  isSource: boolean;

  targetDate?: Date;
  dateFormat: 'DD/MM/YY' | 'MM/DD/YY';
  onClick: () => void;
  settings: AppSettings;
  projectName: string;
  projectData?: Record<string, any>;
  projectTimeUnit: string;
  duration: number;
}

export const MilestoneNode: React.FC<MilestoneNodeProps> = ({
  milestone,
  showSubtasks,
  onAddSubtask,
  onAddSequence,
  onAddPrevious,
  onAddParallel,
  onEditSubtask,
  onUpdateName,
  onDeleteMilestone,
  onMove,
  onBrainstorm,
  onHover,
  onStartLinking,
  onCompleteLinking,
  onRemoveLink,
  onOpenConfig,
  onRunAction,
  isRunningAction,
  parents,
  children,
  isLinkingMode,
  isSource,
  targetDate,
  dateFormat,
  onClick,
  settings,
  projectName,
  projectData,
  projectTimeUnit,
  duration
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [tempName, setTempName] = useState(milestone.name);
  const [isThinking, setIsThinking] = useState(false);
  const [showLinkMenu, setShowLinkMenu] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const linkMenuRef = useRef<HTMLDivElement>(null);

  // Dragging state
  const [isDragging, setIsDragging] = useState(false);
  const [currentPos, setCurrentPos] = useState({ x: milestone.x || 0, y: milestone.y || 0 });
  const dragStartMouse = useRef({ x: 0, y: 0 });
  const dragStartNode = useRef({ x: 0, y: 0 });

  // Sync prop position changes when not dragging (e.g. auto layout update)
  useEffect(() => {
    if (!isDragging) {
      setCurrentPos({ x: milestone.x || 0, y: milestone.y || 0 });
    }
  }, [milestone.x, milestone.y, isDragging]);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  // Close link menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (linkMenuRef.current && !linkMenuRef.current.contains(event.target as Node)) {
        setShowLinkMenu(false);
      }
    };
    if (showLinkMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showLinkMenu]);

  const formatDate = (date: Date | number | undefined) => {
    if (!date) return 'N/A';
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = String(d.getFullYear()).slice(-2);
    return dateFormat === 'DD/MM/YY' ? `${day}/${month}/${year}` : `${month}/${day}/${year}`;
  };

  const handleBlur = () => {
    setIsEditing(false);
    if (tempName.trim() && tempName !== milestone.name) {
      onUpdateName(milestone.id, tempName);
    } else {
      setTempName(milestone.name);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleBlur();
    if (e.key === 'Escape') {
      setIsEditing(false);
      setTempName(milestone.name);
    }
  };

  const handleBrainstorm = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsThinking(true);
    await onBrainstorm(milestone.id);
    setIsThinking(false);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isLinkingMode || e.button !== 0 || isEditing || showLinkMenu) return;
    
    e.stopPropagation(); // Prevent canvas panning
    
    setIsDragging(true);
    dragStartMouse.current = { x: e.clientX, y: e.clientY };
    dragStartNode.current = { x: currentPos.x, y: currentPos.y };
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartMouse.current.x;
      const dy = e.clientY - dragStartMouse.current.y;
      setCurrentPos({
        x: dragStartNode.current.x + dx,
        y: dragStartNode.current.y + dy
      });
    };

    const handleMouseUp = (e: MouseEvent) => {
      setIsDragging(false);
      const dx = e.clientX - dragStartMouse.current.x;
      const dy = e.clientY - dragStartMouse.current.y;
      
      // If moved more than a few pixels, consider it a drag operation
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        onMove(milestone.id, dragStartNode.current.x + dx, dragStartNode.current.y + dy, e.shiftKey);
      } else {
        // Otherwise treat as click (reset position to snap back if needed, though usually same)
        setCurrentPos({ x: milestone.x || 0, y: milestone.y || 0 });
        if (!isLinkingMode) onClick();
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, milestone.id, onMove, isLinkingMode, onClick, milestone.x, milestone.y]);

  const handleClick = (e: React.MouseEvent) => {
    if (isLinkingMode) {
      e.stopPropagation();
      if (!isSource) {
        onCompleteLinking(milestone.id);
      }
    }
    // Normal click is handled via mouseUp to distinguish from drag
  };

  const subtasks = milestone.subtasks || [];
  const nodeType = getNodeType(milestone);
  const meta = NODE_TYPE_META[nodeType];
  const isMilestoneType = nodeType === NodeType.MILESTONE;
  const isAction = isActionNode(milestone);
  const isComplete = isNodeComplete(milestone, projectData);
  const lastRun = milestone.actionConfig?.lastRun;

  // Status accent for non-milestone nodes
  let statusColor = meta.color;
  if (isAction && lastRun?.status === 'error') statusColor = '#ef4444';
  else if (isComplete) statusColor = '#22c55e';

  const renderNodeBody = () => {
    if (isMilestoneType) return <MilestonePieChart subtasks={subtasks} size={100} />;
    const Icon = meta.icon;
    if (nodeType === NodeType.DECISION) {
      return (
        <div className="w-[100px] h-[100px] flex items-center justify-center">
          <div
            className="w-[68px] h-[68px] rotate-45 rounded-xl flex items-center justify-center shadow-inner"
            style={{ backgroundColor: `${statusColor}18`, border: `3px solid ${statusColor}` }}
          >
            <Icon size={30} className="-rotate-45" style={{ color: statusColor }} />
          </div>
        </div>
      );
    }
    return (
      <div className="w-[100px] h-[100px] rounded-full flex flex-col items-center justify-center gap-1" style={{ backgroundColor: `${statusColor}12`, border: `3px solid ${statusColor}` }}>
        <Icon size={30} style={{ color: statusColor }} className={nodeType === NodeType.LOOP && !milestone.loopConfig?.exited && (milestone.loopConfig?.currentIteration || 0) > 0 ? 'animate-spin [animation-duration:3s]' : ''} />
        {nodeType === NodeType.LOOP && (
          <span className="text-[10px] font-black" style={{ color: statusColor }}>
            {milestone.loopConfig?.exited ? 'DONE' : `${milestone.loopConfig?.currentIteration ?? 0}/${milestone.loopConfig?.maxIterations ?? '?'}`}
          </span>
        )}
        {isAction && lastRun && (
          <span className="text-[9px] font-black uppercase" style={{ color: statusColor }}>
            {actionRunStatusLabel(lastRun, nodeType)}
          </span>
        )}
      </div>
    );
  };

  return (
    <div 
      className={`absolute flex flex-col items-center group z-10 transition-opacity ${isLinkingMode && !isSource ? 'opacity-90 hover:opacity-100' : ''}`}
      style={{ left: currentPos.x, top: currentPos.y, transform: 'translate(-50%, -50%)', cursor: isDragging ? 'grabbing' : 'auto' }}
      onMouseEnter={() => onHover(milestone.id)}
      onMouseLeave={() => onHover(null)}
    >
      <div className="mb-2 h-7 flex flex-col items-center justify-center">
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            className="text-sm font-semibold text-slate-900 bg-white border border-indigo-300 rounded px-2 py-0.5 shadow-sm outline-none focus:ring-2 focus:ring-indigo-500 min-w-[120px]"
            value={tempName}
            onChange={(e) => setTempName(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
        ) : (
          <div 
            onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
            className="flex items-center gap-1.5 cursor-pointer hover:bg-white hover:shadow-sm px-2 py-0.5 rounded-full transition-all group/name"
          >
            <span className="text-sm font-semibold text-slate-700 whitespace-nowrap">
              {milestone.name}
            </span>
            <Edit2 size={10} className="text-slate-400 opacity-0 group-hover/name:opacity-100 transition-opacity" />
          </div>
        )}
      </div>
      
      {/* Wrapper for Circle and Buttons */}
      <div className="relative z-50 group/circle">
        
        {/* The Circle - Draggable Target */}
        <div 
          className={`rounded-full bg-white shadow-xl ring-2 transition-all duration-300 active:scale-95 
            ${isThinking ? 'ring-indigo-400 animate-pulse' : ''}
            ${isLinkingMode && isSource ? 'ring-4 ring-indigo-500 scale-110' : ''}
            ${isLinkingMode && !isSource ? 'ring-slate-100 hover:ring-indigo-400 hover:scale-110' : 'ring-slate-100 group-hover:ring-indigo-300 group-hover:scale-110'}
            ${isDragging ? 'cursor-grabbing scale-105 shadow-2xl ring-indigo-400' : 'cursor-grab'}
          `}
          onMouseDown={handleMouseDown}
          onClick={handleClick}
        >
          {renderNodeBody()}

          {/* Drag Handle Indicator on Hover */}
          {!isLinkingMode && !isDragging && !showLinkMenu && (
            <div className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/5 flex items-center justify-center transition-colors pointer-events-none">
               <Move size={20} className="text-white opacity-0 group-hover:opacity-50" />
            </div>
          )}

          {/* Visual indicator for valid drop target during linking */}
          {isLinkingMode && !isSource && (
            <div className="absolute inset-0 rounded-full bg-indigo-500/10 animate-pulse pointer-events-none" />
          )}
        </div>

        {/* Floating Tooltip for Timeline */}
        {!isLinkingMode && !isDragging && !showLinkMenu && (
          <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover/circle:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none flex flex-col items-center shadow-lg">
            <div className="flex items-center gap-1">
              <Clock size={10} className="text-indigo-400" />
              <span>Target: {formatDate(targetDate)}</span>
            </div>
            {isComplete && milestone.completedAt && (
              <div className="flex items-center gap-1 mt-1 text-emerald-400">
                <CalendarCheck size={10} />
                <span>Actual: {formatDate(milestone.completedAt)}</span>
              </div>
            )}
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-slate-900" />
          </div>
        )}

        {/* Quick Actions Panel - Hide during linking mode and dragging */}
        {!isLinkingMode && !isDragging && (
          <div className={`absolute left-full top-1/2 -translate-y-1/2 pl-3 flex flex-col gap-1.5 transition-all transform duration-300 z-50 ${showLinkMenu ? 'opacity-100 translate-x-1' : 'opacity-0 group-hover/circle:opacity-100 group-hover/circle:translate-x-1'}`}>
            <button
              onClick={(e) => { e.stopPropagation(); onOpenConfig(milestone.id); }}
              className="p-2 bg-slate-700 text-white rounded-full shadow-lg hover:bg-slate-800 active:scale-90 transition-all border border-slate-600"
              title="Configure Node (type, branches, loop, action)"
            >
              <Settings2 size={14} className="pointer-events-none" />
            </button>
            {isAction && (
              <button
                onClick={(e) => { e.stopPropagation(); if (!isRunningAction) onRunAction(milestone.id); }}
                disabled={isRunningAction}
                className="p-2 bg-emerald-600 text-white rounded-full shadow-lg hover:bg-emerald-700 active:scale-90 transition-all border border-emerald-500 disabled:opacity-60"
                title={`Run ${meta.label} Now`}
              >
                {isRunningAction ? <Loader2 size={14} className="animate-spin pointer-events-none" /> : <Play size={14} className="pointer-events-none" />}
              </button>
            )}
            {isMilestoneType && (
            <button
              onClick={handleBrainstorm}
              disabled={isThinking}
              className="p-2 bg-gradient-to-tr from-amber-400 to-amber-500 text-white rounded-full shadow-lg hover:from-amber-500 hover:to-amber-600 active:scale-90 transition-all border border-amber-300/50"
              title="AI Brainstorm Subtasks"
            >
              <Wand2 size={14} className={`pointer-events-none ${isThinking ? 'animate-spin' : ''}`} />
            </button>
            )}
            <button 
              onClick={(e) => { e.stopPropagation(); onAddPrevious(milestone.id); }}
              className="p-2 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 active:scale-90 transition-all border border-blue-500"
              title="Previous Step"
            >
              <ChevronLeft size={14} className="pointer-events-none" />
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); onAddSequence(milestone.id); }}
              className="p-2 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 active:scale-90 transition-all border border-blue-500"
              title="Next Step"
            >
              <ChevronRight size={14} className="pointer-events-none" />
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); onAddParallel(milestone.id); }}
              className="p-2 bg-indigo-600 text-white rounded-full shadow-lg hover:bg-indigo-700 active:scale-90 transition-all border border-indigo-500"
              title="Parallel Step"
            >
              <Plus size={14} className="pointer-events-none" />
            </button>
            <div className="relative">
              <button 
                onClick={(e) => { 
                    e.stopPropagation();
                    setShowLinkMenu(!showLinkMenu);
                }}
                className={`p-2 rounded-full shadow-lg active:scale-90 transition-all border ${showLinkMenu ? 'bg-violet-700 text-white border-violet-800' : 'bg-violet-600 text-white hover:bg-violet-700 border-violet-500'}`}
                title="Manage Links"
              >
                {showLinkMenu ? <X size={14} /> : <LinkIcon size={14} />}
              </button>
              
              {/* Link Management Menu */}
              {showLinkMenu && (
                <div 
                  ref={linkMenuRef}
                  className="absolute left-full top-0 ml-3 bg-white rounded-xl shadow-xl border border-slate-200 p-2 min-w-[200px] z-[100] animate-in slide-in-from-left-2 fade-in duration-200"
                  onMouseDown={(e) => e.stopPropagation()} 
                >
                   <button 
                     onClick={(e) => {
                       e.stopPropagation();
                       setShowLinkMenu(false);
                       onStartLinking(milestone.id);
                     }}
                     className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold text-violet-600 hover:bg-violet-50 rounded-lg transition-colors mb-1"
                   >
                     <Plus size={14} /> Add New Link
                   </button>
                   
                   {(parents.length > 0 || children.length > 0) && <div className="h-px bg-slate-100 my-1" />}
                   
                   {/* Parents (Incoming) */}
                   {parents.length > 0 && (
                     <div className="mb-2">
                       <div className="text-[9px] font-black text-slate-400 uppercase tracking-wider px-2 py-1">Incoming (Parents)</div>
                       {parents.map(p => (
                         <div key={p.id} className="flex items-center justify-between px-2 py-1.5 hover:bg-slate-50 rounded-lg group/item">
                           <div className="flex items-center gap-2 text-xs text-slate-600 truncate max-w-[120px]">
                             <ArrowLeft size={10} className="text-slate-400 shrink-0" />
                             <span className="truncate" title={p.name}>{p.name}</span>
                           </div>
                           <button 
                             onClick={() => onRemoveLink(p.id, 'parent')}
                             className="text-slate-300 hover:text-red-500 transition-colors"
                             title="Remove Link"
                           >
                             <Trash2 size={12} />
                           </button>
                         </div>
                       ))}
                     </div>
                   )}

                   {/* Children (Outgoing) */}
                   {children.length > 0 && (
                     <div>
                       <div className="text-[9px] font-black text-slate-400 uppercase tracking-wider px-2 py-1">Outgoing (Children)</div>
                       {children.map(c => (
                         <div key={c.id} className="flex items-center justify-between px-2 py-1.5 hover:bg-slate-50 rounded-lg group/item">
                           <div className="flex items-center gap-2 text-xs text-slate-600 truncate max-w-[120px]">
                             <ArrowRight size={10} className="text-slate-400 shrink-0" />
                             <span className="truncate" title={c.name}>{c.name}</span>
                           </div>
                           <button 
                             onClick={() => onRemoveLink(c.id, 'child')}
                             className="text-slate-300 hover:text-red-500 transition-colors"
                             title="Remove Link"
                           >
                             <Trash2 size={12} />
                           </button>
                         </div>
                       ))}
                     </div>
                   )}
                </div>
              )}
            </div>

            <button 
              onClick={(e) => { 
                  e.preventDefault();
                  e.stopPropagation(); 
                  onDeleteMilestone(milestone.id); 
              }}
              className="p-2 bg-red-100 text-red-600 rounded-full shadow-lg hover:bg-red-200 active:scale-90 transition-all border border-red-200"
              title="Delete Milestone"
            >
              <Trash2 size={14} className="pointer-events-none" />
            </button>
          </div>
        )}
      </div>

      {!isMilestoneType && !isLinkingMode && !isDragging && (
        <div
          className="mt-2 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest cursor-pointer hover:shadow-sm transition-all"
          style={{ backgroundColor: `${meta.color}18`, color: meta.color }}
          onClick={(e) => { e.stopPropagation(); onOpenConfig(milestone.id); }}
          title={meta.description}
        >
          {meta.label}
        </div>
      )}

      {isMilestoneType && showSubtasks && !isLinkingMode && !isDragging && (
        <div className="mt-4 w-52 bg-white rounded-xl shadow-xl border border-slate-100 p-2 z-10 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between border-b border-slate-50 pb-1.5 px-1 mb-2">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              Tasks ({subtasks.length})
            </div>
            <div className="flex items-center gap-1">
               <span className="w-8 bg-slate-100 rounded text-[9px] font-bold text-slate-600 text-center inline-block py-0.5">
                 {duration}
               </span>
              <span className="text-[9px] font-bold text-slate-400 uppercase">{projectTimeUnit}</span>
            </div>
          </div>
          <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
            {subtasks.map((task, idx) => (
              <div 
                key={task.id} 
                onClick={(e) => { e.stopPropagation(); onEditSubtask(milestone.id, idx); }}
                className={`text-xs p-2 rounded-lg hover:bg-indigo-50 hover:shadow-sm cursor-pointer flex items-center justify-between group/task transition-all ${task.isImportant ? 'bg-amber-50/80' : 'bg-slate-50'}`}
              >
                <div className="flex flex-col flex-1 min-w-0 pr-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {task.displayId && (
                        <span className="text-[8px] font-black text-indigo-600 bg-indigo-50 px-1 rounded border border-indigo-100 shrink-0">
                          {task.displayId}
                        </span>
                      )}
                      <span className="font-semibold truncate text-slate-800">{task.name}</span>
                    </div>
                    {task.link && (
                      <a 
                        href={task.link.startsWith('http') ? task.link : `https://${task.link}`} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="ml-2 p-1 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-all"
                        title="Open Resource Link"
                      >
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-[9px] flex items-center gap-1 ${task.role && !task.assignedTo ? 'text-amber-600 font-bold' : 'text-slate-500'}`} title={task.role ? `Role: ${task.role}${task.assignedTo ? ` | Assigned: ${task.assignedTo}` : ''}` : `Assigned: ${task.assignedTo || 'Unassigned'}`}>
                      <User size={9} className={task.role && !task.assignedTo ? 'text-amber-500' : ''} /> {task.role ? `[${task.role}] ` : ''}{task.assignedTo || (task.role ? '' : 'Unassigned')}
                    </span>
                    {task.dueDate && (
                        <span className="text-[9px] text-slate-400 flex items-center gap-0.5" title="Due Date">
                           <Calendar size={8} />
                        </span>
                    )}
                    {task.isImportant && (
                        <AlertTriangle size={8} className="text-amber-500 fill-amber-500" />
                    )}
                    {/* Email Button - Conditionally rendered if assignee has email */} 
                    <TaskEmailButton 
                      task={task} 
                      settings={settings} 
                      projectName={projectName} 
                      milestoneName={milestone.name} 
                      formatDate={formatDate}
                    />
                  </div>
                  {isTaskComplete(task) && task.completedAt && (
                    <span className="text-[8px] text-emerald-600 font-medium">Done {formatDate(task.completedAt)}</span>
                  )}
                </div>
                <div 
                  className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm border border-white" 
                  style={{ backgroundColor: getStatusBorderColor(task.status) }} 
                />
              </div>
            ))}
            <button 
              onClick={(e) => { e.stopPropagation(); onAddSubtask(milestone.id); }}
              className="mt-1 w-full py-1.5 border border-dashed border-slate-200 rounded-lg text-[10px] text-slate-400 font-bold hover:border-indigo-300 hover:text-indigo-500 transition-colors flex items-center justify-center gap-1"
            >
              <Plus size={10} /> NEW TASK
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
