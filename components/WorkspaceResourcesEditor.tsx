import React, { useEffect, useState } from 'react';
import type { Project, WorkspaceNamedResource, WorkspaceConnectionRef, WorkspaceResourceGrant } from '../types';
import { firebaseService } from '../services/firebaseService';

const request = async (url: string, method = 'GET', value?: unknown) => {
  const response = await firebaseService.authorizedFetch(url, { method, ...(value ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) } : {}) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
};

/** Edits the same protected resource catalog used by the server action boundary. */
export function WorkspaceResourcesEditor({ projects, connections }: { projects: Project[]; connections: WorkspaceConnectionRef[] }) {
  const [projectId, setProjectId] = useState('');
  const [connectionId, setConnectionId] = useState('');
  const [grant, setGrant] = useState<Partial<WorkspaceResourceGrant>>({});
  const [resources, setResources] = useState<WorkspaceNamedResource[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => {
    let active = true;
    setLoaded(false); setResources([]); setGrant({}); setConnectionId(''); setStatus('');
    if (!projectId) return;
    setBusy(true);
    Promise.all([
      request(`/api/integrations/google/grant?projectId=${encodeURIComponent(projectId)}`),
      request(`/api/triage?scope=workspace_resources&projectId=${encodeURIComponent(projectId)}`)
    ]).then(([base, catalog]) => {
      if (!active) return;
      setGrant(base.grant || {}); setConnectionId(base.grant?.connectionId || '');
      setResources(catalog.resources || []); setLoaded(true);
    }).catch(error => { if (active) setStatus(error.message); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [projectId]);
  const change = (index: number, patch: Partial<WorkspaceNamedResource>) => setResources(rows => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  const save = async () => {
    setBusy(true); setStatus('');
    try {
      const names = new Set<string>();
      for (const row of resources) {
        if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(row.name) || names.has(row.name.toLowerCase())) throw new Error('Use a unique name for each resource.');
        names.add(row.name.toLowerCase());
        if (!row.permissions?.length) throw new Error('Select at least one permitted operation.');
        if (!/^[A-Za-z0-9_-]{10,200}$/.test((row.type === 'google_doc' ? row.documentId : row.spreadsheetId) || '')) throw new Error('Enter a Google file ID for each resource.');
        if (row.type === 'google_sheet_range' && !row.range?.trim()) throw new Error('Enter a range for each Sheet resource.');
      }
      // Persist connection first. Never erase existing legacy Doc/Sheet defaults.
      await request('/api/integrations/google/grant', 'PUT', { ...grant, projectId, connectionId });
      const result = await request('/api/triage?scope=workspace_resources', 'PATCH', { projectId, resources });
      setResources(result.resources); setStatus('Named resources saved.');
    } catch (error: any) { setStatus(error.message); }
    finally { setBusy(false); }
  };
  return <section className="space-y-3 border-t pt-6" aria-label="Named project resources">
    <h5 className="font-black">Named project resources</h5>
    <p className="text-sm">Give each document or Sheet range a name, such as tasks or enquiries, and select its permitted operations. Nodes use these names.</p>
    <select className="border rounded-lg px-3 py-2 text-sm mr-2" aria-label="Named resources project" value={projectId} disabled={busy} onChange={e => setProjectId(e.target.value)}><option value="">Choose project</option>{projects.filter(p => !p.isArchived).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
    <select className="border rounded-lg px-3 py-2 text-sm mr-2" aria-label="Named resources Google connection" value={connectionId} disabled={busy || !loaded} onChange={e => setConnectionId(e.target.value)}><option value="">Choose Google connection</option>{connections.filter(c => c.state === 'connected').map(c => <option key={c.id} value={c.id}>{c.accountEmail}</option>)}</select>
    {resources.map((row, index) => <fieldset key={index} disabled={busy} className="rounded border p-3 space-y-2">
      <legend>Resource {index + 1}</legend>
      <input className="border rounded-lg px-3 py-2 text-sm mr-2" aria-label={`Resource ${index + 1} name`} placeholder="enquiries" value={row.name} onChange={e => change(index, { name: e.target.value })} />
      <select className="border rounded-lg px-3 py-2 text-sm mr-2" aria-label={`Resource ${index + 1} type`} value={row.type} onChange={e => change(index, { type: e.target.value as WorkspaceNamedResource['type'], permissions: ['read'] })}><option value="google_sheet_range">Sheet range</option><option value="google_doc">Document</option></select>
      <input className="border rounded-lg px-3 py-2 text-sm mr-2" aria-label={`Resource ${index + 1} file ID`} placeholder="Google file ID" value={row.type === 'google_doc' ? row.documentId || '' : row.spreadsheetId || ''} onChange={e => change(index, row.type === 'google_doc' ? { documentId: e.target.value } : { spreadsheetId: e.target.value })} />
      {row.type === 'google_sheet_range' && <input className="border rounded-lg px-3 py-2 text-sm mr-2" aria-label={`Resource ${index + 1} range`} placeholder="Enquiries!A2:J" value={row.range || ''} onChange={e => change(index, { range: e.target.value })} />}
      {(row.type === 'google_doc' ? ['read'] as const : ['read', 'append', 'upsert'] as const).map(permission => <label key={permission} className="inline-flex gap-1 mr-3"><input type="checkbox" checked={row.permissions?.includes(permission) || false} onChange={e => change(index, { permissions: e.target.checked ? [...(row.permissions || []), permission] : (row.permissions || []).filter(p => p !== permission) })} />{permission}</label>)}
      <button className="border rounded-lg px-3 py-2 text-sm mr-2 disabled:opacity-50" type="button" onClick={() => setResources(rows => rows.filter((_, i) => i !== index))}>Remove resource</button>
    </fieldset>)}
    <button className="border rounded-lg px-3 py-2 text-sm mr-2 disabled:opacity-50" type="button" disabled={busy || !loaded || resources.length >= 25} onClick={() => setResources(rows => [...rows, { name: '', type: 'google_sheet_range', spreadsheetId: '', range: '', permissions: ['read'] }])}>Add named resource</button>
    <button className="border rounded-lg px-3 py-2 text-sm mr-2 disabled:opacity-50" type="button" disabled={busy || !loaded || !connectionId} onClick={() => void save()}>Save named resources</button>
    <p role="status">{busy ? 'Loading or saving resources…' : status}</p>
  </section>;
}
