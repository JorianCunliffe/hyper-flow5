import React, { useState } from 'react';
import {
  AlertTriangle,
  Check,
  Clock,
  ExternalLink,
  FileText,
  Loader2,
  MessageSquare,
  Paperclip,
  RotateCcw,
  Sparkles,
  Upload,
  X
} from 'lucide-react';
import { AskDecision, Attachment, HumanAsk } from '../types';
import { collectAttachments, isOverdue } from '../lib/humanAsk';
import { firebaseService } from '../services/firebaseService';
import { Markdown } from './Markdown';

export interface ReviewSubmission {
  decision?: AskDecision;
  text?: string;
  values?: Record<string, any>;
  attachments?: Attachment[];
}

interface ReviewPanelProps {
  ask: HumanAsk;
  nodeName: string;
  projectName: string;
  onSubmit: (submission: ReviewSubmission) => Promise<void> | void;
  onClose: () => void;
}

const attachmentKind = (mime: string): Attachment['kind'] => {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime) return 'document';
  return 'other';
};

const relative = (ts: number) => {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

/**
 * Presents an agent's work product for human review.
 *
 * Shows the artifact as it should be read (rendered, not raw JSON), surfaces the
 * agent's own critique of its work, and — when this is a redo — lets the reviewer
 * see the draft they previously rejected.
 */
export const ReviewPanel: React.FC<ReviewPanelProps> = ({ ask, nodeName, projectName, onSubmit, onClose }) => {
  const [comment, setComment] = useState('');
  const [values, setValues] = useState<Record<string, any>>({});
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState<AskDecision | 'answer' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPrevious, setShowPrevious] = useState(false);

  const artifact = ask.artifact;
  const overdue = isOverdue(ask);
  const priorAttachments = collectAttachments(ask);

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    if (!firebaseService.isConfigured()) {
      setError('File uploads need cloud storage configured.');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const uploaded: Attachment[] = [];
      for (const file of Array.from(files)) {
        const url = await firebaseService.uploadFile(file, `ask_${ask.id}_${Date.now()}_${file.name}`);
        if (!url) throw new Error('Upload returned no URL — check storage rules.');
        uploaded.push({
          id: `att_${Date.now()}_${uploaded.length}`,
          url,
          name: file.name,
          mime: file.type,
          bytes: file.size,
          kind: attachmentKind(file.type),
          source: 'web',
          capturedAt: Date.now()
        });
      }
      setAttachments(prev => [...prev, ...uploaded]);
    } catch (e: any) {
      setError(e.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const submit = async (decision: AskDecision | undefined, kind: AskDecision | 'answer') => {
    if (decision === 'revise' && !comment.trim()) {
      setError('Say what needs to change — your comment becomes the instruction for the redo.');
      return;
    }
    setError(null);
    setSubmitting(kind);
    try {
      await onSubmit({
        decision,
        text: comment.trim() || undefined,
        values: Object.keys(values).length ? values : undefined,
        attachments: attachments.length ? attachments : undefined
      });
    } catch (e: any) {
      setError(e.message || 'Could not submit');
      setSubmitting(null);
    }
  };

  const busy = submitting !== null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[110] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl border border-slate-200 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-6 border-b border-slate-100 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="bg-indigo-50 text-indigo-700 text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wide">
                {ask.kind === 'approval' ? 'Review' : ask.kind}
              </span>
              {(ask.revision ?? 0) > 0 && (
                <span className="bg-violet-50 text-violet-700 text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wide flex items-center gap-1">
                  <RotateCcw size={10} /> Revision {ask.revision}
                </span>
              )}
              {overdue && (
                <span className="bg-rose-50 text-rose-700 text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wide flex items-center gap-1">
                  <Clock size={10} /> Overdue
                </span>
              )}
            </div>
            <h3 className="text-xl font-black text-slate-900 truncate">{nodeName}</h3>
            <p className="text-xs text-slate-500 font-medium truncate">
              {projectName} · asked {relative(ask.createdAt)}
              {(ask.assignees || []).length > 0 && ` · for ${(ask.assignees || []).join(', ')}`}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors shrink-0">
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-5">
          <p className="text-sm text-slate-700 font-medium bg-slate-50 border border-slate-200 rounded-xl p-3">{ask.prompt}</p>

          {/* The work product itself */}
          {artifact && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                  <FileText size={12} /> {artifact.title || 'Work product'}
                </div>
                <div className="flex items-center gap-3">
                  {artifact.previousContent && (
                    <button
                      onClick={() => setShowPrevious(v => !v)}
                      className="text-[11px] font-bold text-violet-600 hover:text-violet-700"
                    >
                      {showPrevious ? 'Hide previous draft' : 'Compare with previous draft'}
                    </button>
                  )}
                  {artifact.url && (
                    <a
                      href={artifact.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                    >
                      Open <ExternalLink size={11} />
                    </a>
                  )}
                </div>
              </div>

              <div className={`grid gap-3 ${showPrevious && artifact.previousContent ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
                {showPrevious && artifact.previousContent && (
                  <div className="bg-rose-50/40 border border-rose-100 rounded-xl p-4 max-h-80 overflow-y-auto">
                    <div className="text-[10px] font-black text-rose-500 uppercase tracking-widest mb-2">Previous draft</div>
                    <Markdown content={artifact.previousContent} />
                  </div>
                )}
                <div className="bg-white border border-slate-200 rounded-xl p-4 max-h-80 overflow-y-auto">
                  {showPrevious && artifact.previousContent && (
                    <div className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-2">Current draft</div>
                  )}
                  {artifact.kind === 'markdown' && <Markdown content={artifact.content || ''} />}
                  {artifact.kind === 'text' && <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{artifact.content}</p>}
                  {artifact.kind === 'json' && (
                    <pre className="text-[11px] font-mono text-slate-700 whitespace-pre-wrap">{artifact.content}</pre>
                  )}
                  {artifact.kind === 'link' && (
                    <a href={artifact.url} target="_blank" rel="noopener noreferrer" className="text-sm text-indigo-600 font-bold">
                      {artifact.url}
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* The agent's own critique — computed during generation, previously discarded */}
          {artifact?.evaluation && (
            <div className="bg-amber-50/60 border border-amber-100 rounded-xl p-4">
              <div className="text-[10px] font-black text-amber-700 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <Sparkles size={12} /> The agent's own assessment
              </div>
              {artifact.evaluation.passes_criteria !== undefined && (
                <div className={`text-xs font-bold mb-2 flex items-center gap-1.5 ${artifact.evaluation.passes_criteria ? 'text-emerald-700' : 'text-amber-800'}`}>
                  {artifact.evaluation.passes_criteria
                    ? <><Check size={12} /> It believes this meets the criteria</>
                    : <><AlertTriangle size={12} /> It flagged this as not yet meeting the criteria</>}
                </div>
              )}
              {artifact.evaluation.evaluation && (
                <p className="text-xs text-slate-700 leading-relaxed mb-2">{artifact.evaluation.evaluation}</p>
              )}
              {Array.isArray(artifact.evaluation.revisions_needed) && artifact.evaluation.revisions_needed.length > 0 && (
                <ul className="list-disc pl-5 space-y-0.5">
                  {artifact.evaluation.revisions_needed.map((r: string, i: number) => (
                    <li key={i} className="text-xs text-slate-600">{r}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Structured answer fields */}
          {(ask.fields || []).length > 0 && (
            <div className="space-y-3">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Your answer</div>
              {ask.fields!.map(field => (
                <div key={field.name}>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    {field.label || field.name}
                    {field.required && <span className="text-rose-500 ml-1">*</span>}
                  </label>
                  {field.options?.length ? (
                    <select
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                      value={values[field.name] ?? ''}
                      onChange={e => setValues(v => ({ ...v, [field.name]: e.target.value }))}
                    >
                      <option value="">— select —</option>
                      {field.options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                      value={values[field.name] ?? ''}
                      onChange={e => setValues(v => ({ ...v, [field.name]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Comment */}
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
              <MessageSquare size={12} /> Comment
              <span className="text-slate-300 normal-case tracking-normal font-medium">
                — required when sending work back; it becomes the instruction for the redo
              </span>
            </label>
            <textarea
              className="w-full h-24 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              placeholder="What's right, what needs to change..."
              value={comment}
              onChange={e => setComment(e.target.value)}
            />
          </div>

          {/* Attachments */}
          <div>
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
              <Paperclip size={12} /> Attach a file
            </div>
            <label className={`flex items-center justify-center gap-2 py-3 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${uploading ? 'border-slate-200 text-slate-400' : 'border-slate-200 hover:border-indigo-300 text-slate-500 hover:text-indigo-600'}`}>
              {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              <span className="text-xs font-bold">{uploading ? 'Uploading...' : 'Image, document, video or audio'}</span>
              <input type="file" multiple className="hidden" disabled={uploading} onChange={e => handleUpload(e.target.files)} />
            </label>
            {attachments.length > 0 && (
              <div className="mt-2 space-y-1">
                {attachments.map(a => (
                  <div key={a.id} className="flex items-center gap-2 text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
                    <Paperclip size={11} className="text-slate-400 shrink-0" />
                    <span className="flex-1 truncate font-medium text-slate-700">{a.name}</span>
                    <button onClick={() => setAttachments(prev => prev.filter(x => x.id !== a.id))} className="text-slate-400 hover:text-rose-500">
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* What's already been said */}
          {(ask.responses || []).length > 0 && (
            <div>
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">History</div>
              <div className="space-y-2">
                {(ask.responses || []).map(r => (
                  <div key={r.id} className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-[10px] font-bold text-slate-600">{r.actor}</span>
                      <span className="text-[10px] text-slate-400 uppercase font-bold bg-white border border-slate-200 rounded px-1.5">{r.via}</span>
                      {r.decision && (
                        <span className={`text-[10px] font-black uppercase px-1.5 rounded ${
                          r.decision === 'approved' ? 'bg-emerald-100 text-emerald-700'
                          : r.decision === 'revise' ? 'bg-amber-100 text-amber-700'
                          : 'bg-rose-100 text-rose-700'}`}>
                          {r.decision}
                        </span>
                      )}
                      {r.needsInterpretation && (
                        <span className="text-[10px] font-black uppercase px-1.5 rounded bg-slate-200 text-slate-600">needs interpretation</span>
                      )}
                      <span className="text-[10px] text-slate-400 ml-auto">{relative(r.at)}</span>
                    </div>
                    {r.text && <p className="text-xs text-slate-600 whitespace-pre-wrap">{r.text}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {priorAttachments.length > 0 && (
            <div>
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Files supplied</div>
              <div className="grid grid-cols-2 gap-2">
                {priorAttachments.map(a => (
                  <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer"
                     className="flex items-center gap-2 text-xs bg-white border border-slate-200 rounded-lg px-3 py-2 hover:border-indigo-300">
                    <Paperclip size={11} className="text-slate-400 shrink-0" />
                    <span className="truncate font-medium text-slate-700">{a.name || a.url}</span>
                    <span className="text-[9px] uppercase text-slate-400 ml-auto">{a.source}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-xl p-3">{error}</div>
          )}
        </div>

        {/* Actions */}
        <div className="p-5 border-t border-slate-100 shrink-0">
          {ask.kind === 'approval' ? (
            <div className="grid grid-cols-3 gap-2">
              <button
                disabled={busy}
                onClick={() => submit('approved', 'approved')}
                className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold px-3 py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 transition"
              >
                {submitting === 'approved' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Approve
              </button>
              <button
                disabled={busy}
                onClick={() => submit('revise', 'revise')}
                className="bg-amber-100 hover:bg-amber-200 disabled:opacity-50 text-amber-900 border border-amber-200 font-bold px-3 py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 transition"
              >
                {submitting === 'revise' ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Request changes
              </button>
              <button
                disabled={busy}
                onClick={() => submit('rejected', 'rejected')}
                className="bg-rose-50 hover:bg-rose-100 disabled:opacity-50 text-rose-700 border border-rose-200 font-bold px-3 py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 transition"
              >
                {submitting === 'rejected' ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />} Reject
              </button>
            </div>
          ) : (
            <button
              disabled={busy}
              onClick={() => submit(undefined, 'answer')}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold px-4 py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 transition"
            >
              {submitting === 'answer' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Submit answer
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
