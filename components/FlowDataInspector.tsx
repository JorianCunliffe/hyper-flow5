import React, { useState } from 'react';
import type { Milestone } from '../types';
import { listFlowDataPaths } from '../lib/flowInputs';
import { readFlowPath, renderActionTemplate } from '../lib/flowData';
import { cloudConflictPreview } from '../lib/cloudMerge';

export const FlowDataInspector = ({ data, milestones, template }: { data: Record<string, unknown>; milestones: Milestone[]; template: string }) => {
  const [path, setPath] = useState('');
  const paths = listFlowDataPaths(data);
  let preview = '';
  let error = '';
  try { preview = cloudConflictPreview(renderActionTemplate(template || '{}', data).templateData); }
  catch (e) { error = e instanceof Error ? e.message : 'Invalid template'; }
  let selected = '';
  try { if (path) selected = cloudConflictPreview({ [path]: readFlowPath(data, path) }); }
  catch { selected = 'Not available in the displayed project data.'; }
  return <details className="mt-3 border rounded-lg p-3 text-xs">
    <summary className="cursor-pointer font-bold">Available data and input preview</summary>
    <p className="mt-2">This previews saved project data. Execution uses the current run snapshot. Values shown here may be from an earlier run; use Require fresh results for live facts.</p>
    <label className="block mt-2">Data field<select className="block w-full border rounded p-2" value={path} onChange={e => setPath(e.target.value)}><option value="">Select a field</option>{paths.map(p => <option key={p} value={p}>{p}</option>)}</select></label>
    {path && <><input aria-label="Reference to copy" className="w-full border p-2 mt-2 font-mono" readOnly value={`{{${path}}}`} onFocus={e => e.currentTarget.select()} /><pre className="whitespace-pre-wrap break-words max-h-48 overflow-auto">{selected}</pre></>}
    <p className="font-bold mt-3">Named node outputs</p>
    <ul>{milestones.filter(m => m.actionConfig?.resultVariable).map(m => <li key={m.id}>{m.name}: <code>{m.actionConfig!.resultVariable}_output</code> · status: <code>{m.actionConfig!.resultVariable}</code></li>)}</ul>
    <p className="font-bold mt-3">Resolved template preview (first 4,000 characters; credentials redacted)</p>
    {error ? <p role="status" className="text-amber-800">{error}</p> : <pre className="whitespace-pre-wrap break-words max-h-64 overflow-auto">{preview}</pre>}
  </details>;
};
