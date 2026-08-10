import React, { useState } from 'react';
import { Milestone, NodeType, DecisionBranch, ReadyCondition, ReviewPolicy } from '../../types';
import { NODE_TYPE_META } from '../../constants';
import { isActionNode, getNodeType } from '../../lib/flowEngine';
import { X, Play, Loader2, RotateCcw, UserCheck } from 'lucide-react';

const TEMPLATE_PLACEHOLDERS: Partial<Record<NodeType, string>> = {
  [NodeType.EMAIL]: '{"to": "{{contact_email}}", "subject": "Update on {{project_name}}", "body": "Hi..."}',
  [NodeType.SMS]: '{"to": "{{contact_phone}}", "body": "Your project {{project_name}} has an update."}',
  [NodeType.PHONE_CALL]: '{"to": "{{contact_phone}}", "prompt": "You are calling to confirm the proposal..."}',
  [NodeType.WEBHOOK]: '{"url": "https://example.com/hook", "method": "POST", "payload": {"project": "{{project_name}}"}}',
  [NodeType.REPORT]: '{"prompt": "Write a status report for {{project_name}}", "sop": "...", "template": "...", "eval_criteria": "..."}'
};

interface NodeConfigModalProps {
  milestone: Milestone;
  milestones: Milestone[];
  people?: string[];
  onSave: (updates: Partial<Milestone>) => void;
  onRun: () => void;
  isRunning: boolean;
  onClose: () => void;
}

export const NodeConfigModal: React.FC<NodeConfigModalProps> = ({ milestone, milestones, people = [], onSave, onRun, isRunning, onClose }) => {
  const [nodeType, setNodeType] = useState<NodeType>(getNodeType(milestone));
  const [branches, setBranches] = useState<DecisionBranch[]>(milestone.decisionConfig?.branches || []);
  const [loopStartId, setLoopStartId] = useState(milestone.loopConfig?.loopStartId || '');
  const [maxIterations, setMaxIterations] = useState(milestone.loopConfig?.maxIterations ?? 3);
  const [exitConditionsText, setExitConditionsText] = useState(JSON.stringify(milestone.loopConfig?.exitConditions || [], null, 2));
  const [template, setTemplate] = useState(milestone.actionConfig?.template || '');
  const [autoExecute, setAutoExecute] = useState(milestone.actionConfig?.autoExecute ?? false);
  const [jsonError, setJsonError] = useState<string | null>(null);

  const [reviewRequired, setReviewRequired] = useState(milestone.reviewPolicy?.required ?? false);
  const [reviewers, setReviewers] = useState<string[]>(milestone.reviewPolicy?.reviewers || []);
  const [slaHours, setSlaHours] = useState<number | ''>(milestone.reviewPolicy?.slaHours ?? '');
  const [onExpiry, setOnExpiry] = useState<NonNullable<ReviewPolicy['onExpiry']>>(milestone.reviewPolicy?.onExpiry || 'block');
  const [maxRevisions, setMaxRevisions] = useState<number | ''>(milestone.reviewPolicy?.maxRevisions ?? '');

  const children = milestones.filter(m => (m.dependsOn || []).includes(milestone.id));
  const draftNode: Milestone = { ...milestone, nodeType };
  const lastRun = milestone.actionConfig?.lastRun;

  const getBranchFor = (targetId: string): DecisionBranch =>
    branches.find(b => b.targetId === targetId) || { targetId, label: '', conditions: [] };

  const updateBranch = (targetId: string, updates: Partial<DecisionBranch>) => {
    setBranches(prev => {
      const existing = prev.find(b => b.targetId === targetId);
      if (existing) return prev.map(b => b.targetId === targetId ? { ...b, ...updates } : b);
      return [...prev, { targetId, label: '', conditions: [], ...updates }];
    });
  };

  const handleSave = () => {
    setJsonError(null);
    const updates: Partial<Milestone> = { nodeType };

    updates.reviewPolicy = reviewRequired
      ? {
          required: true,
          reviewers: reviewers.length ? reviewers : undefined,
          slaHours: slaHours === '' ? undefined : Number(slaHours),
          onExpiry,
          maxRevisions: maxRevisions === '' ? undefined : Number(maxRevisions)
        }
      : undefined;

    if (nodeType === NodeType.DECISION) {
      // Keep only branches pointing at current children
      const childIds = new Set(children.map(c => c.id));
      updates.decisionConfig = {
        ...(milestone.decisionConfig || {}),
        branches: branches.filter(b => childIds.has(b.targetId))
      };
    } else if (nodeType === NodeType.LOOP) {
      let exitConditions: ReadyCondition[] = [];
      try {
        exitConditions = JSON.parse(exitConditionsText || '[]');
        if (!Array.isArray(exitConditions)) throw new Error('must be an array');
      } catch (e: any) {
        setJsonError(`Exit conditions: ${e.message}`);
        return;
      }
      updates.loopConfig = {
        currentIteration: milestone.loopConfig?.currentIteration ?? 0,
        exited: milestone.loopConfig?.exited,
        loopStartId: loopStartId || undefined,
        maxIterations: Math.max(1, maxIterations),
        exitConditions
      };
    } else if (isActionNode(draftNode)) {
      updates.actionConfig = {
        ...(milestone.actionConfig || {}),
        template,
        autoExecute
      };
    }

    onSave(updates);
    onClose();
  };

  const handleResetLoop = () => {
    onSave({
      loopConfig: {
        loopStartId: loopStartId || undefined,
        maxIterations: Math.max(1, maxIterations),
        exitConditions: milestone.loopConfig?.exitConditions || [],
        currentIteration: 0,
        exited: false
      }
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onMouseDown={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Node Configuration</h2>
            <p className="text-xs text-slate-400 font-medium">{milestone.name}</p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Node Type Picker */}
        <div className="mb-5">
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Node Type</label>
          <div className="grid grid-cols-4 gap-2">
            {(Object.keys(NODE_TYPE_META) as NodeType[]).map(t => {
              const meta = NODE_TYPE_META[t];
              const Icon = meta.icon;
              const selected = nodeType === t;
              return (
                <button
                  key={t}
                  onClick={() => setNodeType(t)}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all text-center ${selected ? 'border-indigo-500 bg-indigo-50 shadow-sm' : 'border-slate-100 hover:border-slate-200 bg-white'}`}
                  title={meta.description}
                >
                  <span className="p-1.5 rounded-lg" style={{ backgroundColor: `${meta.color}20`, color: meta.color }}>
                    <Icon size={16} />
                  </span>
                  <span className={`text-[10px] font-bold ${selected ? 'text-indigo-700' : 'text-slate-500'}`}>{meta.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Decision Config */}
        {nodeType === NodeType.DECISION && (
          <div className="bg-amber-50/50 border border-amber-100 rounded-2xl p-4 mb-5">
            <div className="text-amber-600 font-bold text-xs uppercase tracking-wider mb-1">Decision Branches</div>
            <p className="text-[11px] text-slate-500 mb-3">
              Each outgoing link is a branch. The first branch whose conditions all pass (against Project Data) wins;
              a branch with no conditions is the default. Unselected branches are skipped.
            </p>
            {children.length === 0 && (
              <p className="text-xs text-slate-400 italic">No outgoing links yet — link this node to targets first, then configure branches.</p>
            )}
            {children.map(child => {
              const branch = getBranchFor(child.id);
              return (
                <div key={child.id} className="bg-white border border-slate-200 rounded-xl p-3 mb-2">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold text-slate-700 truncate flex-1">→ {child.name}</span>
                    <input
                      type="text"
                      placeholder="Label (e.g. Yes)"
                      className="w-32 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs outline-none focus:border-amber-400"
                      value={branch.label}
                      onChange={(e) => updateBranch(child.id, { label: e.target.value })}
                    />
                  </div>
                  <textarea
                    placeholder='Conditions, e.g. [{"variable": "proposal_interest", "equals": true}] — leave empty for default branch'
                    className="w-full h-14 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-mono outline-none focus:border-amber-400 resize-none"
                    value={JSON.stringify(branch.conditions || [], null, 0)}
                    onChange={(e) => {
                      try { updateBranch(child.id, { conditions: JSON.parse(e.target.value) }); } catch (err) { /* keep typing */ }
                    }}
                  />
                </div>
              );
            })}
            {milestone.decisionConfig?.selectedTargetId && (
              <div className="flex items-center justify-between mt-2">
                <span className="text-[11px] text-emerald-600 font-bold">
                  Decided: {milestones.find(m => m.id === milestone.decisionConfig!.selectedTargetId)?.name || '?'}
                </span>
                <button
                  onClick={() => { onSave({ decisionConfig: { branches, selectedTargetId: undefined, decidedAt: undefined } }); onClose(); }}
                  className="text-[11px] text-slate-400 hover:text-red-500 font-bold flex items-center gap-1"
                >
                  <RotateCcw size={12} /> Reset decision
                </button>
              </div>
            )}
          </div>
        )}

        {/* Loop Config */}
        {nodeType === NodeType.LOOP && (
          <div className="bg-violet-50/50 border border-violet-100 rounded-2xl p-4 mb-5">
            <div className="text-violet-600 font-bold text-xs uppercase tracking-wider mb-1">Loop Settings</div>
            <p className="text-[11px] text-slate-500 mb-3">
              When this node is reached and the exit conditions aren't met, everything between the loop start and
              this node resets and runs again — up to the max iterations.
            </p>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Loop back to</label>
                <select
                  className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-violet-400"
                  value={loopStartId}
                  onChange={(e) => setLoopStartId(e.target.value)}
                >
                  <option value="">— select start node —</option>
                  {milestones.filter(m => m.id !== milestone.id).map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Max iterations</label>
                <input
                  type="number"
                  min={1}
                  className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-violet-400"
                  value={maxIterations}
                  onChange={(e) => setMaxIterations(parseInt(e.target.value) || 1)}
                />
              </div>
            </div>
            <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Exit conditions (JSON array)</label>
            <textarea
              placeholder='[{"variable": "approved", "equals": true}]'
              className="w-full h-20 bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-mono outline-none focus:border-violet-400 resize-none"
              value={exitConditionsText}
              onChange={(e) => setExitConditionsText(e.target.value)}
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-[11px] text-slate-500 font-bold">
                Iteration {milestone.loopConfig?.currentIteration ?? 0} / {maxIterations}
                {milestone.loopConfig?.exited && <span className="text-emerald-600 ml-2">✓ Exited</span>}
              </span>
              <button onClick={handleResetLoop} className="text-[11px] text-slate-400 hover:text-red-500 font-bold flex items-center gap-1">
                <RotateCcw size={12} /> Reset loop
              </button>
            </div>
          </div>
        )}

        {/* Action Config */}
        {isActionNode(draftNode) && (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-5">
            <div className="font-bold text-xs uppercase tracking-wider mb-1" style={{ color: NODE_TYPE_META[nodeType].color }}>
              {NODE_TYPE_META[nodeType].label} Action
            </div>
            <p className="text-[11px] text-slate-500 mb-3">{NODE_TYPE_META[nodeType].description}. Template supports {'{{variable}}'} substitution from Project Data.</p>
            <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Template (JSON supported)</label>
            <textarea
              placeholder={TEMPLATE_PLACEHOLDERS[nodeType] || ''}
              className="w-full h-32 bg-white border border-slate-200 rounded-lg px-3 py-2 text-[11px] font-mono outline-none focus:border-indigo-400 resize-none"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
            />
            <label className="flex items-center gap-2 mt-3 cursor-pointer">
              <input type="checkbox" checked={autoExecute} onChange={(e) => setAutoExecute(e.target.checked)} className="rounded" />
              <span className="text-xs font-bold text-slate-600">Auto-execute when ready (runs during "Advance Flow")</span>
            </label>

            {lastRun && (
              <div className={`mt-3 rounded-lg border p-3 text-[11px] font-mono whitespace-pre-wrap max-h-36 overflow-y-auto ${lastRun.status === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
                <div className="font-bold mb-1">Last run: {lastRun.status.toUpperCase()} — {new Date(lastRun.at).toLocaleString()}</div>
                {(lastRun.logs || []).join('\n')}
                {lastRun.error ? `\nError: ${lastRun.error}` : ''}
              </div>
            )}
          </div>
        )}

        {/* Human review gate */}
        <div className="bg-emerald-50/40 border border-emerald-100 rounded-2xl p-4 mb-5">
          <div className="text-emerald-700 font-bold text-xs uppercase tracking-wider mb-1 flex items-center gap-1.5">
            <UserCheck size={13} /> Human Review
          </div>
          <p className="text-[11px] text-slate-500 mb-3">
            When required, this node's work is held for a person to approve. The flow will not continue past
            it — and downstream nodes stay blocked — until someone signs it off.
          </p>

          <label className="flex items-center gap-2 cursor-pointer mb-3">
            <input type="checkbox" checked={reviewRequired} onChange={(e) => setReviewRequired(e.target.checked)} className="rounded" />
            <span className="text-xs font-bold text-slate-700">Require human review before this node completes</span>
          </label>

          {reviewRequired && (
            <div className="space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Reviewers</label>
                {people.length > 0 ? (
                  <select
                    multiple
                    className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-emerald-400 h-24"
                    value={reviewers}
                    onChange={(e) => setReviewers(Array.from(e.target.selectedOptions).map(o => (o as HTMLOptionElement).value))}
                  >
                    {people.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder="Comma separated names"
                    className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-emerald-400"
                    value={reviewers.join(', ')}
                    onChange={(e) => setReviewers(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                  />
                )}
                <p className="text-[10px] text-slate-400 mt-1">Leave empty to fall back to whoever is accountable for the node's tasks.</p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Due within (hrs)</label>
                  <input
                    type="number"
                    min={1}
                    placeholder="—"
                    className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-emerald-400"
                    value={slaHours}
                    onChange={(e) => setSlaHours(e.target.value === '' ? '' : parseInt(e.target.value) || 1)}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">If overdue</label>
                  <select
                    className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-emerald-400"
                    value={onExpiry}
                    onChange={(e) => setOnExpiry(e.target.value as any)}
                  >
                    <option value="block">Keep waiting</option>
                    <option value="escalate">Escalate</option>
                    <option value="auto_approve">Auto-approve</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Max redos</label>
                  <input
                    type="number"
                    min={1}
                    placeholder="—"
                    className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-emerald-400"
                    value={maxRevisions}
                    onChange={(e) => setMaxRevisions(e.target.value === '' ? '' : parseInt(e.target.value) || 1)}
                  />
                </div>
              </div>

              {onExpiry === 'auto_approve' && (
                <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 font-medium">
                  Auto-approve means silence counts as sign-off. The gate releases on the deadline whether or not anyone looked.
                </p>
              )}

              {(milestone.asks || []).some(a => a.status === 'open') && (
                <p className="text-[10px] text-slate-500 font-bold">
                  {(milestone.asks || []).filter(a => a.status === 'open').length} review(s) currently awaiting a person.
                </p>
              )}
            </div>
          )}
        </div>

        {jsonError && <div className="text-xs text-red-500 font-bold mb-3">{jsonError}</div>}

        <div className="flex items-center justify-end gap-2">
          {isActionNode(draftNode) && (
            <button
              onClick={() => {
                onSave({ nodeType, actionConfig: { ...(milestone.actionConfig || {}), template, autoExecute } });
                onRun();
              }}
              disabled={isRunning}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 disabled:opacity-50 transition-colors mr-auto"
            >
              {isRunning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              Run Now
            </button>
          )}
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-500 hover:bg-slate-100 rounded-xl transition-colors">Cancel</button>
          <button onClick={handleSave} className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition-colors">Save</button>
        </div>
      </div>
    </div>
  );
};
