/** External HTTP-only recipe. Creates a fixture project, saved view and simulation result. */
import { randomUUID } from 'node:crypto';
const origin = new URL(process.env.HYPERFLOW_URL || 'http://localhost:3000');
const credential = process.env.HYPERFLOW_API_TOKEN;
if (!credential) throw new Error('Set HYPERFLOW_API_TOKEN with discovery, configuration and test-runs scopes');
if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname)) throw new Error('Use HTTPS');
const request = async (path, body) => {
  const response = await fetch(new URL(path, origin), {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${credential}`, ...(body ? {'Content-Type':'application/json'} : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${result.error}`);
  return result;
};
await request('/api/discovery');
const current = await request('/api/configuration');
const identity = 'example_' + randomUUID().replaceAll('-', '');
const changes = [
  {resource:'project', operation:'create', value:{id:identity, name:'API fixture example', projectData:{topic:'Quarterly review'}, milestones:[
    {id:'report', name:'Draft report', nodeType:'report', dependsOn:[], subtasks:[], actionConfig:{autoExecute:false, template:'{"prompt":"Summarize {{topic}}"}'}},
  ]}},
  {resource:'ui_view', operation:'create', value:{id:identity, name:'API fixture view', projectId:identity, view:'projects', showMinimap:true, zoom:1}},
];
const plan = await request('/api/configuration', {operation:'plan', expectedRevision:current.revision, changes});
if (!plan.valid) throw new Error(JSON.stringify(plan.issues));
console.log('Configuration plan:', JSON.stringify({diff:plan.diff, effects:plan.effects}));
const apply = {operation:'apply', expectedRevision:current.revision, requestId:identity, planHash:plan.planHash, changes};
// Persist this exact request before issuing it in an agent runtime. Reuse its identity after an uncertain response.
const saved = await request('/api/configuration', apply);
const run = await request('/api/test-runs', {
  requestId:identity, projectId:identity, expectedRevision:saved.revision,
  fixtures:{report:{status:'success', output:{report_content:'Fixture quarterly report'}}},
  assertions:[{path:'data.report_content', operator:'equals', expected:'Fixture quarterly report'}],
});
console.log(JSON.stringify({projectId:identity, testId:run.item.id, status:run.item.result.status, providerCalls:run.item.result.providerCalls, view:new URL('/?savedView='+identity, origin).href}, null, 2));
if (run.item.result.status !== 'passed') process.exitCode = 1;
