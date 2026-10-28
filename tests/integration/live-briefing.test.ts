import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import path from "node:path";
import express from "express";
import {createVoiceMediaHarness} from '../voiceMediaHarness.js';
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { ref, set } from "firebase/database";

test("signed live briefing tools verify a call, save one task change and one domain approval in the real Firebase adapter", async () => {
  assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, "127.0.0.1:9010");
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
    project_id: "demo-hyperflow",
    client_email: "fixture@demo-hyperflow.iam.gserviceaccount.com",
    private_key: privateKey,
  });
  process.env.FIREBASE_DATABASE_URL = "https://demo-hyperflow.firebaseio.com";
  process.env.FIREBASE_ENFORCE_TENANT_LIFECYCLE = "true";
  process.env.COMMUNICATIONS_WEBHOOK_SECRET = "fixture-briefing-secret";
  process.env.COMMUNICATIONS_API_KEY = "fixture";
  const env = await initializeTestEnvironment({
    projectId: "demo-hyperflow",
    database: {
      host: "127.0.0.1",
      port: 9010,
      rules: readFileSync("database.rules.json", "utf8"),
    },
  });
  const { getApps, deleteApp } = await import("firebase-admin/app");
  const app = express();
  let media:Awaited<ReturnType<typeof createVoiceMediaHarness>>|undefined;
  let interruptNextRequest=false;
  const modelContract:any={};
  let promptVersion = "briefing-first.v5";
  app.get("/health", (_req,res)=>res.json({liveBriefing:true,briefingProtocol:"briefing-tool.v1",briefingPromptVersion:promptVersion}));
  let code = "",
    sms = 0;
  app.get("/v1/contacts", (_req, res) =>
    res.json({
      data: [
        {
          id: "person",
          name: "Alice",
          phone_number: "+15550000001",
          phone: "+15550000001",
        },
      ],
    }),
  );
  app.get("/v1/communications/comm_fixture", (_req, res) =>
    res.json({
      communication_id: "comm_fixture",
      tenant_id: "briefing_fixture",
      thread_id: "thread_fixture",
      person_id: "person",
      channel: "voice",
      direction: "outbound",
      purpose: {type:"coaching_session"},
      status: "in_progress",
    }),
  );
  app.post("/v1/messages", express.json(), (req, res) => {
    sms++;
    assert.equal(req.body.to, "+15550000001");
    code = req.body.body.match(/\b\d{6}\b/)[0];
    res
      .status(201)
      .json({ communication_id: "sms_fixture", status: "accepted" });
  });
  const { mountApi } = await import("../../lib/http/express.js");
  app.use('/api/agent/briefing',(_req,_res,next)=>{
    if(!interruptNextRequest){next();return;}
    interruptNextRequest=false;
    media!.interruptVerification().then(()=>next(),next);
  });
  mountApi(app);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  process.env.COMMUNICATIONS_API_URL = base;
  process.env.HYPERFLOW_EVENT_URL = base + "/api/events";
  const checkout = process.env.PHASE02_COMMUNICATIONS_CHECKOUT;
  assert.ok(checkout, "Provide the pinned Communications checkout");
  const context: any = {
    briefingPrivate: true,
    tenantId: "briefing_fixture",
    personId: "person",
    communicationId: "comm_fixture",
    threadId: "thread_fixture",
    serviceIdentity: "+15550000000",
  };
  const invoke = (args: any) => media!.invoke(args);
  const { handleBriefings } = await import("../../lib/briefings/api.js");
  const { transactBriefingRecord } = await import("../../lib/briefings/store.js");
  const { fingerprint } = await import("../../lib/briefings/model.js");
  const { handleCommitments } = await import("../../lib/commitments/api.js");
  const store = await import("../../lib/serverStore.js");
  const {createFlowRun, materializeFlowRunProject, updateFlowRunFromProject} = await import("../../lib/flowRun.js");
  const {createFlowRunIfAbsent, saveFlowRun} = await import("../../lib/flowRunStore.js");
  const member = {
    orgId: "briefing_fixture",
    uid: "alice",
    role: "owner",
    email: "alice@example.test",
  };
  try {
    await env.clearDatabase();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.database();
      await set(ref(db, "users/alice"), {
        orgId: member.orgId,
        email: member.email,
      });
      await set(ref(db, `organizations/${member.orgId}/members`), {
        alice: { role: "owner", email: member.email },
        bob: { role: "member", email: "bob@example.test" },
      });
      await set(ref(db, `agent_profiles/${member.orgId}`), {
        agentId: "fixture",
        displayName: "Fixture",
        timezone: "Australia/Brisbane",
        primaryUserId: "alice",
        primaryPersonId: "person",
        allowedProjectIds: ["p"],
        serviceIdentities: { phone: "+15550000000" },
      });
      await set(ref(db, `projects/${member.orgId}`), {
        dataRevision: 1,
        settings: { teamMemberDetails: { Alice: { email: member.email } } },
        projects: [
          {
            id: "p",
            name: "Acceptance",
            revision: 1,
            milestones: [
              {
                id: "n",
                name: "Work",
                nodeType: "milestone",
                subtasks: [
                  {
                    id: "t",
                    name: "Disposable fixture task",
                    assignedTo: "Alice",
                    status: "Started",
                    description: "No external work",
                  },
                ],
              },
            ],
          },
        ],
      });
    });
    await env.withSecurityRulesDisabled(async (ctx) => {
      const history: any = Object.fromEntries(
        Array.from({ length: 501 }, (_, n) => [
          `resolved_${n}`,
          {
            id: `resolved_${n}`,
            updatedAt: Date.now() + n,
            agentProposal: { status: "applied" },
          },
        ]),
      );
      history.triage_old_pending = {
        id: "triage_old_pending",
        projectId: "p",
        updatedAt: 1,
        agentProposal: {
          projectId: "p",
          kind: "coaching_commitment",
          summary: "Older pending fixture",
          value: "Review this fixture only",
          status: "pending",
          requestedAt: 1,
          confidence: 1,
        },
      };
      await set(ref(ctx.database(), `triage_items/${member.orgId}`), history);
    });
    const initial: any = await store.readTenantWorkspace(member.orgId);
    const pinnedRun = await createFlowRunIfAbsent(createFlowRun({
      orgId: member.orgId, project: initial.projects[0], occurrenceId: "briefing-fixture", trigger: "manual",
    }));
    await store.writeProject(member.orgId, 0, materializeFlowRunProject(initial.projects[0], pinnedRun));
    await handleBriefings(
      {
        method: "PUT",
        body: {
          operation: "settings",
          enabled: true,
          allowTaskUpdates: true,
          allowApprovals: true,
          sections: ["tasks", "approvals", "reports"],
        },
      },
      member,
    );
    media=await createVoiceMediaHarness(checkout,base,context);
    await assert.rejects(invoke({ operation: "list_tasks" }), /Verify the SMS/);
    const readiness = async ():Promise<any> => handleBriefings({method:"GET",query:{operation:"readiness"}},member);
    assert.equal((await readiness()).ready,true);
    promptVersion = "legacy-coaching";
    assert.equal((await readiness()).ready,false);
    promptVersion = "briefing-first.v5";
    assert.equal(
      (await invoke({ operation: "request_code" })).status,
      "code_sent",
    );
    await invoke({ operation: "request_code" });
    assert.equal(sms, 1);
    interruptNextRequest=true;
    const beforeVerification=media.continuations;
    modelContract.verification=await invoke({ operation: "verify_code", code });
    await media.assertVerificationHandoff(beforeVerification);
    assert.ok((await invoke({operation:'subjects'})).subjects.length>=2);
    const tasks = await invoke({ operation: "list_tasks" });
    assert.equal(tasks.incomplete, false, JSON.stringify(tasks.notices));
    assert.equal(tasks.items.length, 1);
    const task = tasks.items[0];
    modelContract.tasks=tasks;
    modelContract.taskDetail=await invoke({operation:'read_item',itemId:task.id});
    assert.equal((await invoke({operation:'read_item',itemId:task.id})).item.id,task.id);
    const prepared = await invoke({
      operation: "prepare_change",
      itemId: task.id,
      version: task.version,
      action: "set_status",
      status: "Completed",
      requestId: "fixture_task_change",
    });
    modelContract.taskPreparation=prepared;
    const deniedConfirmation=await invoke({operation:'confirm_change',id:prepared.id});
    assert.equal(deniedConfirmation.status,'confirmation_rejected');
    assert.equal(deniedConfirmation.confirmationAccepted,false);
    assert.match(deniedConfirmation.error,/Read the exact proposal/);
    assert.match(deniedConfirmation.nextStep,/Do not describe it as processing or saved/);
    await media.interruptReadback(prepared.readback);
    assert.equal((await invoke({operation:'confirm_change',id:prepared.id})).status,'confirmation_rejected');
    assert.equal((await invoke({operation:'change_result',id:prepared.id})).status,'prepared');
    const confirm = async (proposal: any,confirmation='confirm') => {
      const now = Date.now();
      context.briefingAssistantTurn = {
        text: proposal.readback,
        at: now,
        playedAt: now + 1,
        interrupted: false,
      };
      context.briefingHumanTurn = { text: confirmation, at: now + 2 };
      await media!.confirmReadback(proposal.readback,confirmation);
      return invoke({ operation: "confirm_change", id: proposal.id });
    };
    const qualified = await confirm(prepared, 'Yep, but do not change it.');
    assert.equal(qualified.status, 'confirmation_rejected');
    assert.match(qualified.error, /clear new confirmation/);
    assert.equal((await invoke({operation:'change_result',id:prepared.id})).status,'prepared');
    await media.confirmReadback('Inspection is ready. Shall I mark it completed?', 'Yes.');
    assert.equal((await invoke({operation:'decide_item',itemId:task.id,version:task.version,
      action:'set_status',status:'Completed',requestId:'fixture_task_change'})).status,'completed');
    assert.equal((await invoke({operation:'change_result',id:prepared.id})).status,'completed');
    await confirm(prepared);
    const workspace: any = await store.readTenantWorkspace(member.orgId);
    assert.equal(
      workspace.projects[0].milestones[0].subtasks[0].status,
      "Completed",
    );
    assert.equal(workspace.activityLogs.length, 1);
    assert.ok(workspace.briefingReceipts.fixture_task_change);
    // A callback still holds the pre-call run snapshot. It must not undo the confirmed edit.
    const projected = materializeFlowRunProject(workspace.projects[0], pinnedRun);
    assert.equal(projected.milestones[0].subtasks[0].status, "Completed");
    await saveFlowRun(updateFlowRunFromProject(pinnedRun, projected));
    await store.writeProject(member.orgId, 0, projected);
    const afterCallback: any = await store.readTenantWorkspace(member.orgId);
    assert.equal(afterCallback.projects[0].milestones[0].subtasks[0].status, "Completed");
    // Also cover a worker that constructed its stale projection before the live edit.
    const stale = materializeFlowRunProject(initial.projects[0], pinnedRun);
    stale.revision = afterCallback.projects[0].revision;
    await store.writeProject(member.orgId, 0, stale);
    const afterStaleSave: any = await store.readTenantWorkspace(member.orgId);
    assert.equal(afterStaleSave.projects[0].milestones[0].subtasks[0].status, "Completed");
    assert.equal(afterStaleSave.activityLogs.length, 1);
    assert.ok(afterStaleSave.briefingReceipts.fixture_task_change);
    const created: any = await handleCommitments(
      {
        method: "POST",
        body: {
          action: "create",
          projectId: "p",
          terms: {
            owner: "user:alice",
            beneficiary: "user:alice",
            deliverable: "Fixture review",
            criteria: "Explicit acceptance only",
            dueAt: new Date(Date.now() + 86400000).toISOString(),
            timezone: "Australia/Brisbane",
          },
        },
      },
      member,
    );
    const queue = await invoke({ operation: "list_approvals" });
    modelContract.approvals=queue;
    assert.ok(
      queue.items.some((i: any) => i.sourceId === "triage_old_pending"),
      "An old pending proposal must survive a large resolved-history backlog",
    );
    const approval = queue.items.find(
      (i: any) => i.sourceId === created.item.id,
    );
    assert.ok(approval);
    // Asking about a slow operation while it runs must not erase the item or
    // prepared proposal from the actual media handler's model context.
    interruptNextRequest=true;
    modelContract.approvalDetail=await invoke({operation:'read_item',itemId:approval.id});
    interruptNextRequest=true;
    const decision = {
      operation: "decide_item",
      itemId: approval.id,
      version: approval.version,
      action: "approve",
      note: "Accept the isolated fixture obligation",
      requestId: "fixture_approval_change",
    };
    await media.confirmReadback('The fixture review is waiting for your approval. Approve it?', 'Yes, approve that.');
    interruptNextRequest=true;
    const saved = await invoke(decision);
    assert.equal(saved.status,'completed');
    assert.match(saved.nextStep,/move to the next item/);
    modelContract.approvalDecision=saved;
    const decisions = await Promise.all([invoke(decision), invoke(decision)]);
    assert.ok(decisions.some((r) => r.status === "completed"));
    const obligation = await store.readOperationalCommitment(
      member.orgId,
      created.item.id,
    );
    assert.equal(obligation?.state, "accepted");
    assert.equal(obligation?.asks.at(-1)?.responses[0].via, "voice");
    assert.equal(
      obligation?.asks.at(-1)?.responses[0].id,
      "briefing_fixture_approval_change",
    );
    assert.equal(
      obligation?.history.filter((h) =>
        h.note.includes("[briefing:fixture_approval_change]"),
      ).length,
      1,
    );
    const commitments=await invoke({operation:'list_tasks'});
    const ongoing=commitments.items.find((item:any)=>item.source==='commitment'&&item.sourceId===created.item.id);
    assert.ok(ongoing);
    const detail=await invoke({operation:'read_item',itemId:ongoing.id});
    const progress={...detail.changeOptions.find((option:any)=>option.action==='progress'),requestId:'fixture_progress_change'};
    assert.equal(progress.operation,'decide_item');
    const progressText='Just to say that that particular piece has been done, but the overall tests are ongoing.';
    const progressRequest={...progress,note:progressText};
    await media.pendingCaller();
    const progressStarted=Date.now();
    assert.equal((await invoke(progressRequest)).status,'completed');
    assert.ok(Date.now()-progressStarted<5000,'Saving does not wait for a second speech transcript');
    assert.equal((await invoke(progressRequest)).status,'completed');
    const progressed=await store.readOperationalCommitment(member.orgId,created.item.id);
    assert.equal(progressed?.state,'in_progress');
    assert.equal(progressed?.history.filter((h)=>h.note.includes('[briefing:fixture_progress_change]')).length,1);
    assert.ok(JSON.stringify(progressed).includes(progressText));
    const completionDetail=await invoke({operation:'read_item',itemId:ongoing.id});
    assert.ok(completionDetail.item.actions.includes('set_status'));
    const completion={...completionDetail.changeOptions.find((option:any)=>option.action==='set_status'),
      status:'Completed',requestId:'fixture_completion_change'};
    const submitted=await invoke(completion);
    assert.equal(submitted.status,'completed');
    assert.equal(submitted.result.item.state,'submitted');
    assert.match(submitted.nextStep,/submitted, not yet fulfilled/);
    assert.equal((await invoke(completion)).status,'completed');
    const fulfillmentQueue=await invoke({operation:'list_approvals'});
    const fulfillment=fulfillmentQueue.items.find((item:any)=>item.sourceId===created.item.id);
    const fulfillmentDetail=await invoke({operation:'read_item',itemId:fulfillment.id});
    const accept={...fulfillmentDetail.changeOptions.find((option:any)=>option.action==='approve'),requestId:'fixture_fulfillment_change'};
    assert.equal((await invoke(accept)).status,'completed');
    const fulfilled=await store.readOperationalCommitment(member.orgId,created.item.id);
    assert.equal(fulfilled?.state,'fulfilled');
    assert.equal(fulfilled?.history.filter((h)=>h.note.includes('[briefing:fixture_completion_change]')).length,1);
    await handleBriefings({method:'PUT',body:{operation:'settings',enabled:true,allowTaskUpdates:true,allowApprovals:true,requireSmsVerification:false}},member);
    await transactBriefingRecord(member.orgId,'sessions',`call_${fingerprint('comm_fixture').slice(0,40)}`,()=>({verified:false}));
    const beforeSms=sms;
    assert.equal((await invoke({operation:'start_briefing'})).status,'ready');
    assert.equal(sms,beforeSms);
    assert.equal((await invoke({operation:'request_code'})).status,'ready');
    assert.equal(sms,beforeSms);
    const report = await invoke({
      operation: "report",
      subject: "all",
      reportType: "workload",
    });
    assert.equal(report.byUser.length, 2);
    modelContract.reportAll=report;
    const personalReport=await invoke({operation:'report',subject:'me',reportType:'workload'});
    modelContract.reportMe=personalReport;
    modelContract.subjects=await invoke({operation:'subjects'});
    assert.equal(personalReport.byUser.length,1);
    assert.equal(
      report.byUser.find((u: any) => u.userId === "alice").completed,
      2,
    );
    const web: any = await handleBriefings(
      {
        method: "POST",
        body: { operation: "report", subject: "all", reportType: "workload" },
      },
      member,
    );
    assert.deepEqual(web.byUser, report.byUser);
    if(process.env.BRIEFING_MODEL_CONTRACT_OUTPUT) writeFileSync(process.env.BRIEFING_MODEL_CONTRACT_OUTPUT,JSON.stringify(modelContract,null,2)+'\n');
    await handleBriefings(
      {
        method: "PUT",
        body: {
          operation: "settings",
          enabled: false,
          allowTaskUpdates: false,
          allowApprovals: false,
        },
      },
      member,
    );
    await assert.rejects(
      invoke({ operation: "list_tasks" }),
      /Enable and enrol/,
    );
  } finally {
    await media?.close();
    await env.cleanup();
    for (const app of getApps()) await deleteApp(app);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
