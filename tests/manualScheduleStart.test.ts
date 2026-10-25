import test from 'node:test';
import assert from 'node:assert/strict';
import { startScheduleNow } from '../lib/manualScheduleStart.js';
import { manualScheduleReservationValue, normalizeTenantSchedule } from '../lib/serverStore.js';
import { pendingManualScheduleOccurrence } from '../lib/scheduleConcurrency.js';

const now = Date.parse('2026-10-25T02:30:00Z');
const tomorrow = Date.parse('2026-10-25T23:00:00Z');
const old = Date.parse('2026-10-13T23:00:00Z');
const schedule = (extra: any = {}) => normalizeTenantSchedule('org', 'schedule_coaching', {
  name: 'Daily coaching', activity: 'flow_start', projectId: 'p', enabled: false, nextRunAt: old,
  timezone: 'Australia/Brisbane', recurrence: { kind: 'daily', localTime: '09:00' }, ...extra
}, null, now);

test('Resume recalculates future daily time and interval without replaying paused dates', () => {
  const s = schedule({ manualStartAt: 42 });
  assert.equal(normalizeTenantSchedule('org', s.id, { enabled: true }, s, now).nextRunAt, tomorrow);
  const weekday = schedule({ recurrence: { kind: 'daily', localTime: '09:00', daysOfWeek: [1,2,3,4,5] } });
  assert.equal(normalizeTenantSchedule('org', weekday.id, { enabled: true }, weekday, Date.parse('2026-10-23T23:30:00Z')).nextRunAt, tomorrow);
  const interval = schedule({ recurrence: { kind: 'interval', intervalMinutes: 30 } });
  assert.equal(normalizeTenantSchedule('org', interval.id, { enabled: true }, interval, now).nextRunAt, now + 30*60000);
  assert.equal(normalizeTenantSchedule('org', s.id, { enabled: false }, s, now).nextRunAt, old);
  assert.equal(normalizeTenantSchedule('org', s.id, { enabled: true, nextRunAt: old }, s, now).nextRunAt, old, 'The store can preserve an unresolved head explicitly');
});

test('manual restart atomically enables the future timer and coalesces competing starts', () => {
  const s = schedule();
  const first = manualScheduleReservationValue(s, s, now, true, now)!;
  assert.equal(first.manualStartAt, now); assert.equal(first.enabled, true); assert.equal(first.nextRunAt, tomorrow);
  assert.deepEqual(manualScheduleReservationValue(first, s, now+1, true, now+1), first);
  assert.equal(manualScheduleReservationValue({...s,name:'edited'}, s, now, true, now), undefined);
  assert.throws(()=>manualScheduleReservationValue({...s,recoveryPendingId:'held'},s,now,true,now),/recovery/);
  assert.throws(()=>manualScheduleReservationValue(null,s,now,true,now),/recovery/);
  const updated = normalizeTenantSchedule('org', first.id, { enabled: false }, first, now+2);
  assert.equal(updated.manualStartAt, now, 'Configuration edits cannot drop the reservation');
});

function fixture(runs: any[] = [], canStartNewRun = true) {
  const starts: number[] = []; const reservations: number[] = [];
  const deps: any = {
    now: () => now,
    findProject: async () => ({ project: { id: 'p', projectData: { project_template: 'daily_coaching' } } }),
    listScheduleRuns: async () => runs,
    readScheduleRun: async (_s: any, at: number) => runs.find(r => r.scheduledFor === at) || null,
    readServiceRunProgress: async () => ({ canStartNewRun }),
    reserveManualScheduleStart: async (s: any, at: number, restart: boolean) => {
      reservations.push(at); return manualScheduleReservationValue(s,s,at,restart,now);
    },
    runTenantSchedule: async (_s: any, at: number) => { starts.push(at); return { status: 'deferred' }; }
  };
  return { deps, starts, reservations };
}

test('Start now creates one new occurrence after review, restarts daily schedule and preserves review', async () => {
  const review = { scheduledFor: old, status: 'waiting' };
  const f = fixture([review]); const result = await startScheduleNow(schedule(), now, f.deps);
  assert.deepEqual(f.starts,[now]); assert.deepEqual(f.reservations,[now]);
  assert.equal(result.nextRunAt,tomorrow); assert.equal(result.scheduleEnabled,true);
  assert.deepEqual(review,{scheduledFor:old,status:'waiting'});
});

test('an active call or timer continues the same occurrence and does not rebase or duplicate it', async () => {
  const f = fixture([{ scheduledFor: old, status: 'waiting' }], false);
  const result = await startScheduleNow(schedule(), now, f.deps);
  assert.equal(result.scheduledFor,old); assert.deepEqual(f.starts,[old]); assert.deepEqual(f.reservations,[old]);
  assert.equal(result.nextRunAt,old,'Adopting an unfinished session cannot rebase its timer');
  assert.equal(result.scheduleEnabled,false);
});

test('unknown provider effects and acknowledged replays keep original identities', async () => {
  const held = fixture([{ scheduledFor: old, status: 'blocked', providerCode: 'IDEMPOTENCY_RECONCILIATION_REQUIRED' }]);
  assert.equal((await startScheduleNow(schedule(),now,held.deps)).scheduledFor,old);
  assert.deepEqual(held.reservations,[]);
  const replay = fixture([{scheduledFor:now,status:'waiting'}]);
  assert.equal((await startScheduleNow(schedule(),now,replay.deps)).scheduledFor,now);
  assert.deepEqual(replay.reservations,[]);
});

test('a reserved start with no occurrence receipt is resumed instead of allocating another', async () => {
  const f = fixture([{scheduledFor:old,status:'waiting'}]);
  const result = await startScheduleNow({...schedule(),manualStartAt:now-1000},now,f.deps);
  assert.equal(result.scheduledFor,now-1000);assert.deepEqual(f.reservations,[]);
});

test('the automatic timer cannot overlap a pending or unknown manual session', async () => {
  const s = { ...schedule(), manualStartAt: now };
  const f = fixture([{scheduledFor:now,status:'waiting'}],false);
  assert.equal(await pendingManualScheduleOccurrence(s,tomorrow,f.deps),now);
  assert.equal(await pendingManualScheduleOccurrence(s,now,f.deps),null,'The original session can reconcile');
  f.deps.readServiceRunProgress=async()=>({canStartNewRun:true});
  assert.equal(await pendingManualScheduleOccurrence(s,tomorrow,f.deps),null,'Reviewed or completed sessions release the timer');
  f.deps.readScheduleRun=async()=>null;
  assert.equal(await pendingManualScheduleOccurrence(s,tomorrow,f.deps),now,'An unconfirmed reservation never permits a second call');
});
