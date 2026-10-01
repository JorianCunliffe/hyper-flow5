import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { firebaseService } from '../../services/firebaseService';
import type { DraftPreview } from '../../lib/triage/draftPreview';

export const RecoverMailboxDraft: React.FC<{ itemId: string }> = ({ itemId }) => {
  const [recovered, setRecovered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (recovered) return <MailboxDraftPreview itemId={itemId} />;
  const recover = async () => {
    setBusy(true); setError('');
    try {
      const response = await firebaseService.authorizedFetch('/api/triage?scope=draft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: itemId })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to recover draft linkage');
      setRecovered(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to recover draft linkage'); }
    finally { setBusy(false); }
  };
  return <div className="mt-3 text-sm">
    <p>The saved draft needs to be linked to this email. Recovery verifies the existing draft without creating or sending an email.</p>
    <button type="button" disabled={busy} onClick={() => void recover()} className="mt-2 font-bold text-indigo-700 disabled:opacity-50">{busy ? 'Verifying draft…' : 'Recover existing draft'}</button>
    {error && <p role="alert" className="mt-2 text-amber-700">{error}</p>}
  </div>;
};

export const loadMailboxDraftPreview = async (itemId: string): Promise<DraftPreview> => {
  const response = await firebaseService.authorizedFetch(`/api/triage?scope=draft&id=${encodeURIComponent(itemId)}`, { cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Unable to load draft');
  return body.draft;
};

export const adoptMailboxDraftBaseline = async (itemId: string, draft: DraftPreview): Promise<void> => {
  const response = await firebaseService.authorizedFetch('/api/triage?scope=draft', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: itemId, action: 'adopt_baseline', contentHash: draft.contentHash, revision: draft.revision })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Unable to approve this draft');
};

export const recoverReviewedMailboxDraft = async (itemId: string, draft: DraftPreview, failedReceiptId: string): Promise<void> => {
  const response = await firebaseService.authorizedFetch('/api/triage?scope=draft', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: itemId, action: 'recover_update', contentHash: draft.contentHash, revision: draft.revision, failedReceiptId })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Unable to recover this draft update');
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
  adopt?: (itemId: string, draft: DraftPreview) => Promise<void>;
}> = ({ itemId, load = loadMailboxDraftPreview, adopt = adoptMailboxDraftBaseline }) => {
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState('');
  const [revision, setRevision] = useState(0);
  const [draft, setDraft] = useState<DraftPreview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [failedReceiptId, setFailedReceiptId] = useState('');
  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  const [recovered, setRecovered] = useState(false);
  useEffect(() => { setFailedReceiptId(''); setRecoveryError(''); setRecovered(false); }, [itemId]);
  useEffect(() => {
    let active = true;
    setLoading(true); setDraft(null); setError('');
    load(itemId).then(value => { if (active) setDraft(value); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to load draft'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [itemId, revision, load]);
  const text = useMemo(() => draft ? draftBodyText(draft) : '', [draft]);
  const approve = async () => {
    if (!draft) return;
    setApproving(true); setApproveError('');
    try { await adopt(itemId, draft); setRevision(value => value + 1); }
    catch (reason) { setApproveError(reason instanceof Error ? reason.message : 'Unable to approve this draft'); }
    finally { setApproving(false); }
  };
  const recover = async () => {
    if (!draft || draft.truncated) return;
    setRecovering(true); setRecoveryError('');
    try {
      await recoverReviewedMailboxDraft(itemId, draft, failedReceiptId.trim());
      setRecovered(true); setFailedReceiptId(''); setRevision(value => value + 1);
    } catch (reason) { setRecoveryError(reason instanceof Error ? reason.message : 'Unable to recover this draft update'); }
    finally { setRecovering(false); }
  };
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
      <details className="mt-4 text-xs text-slate-500">
        <summary className="cursor-pointer">Draft verification details</summary>
        <pre className="mt-2 whitespace-pre-wrap break-words">{JSON.stringify(draft, null, 2)}</pre>
      </details>
      {draft.baselineRequired && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <p>HyperFlow has no saved version of this draft, so workflow updates to it are on hold. Check the content above is the draft HyperFlow may replace, then approve it. Approval saves this exact version. It does not edit or send the draft.</p>
        {draft.contentHash && draft.revision
          ? <button type="button" disabled={approving} onClick={() => void approve()} className="mt-2 font-bold text-indigo-700 disabled:opacity-50">{approving ? 'Approving…' : 'Approve this draft for updates'}</button>
          : <p className="mt-2">The mailbox service must be updated before this draft can be approved.</p>}
        {approveError && <p role="alert" className="mt-2 text-amber-700">{approveError}</p>}
      </div>}
      {recovered && <p role="status" className="mt-3 text-sm text-emerald-700">The original draft update was recovered and remains unsent. The paused workflow can continue.</p>}
      {draft.provider === 'outlook' && draft.contentHash && draft.revision && !draft.truncated && <details className="mt-4 rounded-lg border border-slate-200 p-3 text-sm">
        <summary className="cursor-pointer font-bold">Recover a rejected draft update</summary>
        <p className="mt-2">Administrator recovery replaces the current draft above with the saved content of an update rejected because the mailbox version changed. Review both versions before proceeding. The original draft and failure history are preserved; nothing is sent.</p>
        <label className="mt-3 block">Rejected update receipt ID<input aria-label="Rejected update receipt ID" className="mt-1 block w-full rounded border p-2" value={failedReceiptId} onChange={event => setFailedReceiptId(event.target.value)} disabled={recovering} /></label>
        <button type="button" onClick={() => void recover()} disabled={recovering || loading || !failedReceiptId.trim()} className="mt-2 font-bold text-indigo-700 disabled:opacity-50">{recovering ? 'Recovering draft update…' : 'Recover reviewed draft update'}</button>
        {recoveryError && <p role="alert" className="mt-2 text-amber-700">{recoveryError}</p>}
      </details>}
    </>}
  </section>;
};
