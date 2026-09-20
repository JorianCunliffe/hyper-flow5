import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectReviewSources} from '../lib/reviewSources.js';
import type {CalendarLedger} from '../lib/calendar/model.js';
const ledger = {id:'calendar',connectionId:'google',calendarId:'primary',policies:{p1:{timezone:'Australia/Brisbane'},p2:{timezone:'Australia/Brisbane'}},proposals:{}} as unknown as CalendarLedger;
const now=new Date('2026-09-20T02:00:00Z');
test('reads shared calendars once, normalizes all-day dates and omits resolved holds and secret tokens',async()=>{
 let reads=0;
 const result=await collectReviewSources('org',['p1','p2'],{now,ledgers:async()=>[ledger],events:async()=>{reads++;return [{id:'event',etag:'1',summary:'Meeting',start:{date:'2026-09-20'},end:{date:'2026-09-21'}},{id:'deleted',etag:'2',status:'cancelled'}];},holds:async projectId=>({run:{open:{id:'open',orgId:'org',projectId,kind:'human',status:'waiting',askToken:'SECRET',updatedAt:now.getTime()},done:{id:'done',orgId:'org',projectId,kind:'human',status:'resolved'},other:{id:'other',orgId:'another',projectId,kind:'human',status:'waiting'}}})});
 assert.equal(reads,1);
 assert.equal(result[0].state,'current');
 assert.equal(result[0].items[0].starts_at,'2026-09-19T14:00:00.000Z');
 assert.equal(result[0].items.length,1);
 assert.deepEqual(result[1].items.map(h=>h.id),['open']);
 assert.equal(JSON.stringify(result).includes('SECRET'),false);
});
test('provider failures and capped configuration never claim empty complete calendars',async()=>{
 const failed=await collectReviewSources('org',['p1'],{now,ledgers:async()=>[ledger],events:async()=>{throw new Error('provider');},holds:async()=>{throw new Error('database');}});
 assert.deepEqual(failed.map(s=>s.state),['unavailable','unavailable']);
 const unconfigured=await collectReviewSources('org',['p1'],{now,ledgers:async()=>[],holds:async()=>({})});
 assert.equal(unconfigured[0].state,'not_configured');
 assert.equal(unconfigured[1].state,'current');
 const capped=await collectReviewSources('org',['p1'],{now,ledgers:async()=>Array(100).fill(ledger),events:async()=>{throw new Error('must not read');},holds:async()=>({})});
 assert.equal(capped[0].state,'unavailable');
});
test('a later snapshot removes completed workflow holds',async()=>{
 const first=await collectReviewSources('org',['p1'],{now,ledgers:async()=>[],holds:async()=>({run:{one:{id:'one',orgId:'org',projectId:'p1',kind:'human',status:'waiting',updatedAt:now.getTime()}}})});
 const second=await collectReviewSources('org',['p1'],{now,ledgers:async()=>[],holds:async()=>({run:{one:{id:'one',orgId:'org',projectId:'p1',kind:'human',status:'resolved',updatedAt:now.getTime()}}})});
 assert.equal(first[1].items.length,1);assert.equal(second[1].items.length,0);
});
