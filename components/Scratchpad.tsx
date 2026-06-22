import React, { useState } from 'react';
import { Project, ScratchTask, Subtask, Milestone, AppSettings } from '../types';
import { Plus, Edit2, Check, Trash2, ArrowRight } from 'lucide-react';
import { EditTaskModal } from './modals/EditTaskModal';

interface ScratchpadProps {
  scratchTasks: ScratchTask[];
  onUpdateScratchTasks: (tasks: ScratchTask[]) => void;
  projects: Project[];
  settings: AppSettings;
  onPromoteTask: (scratchTaskId: string, projectId: string, milestoneId: string, updatedSubtask: Subtask) => void;
}

export const Scratchpad: React.FC<ScratchpadProps> = ({ scratchTasks, onUpdateScratchTasks, projects, settings, onPromoteTask }) => {
  const [newTaskName, setNewTaskName] = useState('');
  const [newTaskProject, setNewTaskProject] = useState('');
  const [editingTask, setEditingTask] = useState<ScratchTask | null>(null);

  // Edit modal state
  const [modalTask, setModalTask] = useState<Subtask | null>(null);
  const [modalScratchId, setModalScratchId] = useState<string | null>(null);
  const [modalProject, setModalProject] = useState<string>('');
  const [modalMilestone, setModalMilestone] = useState<string>('');

  const activeProjects = projects.filter(p => !p.isArchived);

  const handleAddTask = () => {
    if (!newTaskName.trim()) return;
    const newTask: ScratchTask = {
      id: Math.random().toString(36).substr(2, 9),
      name: newTaskName.trim(),
      projectId: newTaskProject || undefined,
      createdAt: Date.now()
    };
    onUpdateScratchTasks([...scratchTasks, newTask]);
    setNewTaskName('');
  };

  const handleUpdateTaskName = (id: string, name: string) => {
    onUpdateScratchTasks(scratchTasks.map(t => t.id === id ? { ...t, name } : t));
    setEditingTask(null);
  };

  const handleDeleteTask = (id: string) => {
    onUpdateScratchTasks(scratchTasks.filter(t => t.id !== id));
  };

  const openFullEdit = (task: ScratchTask) => {
    const dummySubtask: Subtask = {
      id: Math.random().toString(36).substr(2, 9),
      displayId: 'T-###',
      name: task.name,
      description: '',
      notes: '',
      assignedTo: '',
      status: 'Not started'
    };
    setModalTask(dummySubtask);
    setModalScratchId(task.id);
    setModalProject(task.projectId || '');
    setModalMilestone('');
  };

  const handlePromote = (updatedSubtask: Subtask) => {
    if (!modalScratchId || !modalProject || !modalMilestone) {
      alert("Please select a Project and Milestone before saving.");
      return;
    }
    onPromoteTask(modalScratchId, modalProject, modalMilestone, updatedSubtask);
    setModalTask(null);
    setModalScratchId(null);
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-hidden">
      <div className="bg-white px-6 py-4 border-b border-slate-200 shrink-0">
        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <Edit2 size={20} className="text-indigo-500" /> Scratchpad
        </h2>
        <p className="text-sm text-slate-500 mt-1">Quickly jot down tasks. You can assign them to a project and milestone later to move them out of the scratchpad.</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          
          {/* Add New Row */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-3 flex flex-col md:flex-row gap-3 items-center">
            <input
              type="text"
              placeholder="What needs to be done?"
              value={newTaskName}
              onChange={(e) => setNewTaskName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddTask()}
              className="flex-1 bg-slate-50 border-0 outline-none focus:ring-2 focus:ring-indigo-100 rounded-lg px-4 py-2 w-full"
            />
            <div className="flex w-full md:w-auto gap-2">
              <select
                value={newTaskProject}
                onChange={(e) => setNewTaskProject(e.target.value)}
                className="bg-slate-50 border-0 outline-none focus:ring-2 focus:ring-indigo-100 rounded-lg px-3 py-2 text-sm text-slate-600 flex-1 md:w-48 appearance-none"
              >
                <option value="">No Project</option>
                {activeProjects.map(p => (
                  <option key={p.id} value={p.id}>{p.displayId} - {p.name}</option>
                ))}
              </select>
              <button
                onClick={handleAddTask}
                disabled={!newTaskName.trim()}
                className="bg-indigo-600 text-white rounded-lg p-2 font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50 shrink-0 aspect-square flex items-center justify-center"
              >
                <Plus size={20} />
              </button>
            </div>
          </div>

          <div className="h-4" />

          {/* Task List */}
          <div className="space-y-2">
            {scratchTasks.length === 0 ? (
              <div className="text-center py-10 bg-white border border-dashed border-slate-300 rounded-2xl">
                <p className="text-slate-400 font-medium">No tasks in scratchpad</p>
              </div>
            ) : (
              [...scratchTasks].sort((a,b) => b.createdAt - a.createdAt).map(task => {
                const project = projects.find(p => p.id === task.projectId);
                return (
                  <div key={task.id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-3 md:p-4 flex flex-col md:flex-row gap-3 md:items-center hover:border-indigo-200 transition-colors group">
                    {editingTask?.id === task.id ? (
                      <input
                        type="text"
                        defaultValue={task.name}
                        autoFocus
                        onBlur={(e) => handleUpdateTaskName(task.id, e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleUpdateTaskName(task.id, (e.target as HTMLInputElement).value)}
                        className="flex-1 bg-slate-50 border-0 outline-none focus:ring-2 focus:ring-indigo-100 rounded px-2 py-1"
                      />
                    ) : (
                      <div className="flex-1 font-medium text-slate-800" onClick={() => setEditingTask(task)}>{task.name}</div>
                    )}
                    
                    <div className="flex items-center gap-2 justify-between md:justify-end mt-2 md:mt-0 w-full md:w-auto border-t md:border-0 border-slate-100 pt-2 md:pt-0">
                      <select
                        value={task.projectId || ''}
                        onChange={(e) => {
                          onUpdateScratchTasks(scratchTasks.map(t => t.id === task.id ? { ...t, projectId: e.target.value } : t));
                        }}
                        className="bg-slate-50 text-slate-600 border border-slate-200 outline-none focus:ring-2 focus:ring-indigo-100 rounded-lg px-2 py-1 text-xs truncate max-w-[150px] appearance-none"
                      >
                         <option value="">No Project</option>
                        {activeProjects.map(p => (
                          <option key={p.id} value={p.id}>{p.displayId} - {p.name}</option>
                        ))}
                      </select>
                      
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => handleDeleteTask(task.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors" title="Delete">
                          <Trash2 size={16} />
                        </button>
                        <button onClick={() => openFullEdit(task)} className="p-1.5 text-indigo-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors bg-indigo-50/50" title="Complete & Assign">
                          <Check size={16} /> Assign
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {modalTask && modalScratchId && (
        <EditTaskModal
          isOpen={true}
          onClose={() => { setModalTask(null); setModalScratchId(null); }}
          task={modalTask}
          onUpdate={(updates) => setModalTask(prev => ({ ...prev!, ...updates }))}
          onDelete={() => { handleDeleteTask(modalScratchId!); setModalTask(null); setModalScratchId(null); }}
          milestoneName={`Scratch`}
          projectName={`Scratch`}
          projectTimeUnit={projects.find(p => p.id === modalProject)?.timeUnit || 'days'}
          settings={settings} 
        >
          <div className="mb-4 space-y-4 pt-4 border-t border-slate-100">
             <div className="space-y-4 bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                <h4 className="text-sm font-bold text-indigo-800 flex items-center gap-2"><ArrowRight size={16}/> Promote to Project</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Target Project</label>
                    <select
                      value={modalProject}
                      onChange={(e) => {
                        setModalProject(e.target.value);
                        setModalMilestone('');
                      }}
                      className="w-full bg-white border border-slate-200 outline-none rounded-lg px-3 py-2 text-sm focus:border-indigo-500"
                    >
                      <option value="">Select Project...</option>
                      {activeProjects.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Target Milestone</label>
                    <select
                      value={modalMilestone}
                      onChange={(e) => setModalMilestone(e.target.value)}
                      className="w-full bg-white border border-slate-200 outline-none rounded-lg px-3 py-2 text-sm focus:border-indigo-500"
                      disabled={!modalProject}
                    >
                      <option value="">Select Milestone...</option>
                      {modalProject && activeProjects.find(p => p.id === modalProject)?.milestones.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {(!modalProject || !modalMilestone) ? (
                  <p className="text-xs text-amber-600 font-medium">Please select a project and milestone to assign this task.</p>
                ) : (
                  <button 
                    onClick={() => handlePromote(modalTask)}
                    className="w-full mt-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 rounded-lg flex items-center justify-center gap-2 transition-colors"
                  >
                    <Check size={16} /> Confirm Promotion
                  </button>
                )}
             </div>
          </div>
        </EditTaskModal>
      )}
    </div>
  );
};
