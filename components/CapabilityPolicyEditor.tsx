import React, { useEffect, useState } from 'react';
import type { CapabilityPolicyMode } from '../types';
import { firebaseService } from '../services/firebaseService';

const capabilities = [['email.draft', 'Mailbox drafts'], ['email.send', 'Send email'], ['sms.send', 'Send SMS'], ['phone.call', 'Place calls'], ['sheet.append', 'Append Sheet rows'], ['sheet.upsert', 'Update Sheet rows']] as const;
export function CapabilityPolicyEditor() {
  const [policy, setPolicy] = useState<Record<string, CapabilityPolicyMode>>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    firebaseService.authorizedFetch('/api/triage?scope=capabilities').then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not load capability policy');
      if (active) { setPolicy(body.policy || {}); setLoaded(true); }
    }).catch(error => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, []);
  const save = async () => {
    setBusy(true); setMessage('');
    try {
      const response = await firebaseService.authorizedFetch('/api/triage?scope=capabilities', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ policy }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not save capability policy');
      setPolicy(body.policy); setMessage('Capability policy saved.');
    } catch (error: any) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  return <section aria-label="Workflow capability policy" className="space-y-3 border-t pt-4">
    <h5 className="font-bold">Workflow capability policy</h5>
    <p className="text-xs text-slate-500">Set independent permissions for SMS, calls, drafts and email. Project grants, contact limits and the project email switch still apply.</p>
    <div className="grid grid-cols-2 gap-3">{capabilities.map(([key, label]) => <label key={key} className="text-xs">{label}<select className="block w-full border rounded p-2" aria-label={`${label} permission`} disabled={!loaded || busy} value={policy[key] || ''} onChange={event => setPolicy(prior => {
      const next = { ...prior }; if (event.target.value) next[key] = event.target.value as CapabilityPolicyMode; else delete next[key]; return next;
    })}><option value="">Use automatic-action setting</option><option value="approval">Require approval</option><option value="automatic">Automatic</option><option value="denied">Disabled</option></select></label>)}</div>
    <button type="button" className="border rounded px-3 py-2 text-sm" disabled={!loaded || busy} onClick={() => void save()}>Save capability policy</button>
    <p role="status">{message}</p>
  </section>;
}
