import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { firebaseService } from '../../services/firebaseService';
import type { DraftPreview } from '../../lib/triage/draftPreview';

export const loadMailboxDraftPreview = async (itemId: string): Promise<DraftPreview> => {
  const response = await firebaseService.authorizedFetch(`/api/triage?scope=draft&id=${encodeURIComponent(itemId)}`, { cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Unable to load draft');
  return body.draft;
};

// A template is inert: no scripts execute, links navigate or remote images load.
// Display only text, including for provider drafts that contain HTML signatures.
export const draftBodyText = (draft: DraftPreview): string => {
  if (draft.bodyType === 'text') return draft.body;
  const template = document.createElement('template');
  template.innerHTML = draft.body;
  template.content.querySelectorAll('script,style,iframe,object,template').forEach(node => node.remove());
  template.content.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
  template.content.querySelectorAll('p,div,li,tr,h1,h2,h3').forEach(node => node.append('\n'));
  return template.content.textContent?.trim() || '';
};

export const MailboxDraftPreview: React.FC<{
  itemId: string;
  load?: (itemId: string) => Promise<DraftPreview>;
}> = ({ itemId, load = loadMailboxDraftPreview }) => {
  const [revision, setRevision] = useState(0);
  const [draft, setDraft] = useState<DraftPreview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true); setDraft(null); setError('');
    load(itemId).then(value => { if (active) setDraft(value); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to load draft'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [itemId, revision, load]);
  const text = useMemo(() => draft ? draftBodyText(draft) : '', [draft]);
  return <section aria-label="Mailbox draft preview" className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-slate-700">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="font-bold">Mailbox draft</h3>
      <div className="flex gap-3">
        {draft?.webUrl && <a href={draft.webUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-bold text-indigo-600"><ExternalLink size={14} />Open in Outlook</a>}
        <button type="button" disabled={loading} onClick={() => setRevision(value => value + 1)} className="inline-flex items-center gap-1 text-sm text-indigo-600 disabled:opacity-50"><RefreshCw size={14} />Refresh draft</button>
      </div>
    </div>
    {loading && <p role="status" className="mt-3 text-sm">Loading current draft from the mailbox…</p>}
    {error && <p role="alert" className="mt-3 text-sm text-amber-700">{error}</p>}
    {draft && <>
      <dl className="mt-4 space-y-1 break-words text-sm">
        <div><dt className="inline font-bold">To: </dt><dd className="inline">{draft.to.join(', ') || 'No recipients'}</dd></div>
        {draft.cc.length > 0 && <div><dt className="inline font-bold">Cc: </dt><dd className="inline">{draft.cc.join(', ')}</dd></div>}
        {draft.bcc.length > 0 && <div><dt className="inline font-bold">Bcc: </dt><dd className="inline">{draft.bcc.join(', ')}</dd></div>}
        <div><dt className="inline font-bold">Subject: </dt><dd className="inline">{draft.subject || '(No subject)'}</dd></div>
      </dl>
      <div className="mt-4 whitespace-pre-wrap break-words border-t border-slate-100 pt-4 text-sm leading-6">{text || '(Empty draft)'}</div>
      <p className="mt-4 text-xs text-slate-500">Read from {draft.provider === 'outlook' ? 'Outlook' : 'Gmail'} at {new Date(draft.fetchedAt).toLocaleTimeString()}. Review and edit in your mailbox. Nothing is sent from this preview.</p>
      {draft.truncated && <p className="mt-2 text-xs text-amber-700">This long draft is truncated. Review the complete draft in your mailbox.</p>}
      {!draft.webUrl && <p className="mt-2 text-xs text-slate-500">Open your mailbox’s Drafts folder to edit this draft.</p>}
    </>}
  </section>;
};
