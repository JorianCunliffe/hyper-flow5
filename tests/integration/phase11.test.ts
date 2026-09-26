import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
} from "@firebase/rules-unit-testing";
import { ref, set, get } from "firebase/database";
test("Phase 11 tenant API credentials and workspace revisions use real isolated records", async () => {
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
  const { handleTenantControl, handleWorkspace, controlStore } =
    await import("../../lib/tenantControl/api");
  const { requireAppMember } = await import("../../lib/apiAuth");
  const { handleVisibleFlows } = await import("../../lib/visibleFlows/api");
  const { handleArtifacts } = await import("../../lib/artifacts/api");
  const { getApps, deleteApp } = await import("firebase-admin/app");
  const env = await initializeTestEnvironment({
    projectId: "demo-hyperflow",
    database: {
      host: "127.0.0.1",
      port: 9010,
      rules: readFileSync("database.rules.json", "utf8"),
    },
  });
  const member = { orgId: "org_phase11", uid: "phase11_ceo", role: "owner" };
  try {
    await env.withSecurityRulesDisabled(async (c) => {
      for (const [uid, org] of [
        [member.uid, member.orgId],
        ["other_ceo", "org_other"],
      ]) {
        await set(ref(c.database(), `users/${uid}`), { orgId: org });
        await set(ref(c.database(), `organizations/${org}/members/${uid}`), {
          role: "owner",
        });
        await set(ref(c.database(), `projects/${org}`), {
          dataRevision: 0,
          projects: [{ id: "alpha", name: org, revision: 0, milestones: [] }],
          settings: {},
          scratchTasks: [],
          activityLogs: [],
        });
      }
    });
    const {consumeOrganizationInvite}=await import('../../lib/serverStore');
    await env.withSecurityRulesDisabled(async c=>{
      await set(ref(c.database(),'invites/cold_invite'),{orgId:member.orgId,email:'fixture@example.invalid',createdAt:Date.now(),invitedBy:member.uid});
    });
    await assert.rejects(consumeOrganizationInvite('wrong_invitee','wrong@example.invalid','cold_invite'),/Invite/);
    assert.equal(await consumeOrganizationInvite('fixture_invitee','fixture@example.invalid','cold_invite'),member.orgId);
    assert.equal(await consumeOrganizationInvite('fixture_invitee','fixture@example.invalid','cold_invite'),member.orgId);
    await assert.rejects(consumeOrganizationInvite('another_invitee','fixture@example.invalid','cold_invite'),/Invite/);
    const secret = "phase11_fixture_secret_not_production_001";
    const input = {
      method: "POST",
      body: {
        operation: "create_client",
        requestId: "phase11-client",
        revision: 0,
        name: "Controlled API client",
        secret,
        expiresAt: Date.now() + 86400000,
        scopes: ["workspace:read", "workspace:write"],
      },
    };
    const [a, b]: any[] = await Promise.all([
      handleTenantControl(input, member),
      handleTenantControl(input, member),
    ]);
    assert.equal(a.item.id, b.item.id);
    const token = a.credentialPrefix + secret;
    const auth = () =>
      requireAppMember({
        headers: { authorization: "Bearer " + token },
        url: "/api/workspace",
        method: "GET",
      });
    const actor = await auth();
    const current: any = await handleWorkspace({ method: "GET" }, actor);
    assert.equal(current.data.projects[0].name, member.orgId);
    await assert.rejects(
      requireAppMember(
        {
          headers: { authorization: "Bearer " + token },
          url: "/api/workspace",
          method: "GET",
        },
        "org_other",
      ),
      /another organization/,
    );
    await assert.rejects(
      requireAppMember({
        headers: { authorization: "Bearer " + token },
        url: "/api/gemini",
        query: { action: "publishing" },
        method: "POST",
      }),
      /scope/,
    );
    const data = {
      ...current.data,
      settings: { name: "Controlled API edit" },
      projects: [{ ...current.data.projects[0], name: "Revised" }],
    };
    await assert.rejects(handleWorkspace({method:'PUT',body:{expectedRevision:0,data}},actor),/validated configuration API/);
    const writes = await Promise.allSettled([
      handleWorkspace(
        { method: "PUT", body: { expectedRevision: 0, data } },
        member,
      ),
      handleWorkspace(
        { method: "PUT", body: { expectedRevision: 0, data } },
        member,
      ),
    ]);
    assert.equal(writes.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      (
        (await handleWorkspace(
          { method: "GET" },
          { orgId: "org_other", uid: "other_ceo", role: "owner" },
        )) as any
      ).data.projects[0].name,
      "org_other",
    );
    const persisted: any = await handleWorkspace({ method: "GET" }, actor);
    assert.equal(persisted.data.dataRevision, 1);
    assert.equal(persisted.data.projects[0].revision, 1);
    for (let i = 0; i < 3; i++)
      await handleVisibleFlows(
        {
          method: "POST",
          body: {
            operation: "create",
            projectId: "alpha",
            plan: {
              name: "Paged flow " + i,
              steps: [
                {
                  id: "review",
                  name: "Read accepted work",
                  action: "read_operations",
                  owner: member.uid,
                  dependsOn: [],
                  inputs: {},
                  sources: [],
                },
              ],
            },
          },
        },
        member,
      );
    const first: any = await handleVisibleFlows(
      { method: "GET", query: { shape: "summary", limit: 1 } },
      member,
    );
    const second: any = await handleVisibleFlows(
      {
        method: "GET",
        query: { shape: "summary", limit: 1, after: first.next },
      },
      member,
    );
    assert.equal(first.items.length, 1);
    assert.ok(first.next);
    assert.notEqual(first.items[0].id, second.items[0].id);
    assert.equal(first.items[0].versions, undefined);
    const detail: any = await handleVisibleFlows(
      { method: "GET", query: { id: first.items[0].id } },
      member,
    );
    assert.equal(
      detail.item.versions[0].plan.steps[0].action,
      "read_operations",
    );
    await assert.rejects(
      handleVisibleFlows({ method: "GET", query: { limit: 0 } }, member),
      /Page size/,
    );
    await env.withSecurityRulesDisabled(async (c) => {
      for (const id of ["a", "b", "c"])
        await set(
          ref(c.database(), `artifacts/${member.orgId}/jobs/${id.repeat(64)}`),
          {
            id: id.repeat(64),
            projectId: id === "a" ? "other-project" : "alpha",
            revision: 1,
            createdAt: 1,
            status: "proposed",
            template: {
              id: "weekly-docx",
              version: 1,
              name: "Controlled report",
              brand: { name: "fixture" },
            },
          },
        );
    });
    const reports: any = await handleArtifacts(
      {
        method: "GET",
        query: { projectId: "alpha", shape: "summary", limit: 1 },
      },
      member,
    );
    assert.equal(reports.items.length, 0);
    assert.ok(
      reports.next,
      "A filtered page still exposes a continuation cursor",
    );
    const moreReports: any = await handleArtifacts(
      {
        method: "GET",
        query: {
          projectId: "alpha",
          shape: "summary",
          limit: 1,
          after: reports.next,
        },
      },
      member,
    );
    assert.equal(moreReports.items[0].id, "b".repeat(64));
    await assertFails(
      get(
        ref(
          env.authenticatedContext(member.uid).database(),
          `tenant_control/${member.orgId}`,
        ),
      ),
    );
    await assertFails(
      set(
        ref(
          env.authenticatedContext(member.uid).database(),
          `tenant_control/${member.orgId}/clients/forged`,
        ),
        { scopes: ["workspace:write"] },
      ),
    );
    await assertFails(set(ref(env.authenticatedContext('hyperflow-runtime-v1').database(),`tenant_control/${member.orgId}/forged`),true));
    await env.withSecurityRulesDisabled(c=>set(ref(c.database(),`tenant_lifecycle/${member.orgId}`),{state:'suspended',revision:1}));
    await assertFails(get(ref(env.authenticatedContext(member.uid).database(),`projects/${member.orgId}`)));
    await assertFails(set(ref(env.authenticatedContext(member.uid).database(),`projects/${member.orgId}/late`),true));
    await assert.rejects(controlStore.transact(member.orgId,r=>({...r!,revision:r!.revision+1})),/permission_denied/i);
    const otherActor={uid:'other_ceo',orgId:'org_other',role:'owner'};
    const otherRead:any=await handleWorkspace({method:'GET'},otherActor);
    await handleWorkspace({method:'PUT',body:{expectedRevision:otherRead.data.dataRevision,data:otherRead.data}},otherActor);
    await env.withSecurityRulesDisabled(c=>set(ref(c.database(),`tenant_lifecycle/${member.orgId}`),{state:'active',revision:2}));
    for(const root of ['agent_profiles','integration_connections','integration_credentials','oauth_states','workspace_grants','external_action_receipts','coaching_sessions','conversation_contexts','agent_voice_context_requests']){
      for(const uid of [member.uid,'hyperflow-runtime-v1']){
        const browser=env.authenticatedContext(uid).database();
        await assertFails(get(ref(browser,`${root}/${member.orgId}`)));
        await assertFails(set(ref(browser,`${root}/${member.orgId}/forged`),{status:'completed'}));
      }
    }
    const {lifecycleOwner,changeDatabaseLifecycle,exportLifecycleChunk,readLifecycle}=await import('../../lib/tenantLifecycle/store');
    assert.equal((await lifecycleOwner('other_ceo')).orgId,'org_other');
    await env.withSecurityRulesDisabled(c=>set(ref(c.database(),'organizations/org_other/members/other_ceo/role'),'admin'));
    assert.equal((await lifecycleOwner('other_ceo')).role,'admin');
    await env.withSecurityRulesDisabled(c=>set(ref(c.database(),'organizations/org_other/members/other_ceo/role'),'member'));
    await assert.rejects(lifecycleOwner('other_ceo'),/administrator/);
    await env.withSecurityRulesDisabled(c=>set(ref(c.database(),'organizations/org_other/members/other_ceo/role'),'owner'));
    await assert.rejects(lifecycleOwner(member.uid,'org_other'),/administrator/);
    const receipt={owner:'communications-service' as const,status:'suspended',revision:2};
    // Exercise real upload records/leases with a controlled storage boundary.
    const {handleFiles,fileDependencies}=await import('../../lib/files/api');
    const {crc32cUpdate,crc32cBase64}=await import('../../lib/files/crc32c');
    const fileActor={orgId:'org_other',uid:'other_ceo',role:'owner'};
    const fileBytes=Buffer.from('Isolated storage receipt');let uploaded=Buffer.alloc(0),lostFileResponse=true;
    const files={...fileDependencies,enabled:()=>true,provider:{
      create:async()=> 'https://storage.googleapis.com/upload/storage/v1/fixture?upload_id=secret',
      progress:async()=>({offset:uploaded.length,...(uploaded.length===fileBytes.length?{object:{generation:'123',size:uploaded.length,crc32c:crc32cBase64(crc32cUpdate(uploaded))}}:{})}),
      put:async(_file:any,_offset:number,bytes:Buffer)=>{uploaded=Buffer.from(bytes);if(lostFileResponse){lostFileResponse=false;throw new Error('Controlled lost response');}},
      close:async()=>{uploaded=Buffer.alloc(0);},download:async()=>({url:'https://storage.example/fixture',expiresAt:Date.now()+60000}),
    }};
    const fileId='integration_file_01';
    const fileCall=(body:any)=>handleFiles({method:'POST',body},fileActor,files);
    const {reserveFileLease}=await import('../../lib/tenantLifecycle/store');
    await reserveFileLease('org_other','file_upload_orphan_file_01','managed/org_other/orphan_file_01');
    await fileCall({operation:'delete',id:'orphan_file_01'});
    assert.equal(Object.keys((await readLifecycle('org_other')).storageLeases).length,0);
    await assert.rejects(fileCall({operation:'start',id:'orphan_file_01',name:'late.txt',mime:'text/plain',bytes:fileBytes.length,crc32c:crc32cBase64(crc32cUpdate(fileBytes)),visibility:'private'}),/identity conflict/);
    await fileCall({operation:'start',id:fileId,name:'receipt.txt',mime:'text/plain',bytes:fileBytes.length,crc32c:crc32cBase64(crc32cUpdate(fileBytes)),visibility:'private'});
    assert.equal(Object.keys((await readLifecycle('org_other')).storageLeases).length,1);
    await assert.rejects(changeDatabaseLifecycle('org_other','other_ceo',{operation:'suspend',revision:0,requestId:'suspend_during_upload',communicationsReceipt:receipt}),/file operation is still running/);
    await assertFails(get(ref(env.authenticatedContext('other_ceo').database(),`tenant_files/org_other/${fileId}`)));
    await assert.rejects(handleFiles({method:'GET',query:{id:fileId}},member,files),/not found/);
    await assert.rejects(fileCall({operation:'chunk',id:fileId,offset:0,content:fileBytes.toString('base64')}),/unresolved/);
    assert.equal(Object.keys((await readLifecycle('org_other')).storageLeases).length,1);
    const reconciled=await fileCall({operation:'reconcile',id:fileId});assert.equal(reconciled.file!.state,'ready');
    assert.equal(Object.keys((await readLifecycle('org_other')).storageLeases).length,0);
    await fileCall({operation:'delete',id:fileId});assert.equal((await handleFiles({method:'GET',query:{id:fileId}},fileActor,files)).file!.state,'deleted');
    await env.withSecurityRulesDisabled(c=>set(ref(c.database(),'external_action_receipts/org_other/held'),{status:'uncertain'}));
    let lifecycle=await changeDatabaseLifecycle('org_other','other_ceo',{operation:'suspend',revision:0,requestId:'suspend_blocked',communicationsReceipt:receipt});
    assert.equal(lifecycle.state,'active');assert.equal(lifecycle.receipts.suspend_blocked.status,'blocked');
    await env.withSecurityRulesDisabled(c=>set(ref(c.database(),'external_action_receipts/org_other/held'),null));
    lifecycle=await changeDatabaseLifecycle('org_other','other_ceo',{operation:'suspend',revision:lifecycle.revision,requestId:'suspend_export',communicationsReceipt:receipt});
    assert.equal(lifecycle.state,'suspended');
    const exported=await exportLifecycleChunk('org_other','other_ceo',{dataset:'projects',revision:lifecycle.revision,offset:0});
    assert.equal(JSON.parse(Buffer.from(exported.content,'base64').toString()).projects[0].name,'org_other');
    assert.equal(exported.nextOffset,null);assert.equal(exported.files,'not-included');
    await assert.rejects(exportLifecycleChunk('org_other','other_ceo',{dataset:'integration_credentials',revision:lifecycle.revision,offset:0}),/not available/);
    await assert.rejects(exportLifecycleChunk('org_other','other_ceo',{dataset:'projects',revision:0,offset:0}),/suspended revision/);
    assert.ok(Object.values((await readLifecycle('org_other')).receipts).some(x=>x.operation==='export'));
    const {eraseManagedFiles}=await import('../../lib/files/recovery');
    process.env.HYPERFLOW_MANAGED_FILES='true';process.env.FIREBASE_STORAGE_BUCKET='controlled-fixture';
    await env.withSecurityRulesDisabled(c=>set(ref(c.database(),'tenant_files/org_other/managed_file_cleanup'),{id:'managed_file_cleanup',path:'managed/org_other/managed_file_cleanup',actor:'other_ceo',name:'private.txt',mime:'text/plain',bytes:1,crc32c:'AAAAAA==',visibility:'private',createdAt:1,state:'ready',offset:1,generation:'123'}));
    const cleanupRequest={requestId:'cleanup_files_fixture',revision:lifecycle.revision,confirmation:'Erase HyperFlow stored files',backupReviewed:true};
    await assert.rejects(eraseManagedFiles('org_other','other_ceo',cleanupRequest,{...files.provider,close:async()=>{throw new Error('Controlled storage outage');}}),/remains pending/);
    await assert.rejects(changeDatabaseLifecycle('org_other','other_ceo',{operation:'resume',revision:(await readLifecycle('org_other')).revision,requestId:'resume_during_file_cleanup'}),/still working/);
    lifecycle=await eraseManagedFiles('org_other','other_ceo',cleanupRequest,{...files.provider,close:async file=>{assert.equal(file.path,'managed/org_other/managed_file_cleanup');}});
    assert.equal(lifecycle.receipts.cleanup_files_fixture.status,'completed');assert.equal(lifecycle.receipts.cleanup_files_fixture.counts?.processed,3);
    assert.equal((await eraseManagedFiles('org_other','other_ceo',cleanupRequest,files.provider)).revision,lifecycle.revision);
    await assert.rejects(eraseManagedFiles('org_other','different_actor',cleanupRequest,files.provider),/identity conflict/);
    await changeDatabaseLifecycle('org_other','other_ceo',{operation:'resume',revision:lifecycle.revision,requestId:'resume_export'});
    assert.equal((await handleWorkspace({method:'GET'},otherActor)).owner,'hyperflow');
    const {eraseDatabaseRecords, ERASE_CONFIRMATION, ERASED_DATA_ROOTS}=await import('../../lib/tenantLifecycle/store');
    await env.withSecurityRulesDisabled(async c=>{
      for(const root of ERASED_DATA_ROOTS) if(root!=='projects') await set(ref(c.database(),`${root}/org_other/erase_fixture`),{status:'completed'});
      await set(ref(c.database(),'tenant_files/org_other/file_manifest'),{path:'private/object'});
      await set(ref(c.database(),'invites/erase_owned'),{orgId:'org_other'});
      await set(ref(c.database(),'invites/keep_other_tenant'),{orgId:member.orgId});
      await set(ref(c.database(),'agent_inbox_pending/erase_owned'),{orgId:'org_other'});
      await set(ref(c.database(),'coaching_retry_pending/erase_owned'),{orgId:'org_other'});
    });
    const active=await readLifecycle('org_other');
    const frozen=await changeDatabaseLifecycle('org_other','other_ceo',{operation:'suspend',revision:active.revision,requestId:'suspend_for_erase',communicationsReceipt:receipt});
    const eraseInput={requestId:'erase_database_fixture',revision:frozen.revision,confirmation:ERASE_CONFIRMATION,backupReviewed:true,communicationsReceipt:{owner:'communications-service' as const,status:'closed',revision:3}};
    await assert.rejects(eraseDatabaseRecords('org_other','other_ceo',eraseInput),/Export at/);
    await exportLifecycleChunk('org_other','other_ceo',{dataset:'projects',revision:frozen.revision,offset:0});
    await assert.rejects(eraseDatabaseRecords('org_other','other_ceo',{...eraseInput,confirmation:'yes'}),/exact/);
    await assert.rejects(eraseDatabaseRecords('org_other','other_ceo',{...eraseInput,communicationsReceipt:receipt}),/local-erasure/);
    // Simulate a crashed worker after the lifecycle fence, before deletion.
    const {transactLifecycle}=await import('../../lib/tenantLifecycle/store');
    const {beginLifecycle}=await import('../../lib/tenantLifecycle/model');
    await transactLifecycle('org_other',r=>beginLifecycle(r,{id:eraseInput.requestId,actor:'other_ceo',revision:frozen.revision,operation:'erase_database'}));
    const erased=await eraseDatabaseRecords('org_other','other_ceo',eraseInput);
    assert.equal(erased.state,'erased');
    assert.equal(erased.receipts.erase_database_fixture.status,'completed');
    assert.equal((await eraseDatabaseRecords('org_other','other_ceo',eraseInput)).revision,erased.revision);
    await assert.rejects(eraseDatabaseRecords('org_other','other_actor',eraseInput),/identity conflict/);
    await assert.rejects(changeDatabaseLifecycle('org_other','other_ceo',{operation:'resume',revision:erased.revision,requestId:'resume_erased'}),/cannot be reactivated/);
    await env.withSecurityRulesDisabled(async c=>{
      for(const root of ERASED_DATA_ROOTS) assert.equal((await get(ref(c.database(),`${root}/org_other`))).exists(),false,root);
      assert.equal((await get(ref(c.database(),'tenant_files/org_other/file_manifest'))).exists(),true);
      assert.equal((await get(ref(c.database(),'invites/erase_owned'))).exists(),false);
      assert.equal((await get(ref(c.database(),'invites/keep_other_tenant'))).exists(),true);
      assert.equal((await get(ref(c.database(),`projects/${member.orgId}`))).exists(),true);
    });
    await assertFails(set(ref(env.authenticatedContext('other_ceo').database(),'projects/org_other/recreate'),true));

    const settings = await controlStore.read(member.orgId);
    await handleTenantControl(
      {
        method: "POST",
        body: {
          operation: "revoke_client",
          id: a.item.id,
          revision: settings!.revision,
        },
      },
      member,
    );
    await assert.rejects(auth(), /Invalid/);
    await env.withSecurityRulesDisabled(async (c) =>
      set(
        ref(
          c.database(),
          `organizations/${member.orgId}/members/${member.uid}`,
        ),
        null,
      ),
    );
    await assert.rejects(
      handleWorkspace({ method: "GET" }, actor),
      /membership/,
    );
  } finally {
    await env.cleanup();
    await Promise.all(getApps().map(deleteApp));
  }
});
