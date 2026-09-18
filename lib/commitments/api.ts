import { randomUUID } from 'node:crypto';
import { handlePromiseLedger, ledgerSource } from './promiseLedger.js';
import { applyPromiseRevision } from './promiseEvents.js';
import { createCommunicationsClient } from '../communications/client.js';
import { requireOrganizationMember } from '../serverStore.js';
import { listTenantProjects, listOperationalCommitments, readOperationalCommitment, transactOperationalCommitment } from '../serverStore.js';
import { handleMemoryContextRequest } from '../communications/memoryContext.js';
import { promiseCandidates, sourceCommitmentId } from './sources.js';
import { bounded, readTerms, CommitmentError, createCommitment, transitionCommitment, commitmentTiming, type Commitment, type CommitmentSource } from './model.js';

export interface CommitmentDependencies {
  projects: typeof listTenantProjects;
  list: typeof listOperationalCommitments;
  read: typeof readOperationalCommitment;
  transact: typeof transactOperationalCommitment;
  memory: typeof handleMemoryContextRequest;
  people: (orgId: string) => Promise<Array<{ id: string; name?: string }>>;
  member: typeof requireOrganizationMember;
}
const defaults: CommitmentDependencies = { projects: listTenantProjects, list: listOperationalCommitments, read: readOperationalCommitment, transact: transactOperationalCommitment, memory: handleMemoryContextRequest,
  people: orgId => createCommunicationsClient().listPeople(orgId), member: requireOrganizationMember };
type Member = { orgId: string; uid: string };
const visible = (row: Commitment) => {
  const { asks, review, ...data } = row;
  // Ask capabilities stay server-side; authenticated review uses Ask ID plus version.
  const publicAsk = (ask: typeof asks[number]) => { const { token, ...rest } = ask; return rest; };
  return { ...data, ...(data.source ? { source: { ...data.source, wording: '' } } : {}), asks: asks.map(publicAsk), ...(review ? { review: { ...review, ask: publicAsk(review.ask) } } : {}), timing: commitmentTiming(row) };
};
export async function handleCommitments(request: { method?: string; query?: Record<string, any>; body?: any }, member: Member, overrides: Partial<CommitmentDependencies> = {}) {
  const deps = { ...defaults, ...overrides }; const body = request.body || {}; const query = request.query || {};
  const projects = await deps.projects(member.orgId); const allowed = new Set(projects.map(row => String(row.id)));
  if(query.view==='promise_ledger'||body.action==='promise_ledger'){
    if(!['GET','POST'].includes(request.method||'')||(request.method==='GET'&&['review','link'].includes(query.operation)))throw new CommitmentError(405,'Use POST for ledger changes.');
    return handlePromiseLedger(member,request.method==='GET'?query:body,{projects:deps.projects});
  }
  const sourceViews = new Map<string, Promise<CommitmentSource[]>>();
  const currentSources = (project: string, threadId = '') => {
    const key = JSON.stringify([project,threadId]);
    if (!sourceViews.has(key)) sourceViews.set(key, deps.memory({ method: 'POST', body: { kind: threadId ? 'thread' : 'project', id: threadId || project, projectId: project } }, member).then(promiseCandidates));
    return sourceViews.get(key)!;
  };
  const currentLedgerSource = async (row:Commitment) => ledgerSource(await handlePromiseLedger(member,{operation:'read',promiseId:row.source!.id,projectId:row.projectId},{projects:deps.projects}));
  const canReadCandidate = async (row: Commitment) => !row.source || Boolean(row.acceptedEvidence)
    || (row.source.provider==='promise-ledger.v1'?(await currentLedgerSource(row)).version===row.source.version
      :(await currentSources(row.projectId, row.source.threadId)).some(source => source.id === row.source!.id && source.version === row.source!.version));
  const refreshAcceptedSource=async(row:Commitment)=>{
    if(!row.acceptedEvidence||row.source?.provider!=='promise-ledger.v1')return row;
    // Read reconciliation recovers a dropped/exhausted event without changing terms.
    try{
      const evidence=await handlePromiseLedger(member,{operation:'read',promiseId:row.source.id,projectId:row.projectId},{projects:deps.projects});
      const next=applyPromiseRevision(row,row.source.id,evidence.revision,Date.now());
      if(next===row)return row;
      return deps.transact(member.orgId,row.id,current=>{
        if(!current)throw new CommitmentError(404,'Obligation not found.');
        return applyPromiseRevision(current,row.source!.id,evidence.revision,Date.now());
      });
    }catch{return row;}
  };
  if (request.method === 'GET' && query.view === 'parties') return { viewerUid: member.uid,
    data: [{ id: `user:${member.uid}`, name: 'Me' }, ...(await deps.people(member.orgId)).map(person => ({ id: `contact:${person.id}`, name: person.name || 'Unnamed contact' }))] };
  if (body.terms) {
    const terms = readTerms(body.terms);
    const contacts = [terms.owner, terms.beneficiary].some(value => value.startsWith('contact:')) ? await deps.people(member.orgId) : [];
    for (const party of [terms.owner, terms.beneficiary].filter(Boolean)) {
      if (party.startsWith('contact:') && !contacts.some(person => `contact:${person.id}` === party)) throw new CommitmentError(403, 'Contact is not available in this organization.');
      if (party.startsWith('user:') && party !== `user:${member.uid}`) {
        try { await deps.member(party.slice(5), member.orgId); } catch { throw new CommitmentError(403, 'User is not a member of this organization.'); }
      }
    }
  }
  const projectId = bounded(request.method === 'GET' ? query.projectId : body.projectId, 300);
  if (projectId && !allowed.has(projectId)) throw new CommitmentError(403, 'Project is not accessible in this organization.');
  const getCandidates = async () => {
    if (!projectId) throw new CommitmentError(400, 'Choose a project for promise evidence.');
    const threadId = bounded(request.method === 'GET' ? query.threadId : body.threadId, 160);
    const envelope = await deps.memory({ method: 'POST', body: { kind: threadId ? 'thread' : 'project', id: threadId || projectId, projectId } }, member);
    if (envelope.memory_status.state !== 'current') throw new CommitmentError(409, 'Source evidence is stale. Refresh it before review.');
    return promiseCandidates(envelope);
  };
  if (request.method === 'GET' && query.view === 'candidates') return { data: await getCandidates(), bounded: true };
  const id = bounded(request.method === 'GET' ? query.id : body.id, 160);
  if (id && !/^ob_[a-zA-Z0-9_-]+$/.test(id)) throw new CommitmentError(400, 'Invalid obligation ID.');
  if (request.method === 'GET') {
    if (id) {
      const row = await deps.read(member.orgId, id);
      if (!row || row.orgId !== member.orgId || !allowed.has(row.projectId)) throw new CommitmentError(404, 'Obligation not found.');
      if (!await canReadCandidate(row)) throw new CommitmentError(409, 'Candidate source changed or is inaccessible. Refresh permitted evidence before review.');
      return { item: visible(await refreshAcceptedSource(row)), viewerUid: member.uid };
    }
    const after = bounded(query.after, 160);
    if (after && !/^ob_[a-zA-Z0-9_-]+$/.test(after)) throw new CommitmentError(400, 'Invalid cursor.');
    const page = await deps.list(member.orgId, after, 50);
    const party = bounded(query.party, 300);
    const mine = `user:${member.uid}`;
    const scoped = page.rows.filter(row => row.orgId === member.orgId && allowed.has(row.projectId)
      && (!projectId || row.projectId === projectId)
      && (!party || row.terms.owner === party || row.terms.beneficiary === party)
      && (query.view !== 'owing' || row.terms.owner === mine)
      && (query.view !== 'owed' || row.terms.beneficiary === mine));
    const readable = await Promise.all(scoped.map(canReadCandidate));
    return { data: (await Promise.all(scoped.filter((_,index) => readable[index]).map(refreshAcceptedSource))).map(visible), next: page.next, viewerUid: member.uid };
  }
  if (!['POST','PATCH'].includes(request.method || '')) throw new CommitmentError(405, 'Method not allowed.');
  const now = Date.now(); const askId = `ask_${randomUUID().replaceAll('-','')}`;
  if (request.method === 'POST') {
    if (!projectId) throw new CommitmentError(400, 'Choose a project.');
    let source: CommitmentSource | undefined;
    if (body.sourceId) {
      source = body.sourceProvider==='promise-ledger.v1'
        ? ledgerSource(await handlePromiseLedger(member,{operation:'read',promiseId:body.sourceId,projectId},{projects:deps.projects}))
        : (await getCandidates()).find(row => row.id === body.sourceId);
      if (!source) throw new CommitmentError(404, 'Current permitted source evidence is unavailable.');
    }
    const newId = source ? sourceCommitmentId(projectId, source.id) : `ob_${randomUUID().replaceAll('-','')}`;
    const next = createCommitment({ id: newId, orgId: member.orgId, projectId, actor: member.uid, now, askId,
      // Suggested or legacy source terms never become confirmed operational terms.
      terms: source ? { deliverable: source.wording } : body.terms, source });
    const item = await deps.transact(member.orgId, newId, existing => {
      if (!existing) return next;
      if (existing.orgId !== member.orgId || existing.projectId !== projectId) throw new CommitmentError(403, 'Source identity does not belong to this project.');
      if (!source || existing.source?.version === source.version || existing.observedSourceVersion === source.version) return existing;
      if (existing.reviewerUid !== member.uid) throw new CommitmentError(403, 'Only the reviewer can refresh this candidate.');
      // Keep accepted terms and their original citation, flag new source evidence for review.
      if (existing.state !== 'candidate') return { ...existing, sourceChanged: true, observedSourceVersion: source.version, version: existing.version + 1,
        ...(existing.review ? { review: { ...existing.review, version: existing.version + 1, ask: { ...existing.review.ask, revision: existing.version + 1 } } } : {}),
        updatedAt: now, history: [...existing.history, { version: existing.version + 1, at: now, actor: member.uid, action: 'source_changed', note: source.version }] };
      const refreshed = createCommitment({ ...next, actor: member.uid, now, askId, source, terms: existing.terms });
      refreshed.version = existing.version + 1;
      refreshed.review!.version = refreshed.version; refreshed.review!.ask.revision = refreshed.version;
      refreshed.asks = [...existing.asks, ...(existing.review ? [{ ...existing.review.ask, status: 'cancelled' as const }] : [])];
      refreshed.createdAt = existing.createdAt;
      refreshed.history = [...existing.history, { version: refreshed.version, at: now, actor: member.uid, action: 'source_refreshed', note: source.version }];
      return refreshed;
    });
    return { item: visible(item), viewerUid: member.uid };
  }
  if (!id || !Number.isSafeInteger(body.expectedVersion)) throw new CommitmentError(400, 'Obligation ID and expectedVersion are required.');
  const existing = await deps.read(member.orgId, id);
  if (!existing || existing.orgId !== member.orgId || !allowed.has(existing.projectId)) throw new CommitmentError(404, 'Obligation not found.');
  if (projectId && existing.projectId !== projectId) throw new CommitmentError(403, 'Project does not match this obligation.');
  if (body.action === 'respond' && existing.state === 'candidate' && existing.source) {
    const source = existing.source.provider==='promise-ledger.v1'?await currentLedgerSource(existing)
      :(await currentSources(existing.projectId, existing.source.threadId)).find(row => row.id === existing.source!.id);
    if (!source || source.version !== existing.source.version) throw new CommitmentError(409, 'Source evidence changed or is inaccessible. Refresh the candidate before acceptance.');
  }
  const item = await deps.transact(member.orgId, id, row => {
    if (!row || row.orgId !== member.orgId || !allowed.has(row.projectId)) throw new CommitmentError(404, 'Obligation not found.');
    return transitionCommitment(row, body, member.uid, now, askId);
  });
  return { item: visible(item), viewerUid: member.uid };
}
