import {contactPolicySchema} from '../cockpit/contactPolicySchema.js';
import { receptionConfigSchema, receptionProjectSchema } from "../reception/schema.js";
import { taskContracts } from "./taskContracts.js";
import { buildOpenApi, domainOperations } from "./openapi.js";
import { configurationSchemas, views } from "../configuration/schema.js";
import { API_GROUPS } from "../tenantControl/model.js";
import { TASK_TYPES } from "../taskTypes.js";
import { ACTION_TASK_TYPE } from "../nodeTypes.js";
import { FLOW_CATALOG } from "../visibleFlows/model.js";
import { NodeType } from "../../types.js";
export function discoveryResponse(format?: unknown) {
  if (format === "openapi") return buildOpenApi();
  return {
    version: "1.0.0",
    projectHours: { configuration: 'Project.operatingHours', nodeType: 'check_hours', taskType: 'check_project_hours', endpoint: '/api/tasks/execute', template: {}, control: 'Explicit Decision branches; Wait.resumeAtPath can use hours_next_open_at. No implicit contact/reception hours gate.', documentation: 'docs/PROJECT_HOURS.md' },
    scheduleRecovery: {endpoint:'/api/schedules?action=recovery',operations:['preview','apply'],authority:'Human tenant owner/admin only',decisions:['resume_future','retry_original','keep_held'],review:'Fresh planHash, stable requestId; uncertain outcomes require acknowledgement; retry requires verified non-dispatch and separate call approval',documentation:'docs/SCHEDULE_RECOVERY.md'},
    operationalLog: { endpoint:'/api/operational-log', authority:'Tenant human administrator', filters:['projectId','runId','operationId','communicationId','campaignId','type','severity','from','to'], pagination:'before cursor; 200 scanned events per page; follow next even when items is empty', export:'format=ndjson; X-Next-Cursor', lifecycle:'configure hotRetentionDays; archive to retained internal archive; no purge', documentation:'docs/OPERATIONAL_LOG.md' },
    openapi: "/api/openapi.json",
    schemas: configurationSchemas,
    contactPolicy:{endpoint:'/api/cockpit',read:'GET ?operation=contact_policy',preview:'contact_policy_preview',apply:'contact_policy_apply',flag:'CONTACT_POLICY_V2_ENABLED',schema:contactPolicySchema,authority:'Administrator review; expectedRevision and planHash required. No replay or reception activation.',primitives:['SMS','phone','Condition','Wait','Human Ask'],documentation:'docs/CONTACT_POLICY.md'},
    meetings: {endpoint:'/api/meetings',notes:'Review topics and project assignments before import',audio:{upload:'/api/files',start:{operation:'audio_start',fileId:'owned private managed file ID'},status:'/api/meetings?audio=1&fileId=<id>',resume:'/api/meetings?audio=1&after=<cursor>',maxBytes:26214400,reviewRequired:true,storageFlag:'HYPERFLOW_MANAGED_FILES',provider:'Communications recording queue'}},
    reception: { configuration:'/api/reception', voiceCommands:'/api/agent/reception', sms:{enabledBy:'lines[].smsEnabled', ingress:'signed communication.received events', confirmations:'Exact CONFIRM code from reviewed booking; uncertain effects held for reconciliation', staffAsks:'Existing bound Ask responses; no public SMS staff verification escalation'}, flag:'PROJECT_RECEPTION_ENABLED', schema:receptionConfigSchema, projectSchema:receptionProjectSchema, actions:['availability','booking','resume_ask'], authority:'Human administrator review/apply and separate activation; signed server voice commands only', documentation:'docs/PROJECT_RECEPTION.md' },
    nodeTypes: Object.values(NodeType),
    taskTypes: TASK_TYPES,
    taskContracts,
    actionTaskTypes: ACTION_TASK_TYPE,
    visibleFlowCatalog: FLOW_CATALOG,
    operations: domainOperations,
    views,
    scopes: API_GROUPS.flatMap((g) =>
      g === "tenant" ? [g + ":read"] : [g + ":read", g + ":write"],
    ),
    workflow: [
      "discover",
      "read",
      "plan",
      "apply",
      "test",
      "inspect",
      "human approval where required",
      "execute",
      "reconcile",
    ],
    limits: {
      configurationChanges: 100,
      projects: 500,
      workspaceBytes: 3800000,
      testRuns: 100,
      testResultBytes: 256000,
    },
    handoffs: [
      'Setup assistant proposals require separate human apply, live-test and activation approvals',
      "OAuth requires human consent",
      "Review decisions and credential/lifecycle administration require a human session",
    ],
    testing: {
      mode: "fixture simulation",
      providerCalls: 0,
      liveReadiness:
        "Use service-projects/validate and domain connection/grant APIs; simulation does not prove provider availability",
    },
  };
}
