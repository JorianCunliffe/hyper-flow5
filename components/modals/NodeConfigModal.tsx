import React, { useState } from 'react';
import { Milestone, NodeType, DecisionBranch, ReadyCondition, ReviewPolicy, AskChannel } from '../../types';
import { NODE_TYPE_META } from '../../constants';
import { isActionNode, getNodeType } from '../../lib/flowEngine';
import { X, Play, Loader2, RotateCcw, UserCheck } from 'lucide-react';
import { actionRunStatusClasses, actionRunStatusLabel, communicationOutcomeFromOutput, formatCommunicationDisposition } from '../../lib/actionRunPresentation';
import { buildReviewPolicy } from '../../lib/reviewPolicy';

const TEMPLATE_PLACEHOLDERS: Partial<Record<NodeType, string>> = {
  [NodeType.EMAIL]: '{"to": "{{contact_email}}", "subject": "Update on {{project_name}}", "body": "Hi..."}',
  [NodeType.SMS]: '{"to": "{{contact_phone}}", "body": "Your project {{project_name}} has an update."}',
  [NodeType.PHONE_CALL]: '{"to": "{{contact_phone}}", "prompt": "You are calling to confirm the proposal..."}',
  [NodeType.WEBHOOK]: '{"url": "https://example.com/hook", "method": "POST", "payload": {"project": "{{project_name}}"}}',
  [NodeType.REPORT]: '{"prompt": "Write a status report for {{project_name}}", "sop": "...", "template": "...", "eval_criteria": "..."}',
  [NodeType.GOOGLE_DOC]: '{"resource_name": "source_document"}',
  [NodeType.GOOGLE_SHEET_READ]: '{"resource_name": "tasks"}',
  [NodeType.GOOGLE_SHEET_APPEND]: '{"resource_name": "tasks", "idempotency_key": "{{flow_occurrence_id}}:append", "values": [["..."]]}',
  [NodeType.GOOGLE_SHEET_UPSERT]: '{"resource_name": "tasks", "idempotency_key": "{{flow_occurrence_id}}:upsert", "key_column": 0, "key_value": "{{item_id}}", "values": ["{{item_id}}", "..."]}',
  [NodeType.COACHING_EXTRACT]: '{"minimum_confidence": 0.8, "instruction": "Extract the coaching session outcome using only evidence from the verified call transcript."}',
  [NodeType.EMAIL_TRIAGE]: '{"connection_id": "{{triage_connection_id}}", "triage_policy": "{{triage_policy}}", "create_drafts": "{{triage_create_drafts}}", "digest_channel": "{{triage_digest_channel}}", "digest_recipient": "{{triage_digest_recipient}}"}'
};

interface NodeConfigModalProps {
  milestone: Milestone;
  milestones: Milestone[];
  people?: string[];
  onSave: (updates: Partial<Milestone>) => void;
  onRun: (updates: Partial<Milestone>) => void;
  isRunning: boolean;
  onClose: () => void;
}

const csv = (value: string): string[] => value.split(',').map(item => item.trim()).filter(Boolean);
const csvText = (value?: string[]): string => (value || []).join(', ');

export const NodeConfigModal: React.FC<NodeConfigModalProps> = ({ milestone, milestones, people = [], onSave, onRun, isRunning, onClose }) => {
  const [nodeType, setNodeType] = useState<NodeType>(getNodeType(milestone));
  const [branches, setBranches] = useState<DecisionBranch[]>(milestone.decisionConfig?.branches || []);
  const [loopStartId, setLoopStartId] = useState(milestone.loopConfig?.loopStartId || '');
  const [maxIterations, setMaxIterations] = useState(milestone.loopConfig?.maxIterations ?? 3);
  const [exitConditionsText, setExitConditionsText] = useState(JSON.stringify(milestone.loopConfig?.exitConditions || [], null, 2));

  const [waitMinutes, setWaitMinutes] = useState(milestone.waitConfig?.durationMinutes ?? 10);
  const [waitReason, setWaitReason] = useState(milestone.waitConfig?.reason || '');

  const [eventTypes, setEventTypes] = useState(csvText(milestone.eventTriggerConfig?.eventTypes || ['communication.received']));
  const [eventChannels, setEventChannels] = useState(csvText(milestone.eventTriggerConfig?.channels));
  const [eventDirections, setEventDirections] = useState(csvText(milestone.eventTriggerConfig?.directions || ['inbound']));
  const [eventPeople, setEventPeople] = useState(csvText(milestone.eventTriggerConfig?.personIds));
  const [eventPayloadVariable, setEventPayloadVariable] = useState(milestone.eventTriggerConfig?.payloadVariable || '');

  const [template, setTemplate] = useState(milestone.actionConfig?.template || '');
  const [autoExecute, setAutoExecute] = useState(milestone.actionConfig?.autoExecute ?? false);
  const [failureMode, setFailureMode] = useState<'block' | 'continue'>(milestone.actionConfig?.failureMode || 'block');
  const [resultVariable, setResultVariable] = useState(milestone.actionConfig?.resultVariable || '');
  const [jsonError, setJsonError] = useState<string | null>(null);

  const [reviewRequired, setReviewRequired] = useState(milestone.reviewPolicy?.required ?? false);
  const [reviewers, setReviewers] = useState<string[]>(milestone.reviewPolicy?.reviewers || []);
  const [reviewChannels, setReviewChannels] = useState<AskChannel[]>(milestone.reviewPolicy?.channels || ['web']);
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

  const actionConfig = () => ({
    ...(milestone.actionConfig || {}),
    template,
    autoExecute,
    failureMode,
    resultVariable: resultVariable.trim() || undefined
  });

  const handleSave = () => {
    setJsonError(null);
    const updates: Partial<Milestone> = { nodeType };

    updates.reviewPolicy = buildReviewPolicy(milestone.reviewPolicy, {
      required: reviewRequired,
      reviewers,
      channels: reviewChannels,
      slaHours,
      onExpiry,
      maxRevisions
    });

    if (nodeType === NodeType.DECISION) {
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
    } else if (nodeType === NodeType.WAIT) {
      updates.waitConfig = {
        kind: 'timer',
        durationMinutes: Math.min(Math.max(Number(waitMinutes) || 1, 1), 1440),
        reason: waitReason.trim() || undefined
      };
    } else if (nodeType === NodeType.EVENT_TRIGGER) {
      const types = csv(eventTypes);
      if (!types.length) {
        setJsonError('Event trigger requires at least one event type. Use * to match any type.');
        return;
      }
      const payloadVariable = eventPayloadVariable.trim();
      if (payloadVariable && !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(payloadVariable)) {
        setJsonError('Event payload variable must be a simple project-data identifier.');
        return;
      }
      updates.eventTriggerConfig = {
        eventTypes: types,
        channels: csv(eventChannels).length ? csv(eventChannels) : undefined,
        directions: csv(eventDirections).length ? csv(eventDirections) : undefined,
        personIds: csv(eventPeople).length ? csv(eventPeople) : undefined,
        payloadVariable: payloadVariable || undefined
      };
    } else if (isActionNode(draftNode)) {
      if (resultVariable.trim() && !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(resultVariable.trim())) {
        setJsonError('Result variable must be a simple project-data identifier.');
        return;
      }
      updates.actionConfig = actionConfig();
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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Node Configuration</h2>
            <p className="text-xs text-slate-400 font-medium">{milestone.name}</p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"><X size={18} /></button>
        </div>

        <div className="mb-5">
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Node Type</label>
          <div className="grid grid-cols-4 gap-2">
            {(Object.keys(NODE_TYPE_META) as NodeType[]).map(t => {
              const meta = NODE_TYPE_META[t];
              const Icon = meta.icon;
              const selected = nodeType === t;
              return (
                <button key={t} onClick={() => setNodeType(t)} className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all text-center ${selected ? 'border-indigo-500 bg-indigo-50 shadow-sm' : 'border-slate-100 hover:border-slate-200 bg-white'}`} title={meta.description}>
                  <span className="p-1.5 rounded-lg" style={{ backgroundColor: `${meta.color}20`, color: meta.color }}><Icon size={16} /></span>
                  <span className={`text-[10px] font-bold ${selected ? 'text-indigo-700' : 'text-slate-500'}`}>{meta.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {nodeType === NodeType.DECISION && (
          <div className="bg-amber-50/50 border border-amber-100 rounded-2xl p-4 mb-5">
            <div className="text-amber-600 font-bold text-xs uppercase tracking-wider mb-1">Decision Branches</div>
            <p className="text-[11px] text-slate-500 mb-3">Conditions support <code>equals</code>, <code>notEquals</code>, <code>oneOf</code> and <code>exists</code>. A branch with no conditions is the default.</p>
            {children.length === 0 && <p className="text-xs text-slate-400 italic">Link this node to targets first, then configure branches.</p>}
            {children.map(child => {
              const branch = getBranchFor(child.id);
              return (
                <div key={child.id} className="bg-white border border-slate-200 rounded-xl p-3 mb-2">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold text-slate-700 truncate flex-1">→ {child.name}</span>
                    <input type="text" placeholder="Label" className="w-36 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs" value={branch.label} onChange={(e) => updateBranch(child.id, { label: e.target.value })} />
                  </div>
                  <textarea placeholder='[{"variable":"call_result_disposition","oneOf":["voicemail","busy"]}]' className="w-full h-16 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-mono resize-none" value={JSON.stringify(branch.conditions || [])} onChange={(e) => { try { updateBranch(child.id, { conditions: JSON.parse(e.target.value) }); } catch { /* allow typing */ } }} />
                </div>
              );
            })}
            {milestone.decisionConfig?.selectedTargetId && (
              <button onClick={() => { onSave({ decisionConfig: { branches, selectedTargetId: undefined, decidedAt: undefined } }); onClose(); }} className="text-[11px] text-slate-500 hover:text-red-500 font-bold flex items-center gap-1"><RotateCcw size={12} /> Reset decision</button>
            )}
          </div>
        )}

        {nodeType === NodeType.LOOP && (
          <div className="bg-violet-50/50 border border-violet-100 rounded-2xl p-4 mb-5">
            <div className="text-violet-600 font-bold text-xs uppercase tracking-wider mb-1">Loop</div>
            <p className="text-[11px] text-slate-500 mb-3">Resets the nodes between the selected start and this loop. This is the retry primitive: combine it with Decision and Wait.</p>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <label><span className="block text-[10px] font-black text-slate-400 uppercase mb-1">Loop back to</span><select className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs" value={loopStartId} onChange={(e) => setLoopStartId(e.target.value)}><option value="">— select start —</option>{milestones.filter(m => m.id !== milestone.id).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
              <label><span className="block text-[10px] font-black text-slate-400 uppercase mb-1">Max iterations</span><input type="number" min={1} className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs" value={maxIterations} onChange={(e) => setMaxIterations(parseInt(e.target.value) || 1)} /></label>
            </div>
            <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Exit conditions (JSON)</label>
            <textarea placeholder='[{"variable":"done","equals":true}]' className="w-full h-20 bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-mono resize-none" value={exitConditionsText} onChange={(e) => setExitConditionsText(e.target.value)} />
            <div className="flex items-center justify-between mt-2"><span className="text-[11px] text-slate-500 font-bold">Iteration {milestone.loopConfig?.currentIteration ?? 0} / {maxIterations}</span><button onClick={handleResetLoop} className="text-[11px] text-slate-400 hover:text-red-500 font-bold flex items-center gap-1"><RotateCcw size={12} /> Reset loop</button></div>
          </div>
        )}

        {nodeType === NodeType.WAIT && (
          <div className="bg-amber-50/50 border border-amber-100 rounded-2xl p-4 mb-5">
            <div className="text-amber-700 font-bold text-xs uppercase tracking-wider mb-1">Durable Wait</div>
            <p className="text-[11px] text-slate-500 mb-3">The flow stops here, persists a hold, and resumes on the first scheduler tick after the delay.</p>
            <div className="grid grid-cols-2 gap-3">
              <label><span className="block text-[10px] font-black text-slate-400 uppercase mb-1">Minutes</span><input type="number" min={1} max={1440} className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs" value={waitMinutes} onChange={(e) => setWaitMinutes(Number(e.target.value) || 1)} /></label>
              <label><span className="block text-[10px] font-black text-slate-400 uppercase mb-1">Reason</span><input className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs" value={waitReason} onChange={(e) => setWaitReason(e.target.value)} placeholder="Retry delay / follow up later" /></label>
            </div>
            {milestone.waitConfig?.resumeAt && !milestone.waitConfig.resolvedAt && <p className="mt-2 text-[11px] font-bold text-amber-700">Currently held until {new Date(milestone.waitConfig.resumeAt).toLocaleString()}</p>}
          </div>
        )}

        {nodeType === NodeType.EVENT_TRIGGER && (
          <div className="bg-cyan-50/50 border border-cyan-100 rounded-2xl p-4 mb-5">
            <div className="text-cyan-700 font-bold text-xs uppercase tracking-wider mb-1">Event Trigger</div>
            <p className="text-[11px] text-slate-500 mb-3">Starts this flow from a trusted event. Comma-separated filters are OR matches; blank means any. Use * for any event type.</p>
            <div className="grid grid-cols-2 gap-3">
              <label><span className="block text-[10px] font-black text-slate-400 uppercase mb-1">Event types</span><input className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs" value={eventTypes} onChange={(e) => setEventTypes(e.target.value)} placeholder="communication.received" /></label>
              <label><span className="block text-[10px] font-black text-slate-400 uppercase mb-1">Channels</span><input className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs" value={eventChannels} onChange={(e) => setEventChannels(e.target.value)} placeholder="sms, email, voice" /></label>
              <label><span className="block text-[10px] font-black text-slate-400 uppercase mb-1">Directions</span><input className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs" value={eventDirections} onChange={(e) => setEventDirections(e.target.value)} placeholder="inbound" /></label>
              <label><span className="block text-[10px] font-black text-slate-400 uppercase mb-1">Person IDs</span><input className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs" value={eventPeople} onChange={(e) => setEventPeople(e.target.value)} placeholder="optional trusted people" /></label>
              <label className="col-span-2"><span className="block text-[10px] font-black text-slate-400 uppercase mb-1">Payload project-data variable</span><input className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono" value={eventPayloadVariable} onChange={(e) => setEventPayloadVariable(e.target.value)} placeholder="inbound_event" /></label>
            </div>
          </div>
        )}

        {nodeType === NodeType.END && (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-5 text-sm text-slate-600">This node explicitly terminates the current branch. It has no runtime configuration.</div>
        )}

        {isActionNode(draftNode) && (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-5">
            <div className="font-bold text-xs uppercase tracking-wider mb-1" style={{ color: NODE_TYPE_META[nodeType].color }}>{NODE_TYPE_META[nodeType].label} Action</div>
            <p className="text-[11px] text-slate-500 mb-3">{NODE_TYPE_META[nodeType].description}. Template supports {'{{variable}}'} substitution from Project Data.</p>
            <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Template (JSON supported)</label>
            <textarea placeholder={TEMPLATE_PLACEHOLDERS[nodeType] || ''} className="w-full h-32 bg-white border border-slate-200 rounded-lg px-3 py-2 text-[11px] font-mono resize-none" value={template} onChange={(e) => setTemplate(e.target.value)} />
            <div className="grid grid-cols-2 gap-3 mt-3">
              <label><span className="block text-[10px] font-black text-slate-400 uppercase mb-1">On failure</span><select className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs" value={failureMode} onChange={(e) => setFailureMode(e.target.value as 'block' | 'continue')}><option value="block">Block here</option><option value="continue">Expose error and continue</option></select></label>
              <label><span className="block text-[10px] font-black text-slate-400 uppercase mb-1">Result variable</span><input className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono" value={resultVariable} onChange={(e) => setResultVariable(e.target.value)} placeholder="call_result" /></label>
            </div>
            {resultVariable.trim() && <p className="mt-2 text-[10px] text-slate-500">Creates <code>{resultVariable}_success</code>, <code>{resultVariable}_disposition</code>, <code>{resultVariable}_error</code> and related fields for Decisions.</p>}
            <label className="flex items-center gap-2 mt-3 cursor-pointer"><input type="checkbox" checked={autoExecute} onChange={(e) => setAutoExecute(e.target.checked)} className="rounded" /><span className="text-xs font-bold text-slate-600">Auto-execute when ready</span></label>

            {lastRun && (() => {
              const outcome = lastRun.communicationOutcome || communicationOutcomeFromOutput(lastRun.output);
              return <div className={`mt-3 rounded-lg border p-3 text-[11px] font-mono whitespace-pre-wrap max-h-48 overflow-y-auto ${actionRunStatusClasses(lastRun)}`}><div className="font-bold mb-1">Last run: {actionRunStatusLabel(lastRun, nodeType).toUpperCase()} — {new Date(lastRun.at).toLocaleString()}</div>{outcome?.disposition ? `Outcome: ${formatCommunicationDisposition(outcome.disposition)}\n` : ''}{outcome?.providerStatus ? `Provider status: ${outcome.providerStatus}\n` : ''}{outcome?.failureReason ? `Reason: ${outcome.failureReason}\n` : ''}{(lastRun.logs || []).join('\n')}{lastRun.error && lastRun.error !== outcome?.failureReason ? `\nError: ${lastRun.error}` : ''}</div>;
            })()}
          </div>
        )}

        <div className="bg-emerald-50/40 border border-emerald-100 rounded-2xl p-4 mb-5">
          <div className="text-emerald-700 font-bold text-xs uppercase tracking-wider mb-1 flex items-center gap-1.5"><UserCheck size={13} /> Human Review</div>
          <p className="text-[11px] text-slate-500 mb-3">When required, downstream nodes stay blocked until a person signs off.</p>
          <label className="flex items-center gap-2 cursor-pointer mb-3"><input type="checkbox" checked={reviewRequired} onChange={(e) => setReviewRequired(e.target.checked)} className="rounded" /><span className="text-xs font-bold text-slate-700">Require human review before this node completes</span></label>
          {reviewRequired && (
            <div className="space-y-3">
              <div><label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Reviewers</label>{people.length > 0 ? <select multiple className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs h-24" value={reviewers} onChange={(e) => setReviewers(Array.from(e.target.selectedOptions).map(o => (o as HTMLOptionElement).value))}>{people.map(p => <option key={p} value={p}>{p}</option>)}</select> : <input type="text" className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs" value={reviewers.join(', ')} onChange={(e) => setReviewers(csv(e.target.value))} />}</div>
              <fieldset><legend className="block text-[10px] font-black text-slate-400 uppercase mb-1">Delivery channels</legend><div className="flex flex-wrap gap-2">{(['web', 'email', 'sms', 'voice'] as AskChannel[]).map(channel => { const selected = reviewChannels.includes(channel); return <label key={channel} className="flex items-center gap-1.5 rounded-lg border border-emerald-100 bg-white px-2.5 py-1.5 text-xs font-semibold"><input type="checkbox" checked={selected} onChange={() => setReviewChannels(current => selected ? current.filter(item => item !== channel) : [...current, channel])} />{channel}</label>; })}</div></fieldset>
              <div className="grid grid-cols-3 gap-3">
                <label><span className="block text-[10px] font-black text-slate-400 uppercase mb-1">Due within (hrs)</span><input type="number" min={1} className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs" value={slaHours} onChange={(e) => setSlaHours(e.target.value === '' ? '' : parseInt(e.target.value) || 1)} /></label>
                <label><span className="block text-[10px] font-black text-slate-400 uppercase mb-1">If overdue</span><select className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs" value={onExpiry} onChange={(e) => setOnExpiry(e.target.value as any)}><option value="block">Keep waiting</option><option value="escalate">Escalate</option><option value="auto_approve">Auto-approve</option></select></label>
                <label><span className="block text-[10px] font-black text-slate-400 uppercase mb-1">Max redos</span><input type="number" min={1} className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs" value={maxRevisions} onChange={(e) => setMaxRevisions(e.target.value === '' ? '' : parseInt(e.target.value) || 1)} /></label>
              </div>
            </div>
          )}
        </div>

        {jsonError && <div className="text-xs text-red-500 font-bold mb-3">{jsonError}</div>}

        <div className="flex items-center justify-end gap-2">
          {isActionNode(draftNode) && <button onClick={() => onRun({ nodeType, actionConfig: actionConfig() })} disabled={isRunning} className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 disabled:opacity-50 mr-auto">{isRunning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Run Now</button>}
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-500 hover:bg-slate-100 rounded-xl">Cancel</button>
          <button onClick={handleSave} className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700">Save</button>
        </div>
      </div>
    </div>
  );
};
