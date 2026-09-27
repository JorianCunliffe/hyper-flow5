import React, { useState } from 'react';
import { firebaseService } from '../services/firebaseService';
import type { CommunicationsPersonRef } from '../lib/communications/types';

export function ContactCreator({ onCreated }: { onCreated: (person: CommunicationsPersonRef) => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function save() {
    setBusy(true); setMessage('');
    try {
      const response = await firebaseService.authorizedFetch('/api/communications/contacts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), phone_number: phone.trim() })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Contact creation failed');
      onCreated(result.person);
      setMessage(`${result.person.name} (${result.person.phone}) ${result.created ? 'created' : 'already exists'}. Contact ID: ${result.person.id}`);
      setName(''); setPhone('');
    } catch (error: any) { setMessage(error.message || 'Contact creation failed'); }
    finally { setBusy(false); }
  }
  return <fieldset className="mb-6 rounded-xl border border-slate-200 p-4">
    <legend className="font-bold">Add Communications contact</legend>
    <p className="mb-3 text-sm text-slate-600">Owners and administrators can add a contact. Project access is assigned separately.</p>
    <div className="flex flex-wrap gap-3">
      <label>Name<input className="block rounded border p-2" value={name} onChange={e => setName(e.target.value)} disabled={busy} maxLength={200} /></label>
      <label>Phone (international format)<input className="block rounded border p-2" type="tel" placeholder="+61400000000" value={phone} onChange={e => setPhone(e.target.value)} disabled={busy} /></label>
      <button type="button" className="rounded bg-indigo-600 px-4 py-2 text-white disabled:opacity-50" onClick={save} disabled={busy || !name.trim() || !/^\+[1-9]\d{7,14}$/.test(phone.trim())}>{busy ? 'Adding…' : 'Add contact'}</button>
    </div>
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
  </fieldset>;
}
