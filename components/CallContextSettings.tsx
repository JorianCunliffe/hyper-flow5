import React from 'react';

/** Edits the same generic action template consumed by the server and API. */
export function CallContextSettings({ template, onChange }: { template: string; onChange: (template: string) => void }) {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(template);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return <p>Use a JSON object to configure call context.</p>;
  } catch { return <p>Use a JSON object to configure call context.</p>; }
  const update = (changes: Record<string, unknown>) => onChange(JSON.stringify({ ...value, ...changes }, null, 2));
  return <fieldset className="mt-3 border rounded-lg p-3 space-y-2 text-xs">
    <legend className="font-bold">Contact and conversation context</legend>
    <label className="block"><input type="checkbox" checked={value.contact_context === true} onChange={e => update({ contact_context: e.target.checked })} /> Include recipient contact details</label>
    <p>Resolve the destination number to one permitted contact. Available fields: <code>{'{{recipient.id}}'}</code>, <code>{'{{recipient.name}}'}</code>, <code>{'{{recipient.email}}'}</code>, <code>{'{{recipient.phone}}'}</code>. Use them in the greeting or instructions. Missing referenced fields stop the call.</p>
    <label className="block">Conversation history <select className="border rounded p-1" value={String(value.history_scope || 'legacy')} onChange={e => update({ history_scope: e.target.value === 'legacy' ? undefined : e.target.value, history_thread_id: undefined })}>
      <option value="legacy">Existing automatic selection</option>
      <option value="none">None</option>
      <option value="project">This contact in this project</option>
      <option value="thread">One selected thread</option>
    </select></label>
    {value.history_scope === 'thread' && <label className="block">Conversation thread ID <input className="block w-full border rounded p-1" value={String(value.history_thread_id || '')} onChange={e => update({ history_thread_id: e.target.value })} /></label>}
    <label className="block">Opening greeting <input className="block w-full border rounded p-1" placeholder="Hi {{recipient.name}}, is now a good time?" value={String(value.greeting || '')} onChange={e => update({ greeting: e.target.value })} /></label>
    <p>Contact fields resolve at dispatch and are not part of the saved-data preview below. History supplies bounded, permitted evidence to the agent; unavailable history is reported. Tenant history settings still apply. Test calls never receive history.</p>
  </fieldset>;
}
