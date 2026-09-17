import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NodeConfigModal } from '../../components/modals/NodeConfigModal';
import { WorkspaceResourcesEditor } from '../../components/WorkspaceResourcesEditor';
import { CapabilityPolicyEditor } from '../../components/CapabilityPolicyEditor';
import { SettingsModal } from '../../components/modals/SettingsModal';
import { firebaseService } from '../../services/firebaseService';
const DEFAULT_SETTINGS: any = { projectTypes: ['Other'], companies: [], people: [], roles: [], teamMemberDetails: {}, statuses: [], dateFormat: 'DD/MM/YY', nextProjectId: 1, nextTaskId: 1 };
import { NodeType, type Milestone, type Project } from '../../types';

const project: Project = {id:'fixture',name:'Cairns fixture',company:'',type:'',startDate:0,createdAt:0,updatedAt:0,milestones:[]};
const connection = {id:'google1',provider:'google' as const,accountEmail:'fixture@example.com',state:'connected' as const,updatedAt:0};
let resources:any[] = []; let grant:any = null; let policy:any={}; let schedules:any[]=[];
firebaseService.authorizedFetch=async (url,init) => {
  const path=String(url); const input=init?.body?JSON.parse(String(init.body)):{};
  if(path.includes('scope=workspace_resources')) {if(init?.method==='PATCH')resources=input.resources;return Response.json({resources});}
  if(path.includes('/integrations/google/grant')){if(init?.method==='PUT')grant=input;return Response.json({grant});}
  if(path.includes('scope=capabilities')){if(init?.method==='PATCH')policy=input.policy;return Response.json({policy});}
  if(path.includes('/schedules')){if(init?.method==='POST')schedules.push({...input,id:'schedule1'});return Response.json({data:schedules,schedule:schedules.at(-1)});}
  if(path.includes('/integrations'))return Response.json({mailboxes:[],workspaces:[connection],people:[]});
  return Response.json({data:[],agent:{},profile:{},policy:{},projects:[]});
};
function Fixture(){
  const [node,setNode]=useState<Milestone>({id:'node1',name:'Draft enquiries',nodeType:NodeType.MAILBOX_DRAFT,subtasks:[],dependsOn:[],actionConfig:{template:'{"to":["{{item.email}}"],"subject":"Inspection","text":"{{item.reply}}"}'}});
  const [open,setOpen]=useState(false);const [settingsOpen,setSettingsOpen]=useState(false);
  return <main className="p-8 space-y-6"><h1>Cairns capability fixture — simulated services</h1>
    <button onClick={()=>setOpen(true)}>Edit node</button><button onClick={()=>setSettingsOpen(true)}>Open settings</button>
    <pre aria-label="Saved node">{JSON.stringify(node,null,2)}</pre>
    <WorkspaceResourcesEditor projects={[project]} connections={[connection]} /><CapabilityPolicyEditor />
    {open&&<NodeConfigModal milestone={node} milestones={[node]} onSave={updates=>setNode({...node,...updates})} onRun={()=>{throw new Error('Live execution is disabled in this fixture');}} isRunning={false} onClose={()=>setOpen(false)} />}
    {settingsOpen&&<SettingsModal isOpen onClose={()=>setSettingsOpen(false)} settings={DEFAULT_SETTINGS} onUpdateSettings={()=>{}} onExportBackup={()=>{}} onImportBackup={()=>{}} onBulkReplaceNameGlobal={()=>{}} currentOrgId="fixture" isCloudConfigured cloudStatus="connected" onOpenCloudSetup={()=>{}} projects={[project]} onConfigureService={async()=>{}} />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
