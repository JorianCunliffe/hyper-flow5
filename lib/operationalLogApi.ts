import type { VercelRequest, VercelResponse } from './http/vercelTypes.js';
import { ApiAuthError, requireAppMember } from './apiAuth.js';
import { archiveOperationalEvents, logQuery, operationalLogHealth, readOperationalEvents, recordOperationalEvent } from './operationalLog.js';
import { runtimeDatabase } from './runtimeDatabase.js';
import { HttpCommunicationsClient } from './communications/clientCore.js';

export const createOperationalLogHandler = (deps = { authenticate:requireAppMember, read:readOperationalEvents, health:operationalLogHealth }) => async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control','no-store');
  try {
    if (!['GET','POST'].includes(req.method || '')) return res.status(405).json({error:'Method not allowed'});
    const source = req.method === 'GET' ? req.query : req.body || {};
    const member = await deps.authenticate(req, typeof source.orgId === 'string' ? source.orgId : undefined);
    if (!['owner','admin'].includes(member.role)) throw new ApiAuthError(403,'Administrator required for operational history');
    if (req.method === 'GET') {
      if(source.service && !['hyperflow','communications'].includes(source.service))return res.status(422).json({error:'Unknown log service'});
      if (source.service === 'communications') {
        const remote=await new HttpCommunicationsClient().getOperationalLog(member.orgId,Object.fromEntries(Object.entries(source).filter(([,v])=>typeof v==='string')) as Record<string,string>);
        if(source.format==='ndjson'){
          res.setHeader('Content-Type','application/x-ndjson');if(remote.next)res.setHeader('X-Next-Cursor',remote.next);
          return res.status(200).send((remote.items||[]).map((x:any)=>JSON.stringify(x)).join('\n')+((remote.items||[]).length?'\n':''));
        }
        return res.status(200).json(remote);
      }
      if (source.operation === 'health') return res.status(200).json(await deps.health(member.orgId));
      let query; try { query = logQuery(source); } catch { return res.status(422).json({error:'Invalid log query'}); }
      const page = await deps.read(member.orgId,query);
      if (source.format === 'ndjson') {
        res.setHeader('Content-Type','application/x-ndjson');
        if (page.next) res.setHeader('X-Next-Cursor',page.next);
        return res.status(200).send(page.items.map(x=>JSON.stringify(x)).join('\n') + (page.items.length?'\n':''));
      }
      return res.status(200).json(page);
    }
    if (member.apiClientId) throw new ApiAuthError(403,'Human administrator required for log lifecycle changes');
    if (source.operation === 'configure') {
      const days = source.hotRetentionDays;
      if (!Number.isSafeInteger(source.expectedRevision) || source.expectedRevision < 0) return res.status(422).json({error:'expectedRevision must be a nonnegative integer'});
      if (!Number.isInteger(days) || days < 7 || days > 3650) return res.status(422).json({error:'hotRetentionDays must be 7–3650'});
      const ref = (await runtimeDatabase()).ref(`operational_log_policy/${member.orgId}`);
      const result = await ref.transaction(current => Number(current?.revision || 0) === source.expectedRevision ? {hotRetentionDays:days,revision:source.expectedRevision+1} : undefined);
      if (!result.committed) return res.status(409).json({error:'Policy changed; reread before saving'});
      await recordOperationalEvent({tenantId:member.orgId,type:'log.policy_changed',actorId:member.uid,details:{revision:source.expectedRevision+1}});
      return res.status(200).json(result.snapshot.val());
    }
    if (source.operation === 'archive') {
      const result = await archiveOperationalEvents(member.orgId);
      await recordOperationalEvent({tenantId:member.orgId,type:'log.archived',actorId:member.uid,details:{count:result.archived}});
      return res.status(200).json(result);
    }
    return res.status(422).json({error:'Unknown log operation'});
  } catch (error) {
    return res.status(error instanceof ApiAuthError ? error.status : 503).json({error:error instanceof ApiAuthError ? error.message : 'Operational log unavailable'});
  }
};
export default createOperationalLogHandler();
