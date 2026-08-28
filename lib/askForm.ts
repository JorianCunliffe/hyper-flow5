import type { HumanAsk } from '../types.js';

const escapeHtml = (value: unknown): string => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

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
    const type = field.type === 'number' || field.type === 'date' ? field.type : 'text';
    return `<label>${escapeHtml(field.label || field.name)}<input name="${escapeHtml(field.name)}" type="${type}" ${field.required ? 'required' : ''}></label>`;
  }).join('');
  const decision = ask.kind === 'approval'
    ? '<label>Decision<select name="decision" required><option value="">Select</option><option value="approved">Approve</option><option value="revise">Return for revision</option><option value="rejected">Reject</option></select></label>'
    : '';
  const closed = ask.status !== 'open';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'"><title>HyperFlow response</title><style>body{margin:0;background:#f8fafc;color:#0f172a;font:16px system-ui,sans-serif}.card{max-width:680px;margin:6vh auto;padding:32px;background:white;border:1px solid #e2e8f0;border-radius:14px;box-shadow:0 10px 30px #0f172a12}h1{margin:0 0 8px}.meta{color:#64748b;margin-bottom:24px}.prompt{white-space:pre-wrap;padding:16px;background:#f1f5f9;border-radius:8px}label{display:block;margin:16px 0;font-weight:600}input,select,textarea{box-sizing:border-box;width:100%;margin-top:6px;padding:11px;border:1px solid #cbd5e1;border-radius:7px;font:inherit}textarea{min-height:120px}button{padding:12px 18px;border:0;border-radius:8px;background:#4f46e5;color:white;font-weight:700;cursor:pointer}.status{margin-top:16px}</style></head><body><main class="card"><h1>HyperFlow response</h1><div class="meta">${escapeHtml(input.projectName)} · ${escapeHtml(input.nodeName)}</div><div class="prompt">${escapeHtml(ask.prompt)}</div>${closed ? `<p class="status">This request is ${escapeHtml(ask.status)}.</p>` : `<form id="ask-form">${decision}${fields}<label>Comment<textarea name="text"></textarea></label><button type="submit">Submit response</button></form><p id="status" class="status" aria-live="polite"></p>`}<script>const form=document.getElementById('ask-form');if(form)form.addEventListener('submit',async(e)=>{e.preventDefault();const status=document.getElementById('status');status.textContent='Submitting…';const data=new FormData(form),values={};${JSON.stringify((ask.fields || []).map(field => field.name))}.forEach(name=>{const value=data.get(name);if(value!==null&&value!=='')values[name]=value==='true'?true:value==='false'?false:value});const response=await fetch(location.href,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({decision:data.get('decision')||undefined,text:data.get('text')||undefined,values})});const result=await response.json().catch(()=>({}));if(!response.ok){status.textContent=result.error||'Response failed';return}form.remove();status.textContent='Thank you. Your response has been recorded.';});</script></main></body></html>`;
};

