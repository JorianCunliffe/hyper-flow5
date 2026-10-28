import {readTenantWorkspace, transactWorkspaceConfiguration} from '../serverStore.js';
import {workspaceView} from '../tenantControl/workspace.js';
import {fail, fingerprint, type BriefingMember} from './model.js';

export const taskCreationDependencies = {read: readTenantWorkspace, transact: transactWorkspaceConfiguration};
export async function createBriefingTask(member: BriefingMember, input: any, scope: string[] | undefined, call: string, deps = taskCreationDependencies) {
  if (member.apiClientId) fail(403, 'A verified person must create briefing tasks');
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const projectId = typeof input.projectId === 'string' ? input.projectId.trim() : '';
  if (!title || title.length > 500 || description.length > 5000) fail(422, 'Provide the task description as a title (up to 500 characters)');
  if (!projectId) fail(422, 'Choose the project from list_projects');
  if (scope && !scope.includes(projectId)) fail(403, 'This project is outside your call access');
  if (typeof input.requestId !== 'string' || input.requestId.trim().length < 8 || input.requestId.length > 120) fail(422, 'A stable request ID is required');
  const id = `task_${fingerprint([member.uid,call,input.requestId]).slice(0,40)}`;
  const requestHash = fingerprint({title,description,projectId});
  const saved = await deps.transact(member.orgId,current => {
    const w = workspaceView(current);
    const receipt = w.briefingReceipts?.[id];
    if (receipt) {
      if (receipt.requestHash !== requestHash) fail(409, 'This request ID already created a different task');
      return current;
    }
    const project = w.projects.find((p:any)=>p.id===projectId && !p.isArchived);
    if (!project) fail(404, 'Project not found');
    const now = Date.now();
    const task = {id,name:title,description,projectId,assigneeUid:member.uid,assignedTo:member.email || member.uid,
      createdBy:member.uid,createdAt:now,status:'Not started'};
    w.scratchTasks.push(task);
    const result = {status:'completed',id,saved:true,item:{...task,id:`scratch:${id}`,source:'scratch',title,projectName:project.name,version:fingerprint(task),actions:['set_status']}};
    w.briefingReceipts = {...w.briefingReceipts,[id]:{uid:member.uid,callId:call,requestHash,at:now,result}};
    w.activityLogs.push({id,action:'created',timestamp:now,userId:member.uid,projectId,taskId:id,details:`Created task: ${title}`});
    w.dataRevision++; w.lastUpdated=now;
    return w;
  });
  return {...saved.briefingReceipts[id].result,nextStep:'The task is saved in this project and assigned to the caller. Acknowledge once and continue. Do not capture it again as follow-up or create a duplicate. It is available through list_tasks and read_item.'};
}
export async function briefingTaskResult(member: BriefingMember,id:string,call:string,deps=taskCreationDependencies) {
  const receipt=workspaceView(await deps.read(member.orgId)).briefingReceipts?.[id];
  if (!receipt || receipt.uid!==member.uid || receipt.callId!==call) fail(404,'Task creation receipt not found');
  return receipt.result;
}
