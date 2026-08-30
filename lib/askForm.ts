import type { HumanAsk } from '../types.js';

const escapeHtml = (value: unknown): string => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

const renderArtifact = (artifact: HumanAsk['artifact']): string => {
  if (!artifact) return '';
  const title = artifact.title ? `<h2>${escapeHtml(artifact.title)}</h2>` : '<h2>Work product</h2>';
  const safeUrl = (() => {
    try {
      const url = new URL(String(artifact.url || ''));
      return url.protocol === 'https:' ? url.toString() : '';
    } catch { return ''; }
  })();
  const content = artifact.kind === 'json'
    ? (() => { try { return JSON.stringify(JSON.parse(artifact.content || '{}'), null, 2); } catch { return artifact.content || ''; } })()
    : artifact.content || '';
  const body = safeUrl && ['link', 'file'].includes(artifact.kind)
    ? `<p><a href="${escapeHtml(safeUrl)}" rel="noopener noreferrer" target="_blank">Open ${escapeHtml(artifact.title || 'artifact')}</a></p>`
    : `<pre class="artifact-content">${escapeHtml(content)}</pre>`;
  const previous = artifact.previousContent
    ? `<details><summary>Previous revision</summary><pre class="artifact-content">${escapeHtml(artifact.previousContent)}</pre></details>` : '';
  const evaluation = artifact.evaluation === undefined
    ? '' : `<details><summary>Agent evaluation</summary><pre class="artifact-content">${escapeHtml(typeof artifact.evaluation === 'string' ? artifact.evaluation : JSON.stringify(artifact.evaluation, null, 2))}</pre></details>`;
  return `<section class="artifact">${title}${body}${previous}${evaluation}</section>`;
};

export const renderAskForm = (input: {
  ask: HumanAsk;
  projectName: string;
  nodeName: string;
}): string => {
  const { ask } = input;
  const fields = (ask.fields || []).map(field => {
    if (field.type === 'boolean') {
      return `<label>${escapeHtml(field.label || field.name)}<select name="${escapeHtml(field.name)}" ${field.required ? 'required' : ''}><option value="">Select</option><option value="true">Yes</option><option value="false">No</option></select></label>`;
    }
    if (field.type === 'file') {
      return `<label>${escapeHtml(field.label || field.name)}<input name="${escapeHtml(field.name)}" type="file" accept=".pdf,.txt,.csv,.png,.jpg,.jpeg,.webp,.docx,.xlsx" ${field.required ? 'required' : ''}><span class="help">Maximum 2 MB.</span></label>`;
    }
    if (Array.isArray(field.options) && field.options.length) {
      return `<label>${escapeHtml(field.label || field.name)}<select name="${escapeHtml(field.name)}" ${field.required ? 'required' : ''}><option value="">Select</option>${field.options.map(option => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('')}</select></label>`;
    }
    const type = field.type === 'number' || field.type === 'date' ? field.type : 'text';
    return `<label>${escapeHtml(field.label || field.name)}<input name="${escapeHtml(field.name)}" type="${type}" ${field.required ? 'required' : ''}></label>`;
  }).join('');
  const decision = ask.kind === 'approval'
    ? '<label>Decision<select name="decision" required><option value="">Select</option><option value="approved">Approve</option><option value="revise">Return for revision</option><option value="rejected">Reject</option></select></label>'
    : '';
  const closed = ask.status !== 'open';
  const valueFields = (ask.fields || []).filter(field => field.type !== 'file').map(field => field.name);
  const fileFields = (ask.fields || []).filter(field => field.type === 'file').map(field => field.name);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'"><title>HyperFlow response</title><style>body{margin:0;background:#f8fafc;color:#0f172a;font:16px system-ui,sans-serif}.card{max-width:760px;margin:6vh auto;padding:32px;background:white;border:1px solid #e2e8f0;border-radius:14px;box-shadow:0 10px 30px #0f172a12}h1{margin:0 0 8px}h2{font-size:18px}.meta{color:#64748b;margin-bottom:24px}.prompt{white-space:pre-wrap;padding:16px;background:#f1f5f9;border-radius:8px}.artifact{margin:24px 0;padding:18px;border:1px solid #cbd5e1;border-radius:10px}.artifact-content{max-height:420px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:#f8fafc;padding:14px;border-radius:8px}details{margin-top:12px}label{display:block;margin:16px 0;font-weight:600}.help{display:block;color:#64748b;font-size:12px;margin-top:4px}input,select,textarea{box-sizing:border-box;width:100%;margin-top:6px;padding:11px;border:1px solid #cbd5e1;border-radius:7px;font:inherit}textarea{min-height:120px}button{padding:12px 18px;border:0;border-radius:8px;background:#4f46e5;color:white;font-weight:700;cursor:pointer}.status{margin-top:16px}</style></head><body><main class="card"><h1>HyperFlow response</h1><div class="meta">${escapeHtml(input.projectName)} · ${escapeHtml(input.nodeName)}</div><div class="prompt">${escapeHtml(ask.prompt)}</div>${renderArtifact(ask.artifact)}${closed ? `<p class="status">This request is ${escapeHtml(ask.status)}.</p>` : `<form id="ask-form">${decision}${fields}<label>Comment<textarea name="text"></textarea></label><button type="submit">Submit response</button></form><p id="status" class="status" aria-live="polite"></p>`}<script>const form=document.getElementById('ask-form');const toBase64=async(file)=>{const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary)};if(form)form.addEventListener('submit',async(e)=>{e.preventDefault();const status=document.getElementById('status');status.textContent='Submitting…';const data=new FormData(form),values={},uploads=[];${JSON.stringify(valueFields)}.forEach(name=>{const value=data.get(name);if(value!==null&&value!=='')values[name]=value==='true'?true:value==='false'?false:value});for(const name of ${JSON.stringify(fileFields)}){const file=data.get(name);if(file instanceof File&&file.size){if(file.size>2097152){status.textContent='Each file must be 2 MB or smaller.';return}uploads.push({field:name,name:file.name,mime:file.type||'application/octet-stream',base64:await toBase64(file)})}}const response=await fetch(location.href,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({decision:data.get('decision')||undefined,text:data.get('text')||undefined,values,uploads})});const result=await response.json().catch(()=>({}));if(!response.ok){status.textContent=result.error||'Response failed';return}form.remove();status.textContent='Thank you. Your response has been recorded.';});</script></main></body></html>`;
};
