import React, { useState } from 'react';
import { Mail, Phone, X, Trash2, ExternalLink, Calendar, Clock, AlertTriangle, Loader2, Check } from 'lucide-react';
import { Subtask, AppSettings } from '../../types';
import { sendTaskEmail } from '../../lib/emailUtils';
import { normalizeTaskType } from '../../lib/taskTypes';
import { firebaseService } from '../../services/firebaseService';
import { ScreenRecorder } from '../ScreenRecorder';

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
      // fallback error
    } finally {
      setIsSending(false);
    }
  };

  return (
    <button 
      type="button"
      onClick={handleSendEmail}
      disabled={isSending || sendSuccess}
      className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg border transition-colors ${sendSuccess ? 'text-green-600 bg-green-50 border-green-100' : isSending ? 'text-slate-400 bg-slate-50 border-slate-100' : 'text-blue-600 bg-blue-50 border-blue-100 hover:text-blue-700'}`}
      title="Send Task via Email"
    >
      {isSending ? (
        <Loader2 size={10} className="animate-spin" />
      ) : sendSuccess ? (
        <Check size={10} />
      ) : (
        <Mail size={10} />
      )}
      <span>{sendSuccess ? 'Sent Email' : 'Send Email'}</span>
    </button>
  );
};

interface EditTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: Subtask;
  milestoneName: string;
  projectName: string;
  projectId?: string;
  orgId?: string;
  projectData?: any;
  settings: AppSettings;
  onUpdate: (updates: Partial<Subtask>) => void;
  onDelete: () => void;
  children?: React.ReactNode;
  projectTimeUnit?: string;
}

export const EditTaskModal: React.FC<EditTaskModalProps> = ({ 
  isOpen, onClose, task, milestoneName, projectName, projectId, orgId, projectData, settings, onUpdate, onDelete, children, projectTimeUnit
}) => {
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionOutput, setExecutionOutput] = useState<string | null>(null);

  if (!isOpen || !task) return null;

  // Helper to format timestamp to YYYY-MM-DD for input[type="date"]
  const dateToInput = (ts?: number) => {
    if (!ts) return '';
    return new Date(ts).toISOString().split('T')[0];
  };

  const formatDate = (date: Date | number | undefined) => {
    if (!date) return 'N/A';
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = String(d.getFullYear()).slice(-2);
    return settings.dateFormat === 'DD/MM/YY' ? `${day}/${month}/${year}` : `${month}/${day}/${year}`;
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg p-8 border border-slate-200 animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-start border-b border-slate-100 pb-4 mb-4 shrink-0">
            <div>
              <div className="flex items-center gap-2">
                {task.displayId && (
                  <span className="bg-slate-100 text-slate-500 text-[10px] font-black px-2 py-0.5 rounded border border-slate-200 tracking-tighter">
                    {task.displayId}
                  </span>
                )}
                <h3 className="text-xl font-black text-slate-900">Edit Task</h3>
                {task.isImportant && (
                  <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 border border-amber-200">
                    <AlertTriangle size={10} className="fill-amber-500 text-amber-600" /> IMPORTANT
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 font-medium">In milestone: <span className="text-indigo-600">{milestoneName}</span></p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors"><X size={20} /></button>
        </div>
        
        <div className="space-y-4 overflow-y-auto flex-1 pr-2">
          {/* Name & Priority Toggle */}
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Task Name</label>
              <input 
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-slate-900 font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                value={task.name || ''}
                onChange={(e) => onUpdate({ name: e.target.value })}
              />
            </div>
            <button 
              onClick={() => onUpdate({ isImportant: !task.isImportant })}
              className={`h-[46px] w-[46px] flex items-center justify-center rounded-xl border-2 transition-all ${task.isImportant ? 'bg-amber-50 border-amber-400 text-amber-600' : 'bg-slate-50 border-slate-200 text-slate-300 hover:border-slate-300 hover:text-slate-400'}`}
              title="Toggle Importance"
            >
              <AlertTriangle size={20} className={task.isImportant ? "fill-amber-500" : ""} />
            </button>
          </div>
          
          {/* Main Attributes */}
          <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex justify-between">
                  <span>Assigned To (Responsible)</span>
                </label>
                <select 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-slate-900 font-medium outline-none focus:ring-2 focus:ring-indigo-500"
                  value={task.assignedTo || ''}
                  onChange={(e) => onUpdate({ assignedTo: e.target.value })}
                >
                  <option value="">Unassigned</option>
                  {(settings.people || []).map(person => <option key={person} value={person}>{person}</option>)}
                </select>
                {task.assignedTo && settings.teamMemberDetails?.[task.assignedTo] && (
                  <div className="mt-2 flex flex-wrap gap-3 animate-in fade-in slide-in-from-top-1 duration-200">
                    {settings.teamMemberDetails[task.assignedTo].email && (
                      <div className="flex items-center gap-2 mt-2">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 bg-slate-50 px-2 py-1 rounded-lg border border-slate-100">
                          <Mail size={10} className="text-indigo-500" />
                          {settings.teamMemberDetails[task.assignedTo].email}
                        </div>
                        <TaskEmailButton 
                          task={task} 
                          settings={settings} 
                          projectName={projectName} 
                          milestoneName={milestoneName} 
                          formatDate={formatDate}
                        />
                      </div>
                    )}
                    {settings.teamMemberDetails[task.assignedTo].phone && (
                      <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 bg-slate-50 px-2 py-1 rounded-lg border border-slate-100">
                        <Phone size={10} className="text-emerald-500" />
                        {settings.teamMemberDetails[task.assignedTo].phone}
                      </div>
                    )}
                  </div>
                )}
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Role (Planning)</label>
              <select 
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-slate-900 font-medium outline-none focus:ring-2 focus:ring-indigo-500"
                value={task.role || ''}
                onChange={(e) => onUpdate({ role: e.target.value })}
              >
                <option value="">No Role Assigned</option>
                {(settings.roles || []).map(role => <option key={role} value={role}>{role}</option>)}
              </select>
              <div className="mt-2">
                <p className="text-[10px] text-slate-400 leading-tight italic">Roles are for structure. Names represent actual personnel assignments.</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Accountable</label>
                <select 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-slate-900 font-medium outline-none focus:ring-2 focus:ring-indigo-500 mb-4"
                  value={task.accountable || ''}
                  onChange={(e) => onUpdate({ accountable: e.target.value || undefined, approvalStatus: e.target.value ? task.approvalStatus || 'pending' : undefined })}
                >
                  <option value="">None</option>
                  {(settings.people || []).map(person => <option key={person} value={person}>{person}</option>)}
                </select>
              </div>
              <div>
                 <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Consulted</label>
                 <select 
                   className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-slate-900 font-medium outline-none focus:ring-2 focus:ring-indigo-500 h-24"
                   multiple
                   value={task.consulted || []}
                   onChange={(e) => {
                     const vals = Array.from(e.target.selectedOptions).map(opt => (opt as HTMLOptionElement).value);
                     onUpdate({ consulted: vals.length > 0 ? vals : undefined });
                   }}
                 >
                   {(settings.people || []).map(person => <option key={person} value={person}>{person}</option>)}
                 </select>
              </div>
              <div>
                 <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Informed</label>
                 <select 
                   className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-slate-900 font-medium outline-none focus:ring-2 focus:ring-indigo-500 h-24"
                   multiple
                   value={task.informed || []}
                   onChange={(e) => {
                     const vals = Array.from(e.target.selectedOptions).map(opt => (opt as HTMLOptionElement).value);
                     onUpdate({ informed: vals.length > 0 ? vals : undefined });
                   }}
                 >
                   {(settings.people || []).map(person => <option key={person} value={person}>{person}</option>)}
                 </select>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex justify-between">
                <span>Status</span>
                {task.accountable && (task.status === 'Completed' || task.status === 'Submitted') && task.approvalStatus === 'pending' && <span className="text-amber-500">Pending Approval</span>}
                {task.accountable && (task.status === 'Completed' || task.status === 'Submitted') && task.approvalStatus === 'approved' && <span className="text-emerald-500 flex items-center gap-1"><Check size={10} /> Approved</span>}
              </label>
              <div className="flex gap-2">
                <select 
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-slate-900 font-medium outline-none focus:ring-2 focus:ring-indigo-500"
                  value={task.status || ''}
                  onChange={(e) => onUpdate({ status: e.target.value })}
                >
                  {(settings.statuses || []).map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            {task.accountable && (task.status === 'Completed' || task.status === 'Submitted') && task.approvalStatus !== 'approved' && (
              <div className="bg-amber-50 rounded-xl p-4 border border-amber-200 mt-2 space-y-2">
                 <div className="text-amber-800 text-xs font-black uppercase mb-2">Review & Approval</div>
                 <div className="grid grid-cols-2 gap-2">
                    <button 
                      onClick={() => onUpdate({ approvalStatus: 'approved', status: 'Completed', triggerWriteBack: true } as any)}
                      className="bg-emerald-600 text-white font-bold px-3 py-2 text-xs rounded-lg hover:bg-emerald-700 transition"
                    >
                      Approve & Write to Data Store
                    </button>
                    <button 
                      onClick={() => onUpdate({ approvalStatus: 'approved', status: 'Completed', triggerWriteBack: false } as any)}
                      className="bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold px-3 py-2 text-xs rounded-lg hover:bg-emerald-200 transition"
                    >
                      Approve Without Writing
                    </button>
                    <button 
                      onClick={() => onUpdate({ approvalStatus: 'pending', status: 'Started' })}
                      className="bg-amber-100 text-amber-800 border border-amber-200 font-bold px-3 py-2 text-xs rounded-lg hover:bg-amber-200 transition"
                    >
                      Return for Revision
                    </button>
                    <button 
                      onClick={() => onUpdate({ approvalStatus: 'rejected', status: 'Abandoned' })}
                      className="bg-rose-100 text-rose-800 border border-rose-200 font-bold px-3 py-2 text-xs rounded-lg hover:bg-rose-200 transition"
                    >
                      Abandon Task
                    </button>
                 </div>
              </div>
            )}
            
            <div className="flex items-center gap-6 mt-1">
               <label className="flex items-center gap-2 cursor-pointer">
                 <input 
                   type="checkbox" 
                   className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                   checked={!!task.isImportant}
                   onChange={(e) => onUpdate({ isImportant: e.target.checked })}
                 />
                 <span className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                   <AlertTriangle size={14} className={task.isImportant ? "text-amber-500 fill-amber-100" : "text-slate-400"} /> Important
                 </span>
               </label>

               <label className="flex items-center gap-2 cursor-pointer">
                 <input 
                   type="checkbox" 
                   className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                   checked={!!task.isToday}
                   onChange={(e) => onUpdate({ isToday: e.target.checked })}
                 />
                 <span className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                   <Calendar size={14} className={task.isToday ? "text-indigo-600" : "text-slate-400"} /> Today
                 </span>
               </label>
            </div>
          </div>

          {/* Timing & Scheduling */}
          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
             <div className="flex items-center gap-2 mb-3 text-indigo-600 font-bold text-xs uppercase tracking-wider">
               <Clock size={14} /> Schedule & Effort
             </div>
             <div className="grid grid-cols-3 gap-4">
                <div>
                   <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Due Date</label>
                   <div className="relative">
                      <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                      <input 
                        type="date"
                        className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm text-slate-900 font-bold outline-none focus:border-indigo-500"
                        value={dateToInput(task.dueDate)}
                        onChange={(e) => onUpdate({ dueDate: e.target.valueAsNumber || undefined })}
                      />
                   </div>
                </div>
                <div>
                   <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Est. Effort</label>
                   <div className="flex gap-2">
                     <input 
                       type="number"
                       className="w-16 bg-white border border-slate-200 rounded-xl px-2 py-2 text-sm text-center text-slate-900 font-bold outline-none focus:border-indigo-500"
                       placeholder="0"
                       value={task.estimatedTime || ''}
                       onChange={(e) => onUpdate({ estimatedTime: parseFloat(e.target.value) || undefined })}
                     />
                     <div className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 text-sm text-slate-500 font-bold flex items-center justify-center shadow-sm">
                       <span className="uppercase text-[10px]">{projectTimeUnit || 'days'}</span>
                     </div>
                   </div>
                </div>
                <div>
                   <label className="block text-[10px] font-bold text-emerald-600 uppercase mb-1">Actual Effort</label>
                   <div className="flex gap-2">
                     <input 
                       type="number"
                       className="w-16 bg-emerald-50 border border-emerald-200 rounded-xl px-2 py-2 text-sm text-center text-emerald-900 font-bold outline-none focus:border-emerald-500"
                       placeholder="0"
                       value={task.actualTime || ''}
                       onChange={(e) => onUpdate({ actualTime: parseFloat(e.target.value) || undefined })}
                     />
                     <div className="flex-1 bg-emerald-50 border border-emerald-200 rounded-xl px-2 py-2 text-sm text-emerald-600 font-bold flex items-center justify-center shadow-sm">
                       <span className="uppercase text-[10px]">{projectTimeUnit || 'days'}</span>
                     </div>
                   </div>
                </div>
             </div>
          </div>

          {/* Links & Description */}
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Resource Link (URL)</label>
            <div className="flex gap-2">
              <input 
                className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="https://drive.google.com/..."
                value={task.link || ''}
                onChange={(e) => onUpdate({ link: e.target.value })}
              />
              {task.link && (
                <a 
                  href={task.link.startsWith('http') ? task.link : `https://${task.link}`} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-100 transition-colors"
                >
                  <ExternalLink size={20} />
                </a>
              )}
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Description</label>
            <textarea 
              className="w-full h-24 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              value={task.description || ''}
              onChange={(e) => onUpdate({ description: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Comments & Notes</label>
            <div className="space-y-2 mb-2">
              {(task.commentHistory || []).map((ch, idx) => (
                <div key={idx} className="bg-slate-100 rounded-xl p-3 border border-slate-200 opacity-70">
                  <div className="flex justify-between items-center mb-1">
                     <span className="text-[10px] font-bold text-slate-500 uppercase">{new Date(ch.timestamp).toLocaleString()}</span>
                     <span className="text-[10px] font-bold text-indigo-500 uppercase px-2 py-0.5 bg-indigo-50 rounded-full">{ch.status}</span>
                  </div>
                  <p className="text-sm text-slate-600 whitespace-pre-wrap">{ch.text}</p>
                </div>
              ))}
            </div>
            <textarea 
              className="w-full h-24 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              placeholder="Add new comments or notes here..."
              value={task.notes || ''}
              onChange={(e) => onUpdate({ notes: e.target.value })}
            />
          </div>
          
          {/* Hybrid Task Workflow Configuration */}
          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200">
             <div className="text-indigo-600 font-bold text-xs uppercase tracking-wider mb-2">Hybrid Task / AI Configuration</div>
             
             <div className="mb-4">
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Task Type</label>
                <select
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
                  value={normalizeTaskType(task.taskType) || ''}
                  onChange={(e) => onUpdate({ taskType: e.target.value || undefined })}
                >
                  <option value="">— none —</option>
                  <option value="send_email">Email (send_email)</option>
                  <option value="send_sms">SMS (send_sms)</option>
                  <option value="outgoing_call">Phone Call (outgoing_call)</option>
                  <option value="webhook">Webhook (webhook)</option>
                  <option value="write_report">Report (write_report)</option>
                </select>
                {task.taskType && !normalizeTaskType(task.taskType) && (
                  <p className="text-[10px] text-rose-600 font-bold mt-1">
                    "{task.taskType}" is not a known task type — pick one above.
                  </p>
                )}
                <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mt-2 leading-snug">
                  This runs the action directly against a task and does <b>not</b> use the callback flow.
                  A phone call started here places a real call, but its result is polled by this modal
                  rather than delivered by webhook — close the modal and the outcome is lost.
                  For calls that resolve on their own and advance the flow, use a <b>Phone Call node</b> on
                  the canvas instead.
                </p>
             </div>

             <div className="mb-4">
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Template Content (JSON Supported)</label>
                <textarea 
                  placeholder='{"to": "{{contact_email}}", "subject": "Hello", "body": "..."}'
                  className="w-full h-32 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-mono outline-none focus:border-indigo-500 resize-none"
                  value={task.templateFile || ''}
                  onChange={(e) => onUpdate({ templateFile: e.target.value })}
                />
             </div>

             <div className="mb-4">
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Ready Conditions (JSON array)</label>
                <textarea 
                  placeholder='[{"variable": "ready_to_send", "equals": true}]'
                  className="w-full h-16 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-mono outline-none focus:border-indigo-500 resize-none"
                  value={JSON.stringify(task.readyConditions || [], null, 2)}
                  onChange={(e) => {
                    try {
                      onUpdate({ readyConditions: JSON.parse(e.target.value) });
                    } catch(e) {}
                  }}
                />
             </div>

             <div className="mb-4">
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Output Variables (JSON array)</label>
                <textarea 
                  placeholder='[{"name": "sent_date", "type": "date", "write_on": "approval", "value_source": "system_date"}]'
                  className="w-full h-16 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-mono outline-none focus:border-indigo-500 resize-none"
                  value={JSON.stringify(task.outputVariables || [], null, 2)}
                  onChange={(e) => {
                    try {
                      onUpdate({ outputVariables: JSON.parse(e.target.value) });
                    } catch(e) {}
                  }}
                />
             </div>

             <div className="mb-4">
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Task Output Data (JSON object)</label>
                <textarea 
                  placeholder='{"parent_contacted": true}'
                  className="w-full h-16 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-mono outline-none focus:border-indigo-500 resize-none"
                  value={JSON.stringify(task.taskOutput || {}, null, 2)}
                  onChange={(e) => {
                    try {
                      onUpdate({ taskOutput: JSON.parse(e.target.value) });
                    } catch(e) {}
                  }}
                />
                <p className="text-[10px] text-slate-400 mt-1">This data is injected into Project Data if approved.</p>
             </div>

             {task.taskType && (
                <div className="mt-4 pt-4 border-t border-slate-200">
                  {executionOutput && (
                    <div className="mb-4 bg-slate-50 border border-slate-200 rounded p-3 text-xs font-mono text-slate-800 whitespace-pre-wrap max-h-40 overflow-y-auto">
                      {executionOutput}
                    </div>
                  )}
                  <button
                    disabled={isExecuting}
                    onClick={async () => {
                       if (isExecuting) return;
                       setIsExecuting(true);
                       setExecutionOutput(null);
                       try {
                         const externalRunId = `subtask_${task.id}_${Date.now().toString(36)}`;
                         const res = await fetch('/api/tasks/execute', {
                           method: 'POST',
                           headers: { 'Content-Type': 'application/json' },
                           body: JSON.stringify({
                             taskType: task.taskType,
                             templateFile: task.templateFile,
                             projectData: projectData || {},
                             correlation: { orgId, projectId, nodeId: task.id, runId: externalRunId }
                           })
                         });
                         
                         let textResponse = '';
                         try {
                             textResponse = await res.text();
                         } catch (err) {
                             textResponse = "Failed to parse response body";
                         }

                         let data: any = null;
                         try {
                             data = JSON.parse(textResponse);
                         } catch (e) {
                             console.error("Text response from server that caused parse error:", textResponse);
                             setExecutionOutput("Server error or invalid JSON:\\n" + textResponse.substring(0, 500));
                             setIsExecuting(false);
                             return;
                         }

                         if (data.status === 'success') {
                           setExecutionOutput("Task Execution Complete.\\n\\nOutput:\\n" + (data.logs||[]).join('\n'));

                           let finalOutput = data.output;
                           if (finalOutput?.report_written && finalOutput?.report_content) {
                              try {
                                if (firebaseService.isConfigured()) {
                                    setExecutionOutput(prev => (prev || '') + "\\n\\nUploading report to Firebase...");
                                    const blob = new Blob([finalOutput.report_content], { type: 'text/markdown' });
                                    const uploadedUrl = await firebaseService.uploadFile(blob, `report_${Date.now()}.md`);
                                    if (uploadedUrl) {
                                        finalOutput.report_link = uploadedUrl;
                                        setExecutionOutput(prev => (prev || '') + "\\nUpload complete: " + uploadedUrl);
                                    } else {
                                        setExecutionOutput(prev => (prev || '') + "\\nUpload failed - missing storage");
                                    }
                                }
                              } catch (e: any) {
                                console.error("Error uploading report:", e);
                                setExecutionOutput(prev => (prev || '') + "\\nError uploading report: " + e.message);
                              }
                           }
                           
                           const isWaiting = data.pending === true;
                           onUpdate({
                             taskOutput: finalOutput,
                             status: isWaiting ? 'Held' : 'Completed',
                             evaluationResult: isWaiting ? "Communication dispatched. Waiting for an external event..." : "Task completed remotely",
                             externalRunId: isWaiting ? externalRunId : undefined,
                             externalExecutionId: isWaiting ? data.externalExecutionId : undefined,
                             externalService: isWaiting ? data.externalService : undefined,
                             externalStartedAt: isWaiting ? data.startedAt : undefined,
                             triggerWriteBack: !isWaiting
                           } as any);
                         } else {
                           setExecutionOutput("Task execution failed: " + (data.error || "unknown task type.\\nLogs:\\n") + (data.logs||[]).join('\n'));
                         }
                       } catch(e) {
                         setExecutionOutput("Error: " + String(e));
                       } finally {
                         setIsExecuting(false);
                       }
                    }}
                    className={`w-full font-bold px-4 py-2 rounded-xl transition flex justify-center items-center gap-2 ${isExecuting ? 'bg-indigo-400 text-white cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
                  >
                    {isExecuting ? 'Executing...' : 'Execute Automated Action'}
                  </button>
                  
                </div>
             )}

             <div className="mb-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Depends On (Comma separated Task IDs)</label>
                <input 
                  type="text"
                  placeholder="T-1, T-2"
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
                  value={(task.dependsOn || []).join(', ')}
                  onChange={(e) => {
                    onUpdate({ dependsOn: e.target.value.split(',').map(s => s.trim()).filter(Boolean) });
                  }}
                />
             </div>
          </div>

          <ScreenRecorder 
            taskId={task.id}
            existingUrl={task.recordingUrl}
            onUploadSuccess={(url, type) => onUpdate({ recordingUrl: url, recordingType: type })}
            onRemove={() => onUpdate({ recordingUrl: undefined, recordingType: undefined })}
          />

          {children}
        </div>

        <div className="flex justify-between items-center pt-4 border-t border-slate-100 mt-4 shrink-0">
          <button 
            onClick={onDelete}
            className="text-red-500 hover:text-red-700 text-xs font-bold px-3 py-2 hover:bg-red-50 rounded-lg transition-colors flex items-center gap-2"
          >
            <Trash2 size={14} /> Delete Task
          </button>
          <button 
            onClick={onClose}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-8 py-2.5 rounded-xl shadow-lg shadow-indigo-200 transition-all active:scale-95"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
