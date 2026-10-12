# Held schedule recovery

In a service project's **Service Configuration**, **Resolve held run** opens a human-administrator recovery review. The schedule displays **Enabled — blocked by recovery**, rather than implying that an enabled schedule is running normally. Closing an operator Ask remains separate from releasing scheduling.

The panel reads the original frozen Communications operation key. It distinguishes completed, failed, in-progress, not-dispatched and unknown evidence. Missing receipts alone never prove non-dispatch. Raw provider failures, credentials and call prompts are not returned to the panel.

Choose one action:

- **Close this occurrence and resume future calls:** retains the failed occurrence, its frozen flow and provider receipts; moves the schedule to the next future configured time and enables it. Missed days are skipped even for catch-up schedules. Unknown/in-progress provider outcomes require explicit acknowledgement and remain uncertain. This does not cancel a provider call or claim it never happened.
- **Retry this occurrence:** only available for a recorded pre-dispatch readiness failure, a fresh missing-receipt lookup, an exact original recipient, and a workflow whose original operation identity can be preserved. Requires separate call confirmation. The normal scheduler/executor performs the retry using existing authority, contact-policy and provider-readiness checks. Rejected or uncertain provider operations cannot be replayed with a replacement key.
- **Keep held:** records the findings without releasing the occurrence.

`POST /api/schedules/recovery` requires a human owner/admin session. Machine clients cannot approve recovery.

Preview body: `{operation:"preview",id:"schedule_…",scheduledFor:<epoch milliseconds>}`. Returns `planHash`, `reviewedAt`, provider evidence, exact next time, recipient and retry eligibility, or an existing pending command. Previews expire after ten minutes.

Apply body: `{operation:"apply",id,scheduledFor,requestId,decision,note,planHash,reviewedAt,acceptUncertainty,confirmCall}`. Decisions are `resume_future`, `retry_original`, or `keep_held`. Use a stable request ID. Saving rechecks provider evidence and the schedule/occurrence/flow/dispatch snapshot. Stale reviews return 409.

Recovery is a durable sequence of tenant-scoped transactions, not one cross-tree transaction. A server-owned `recoveryPendingId` fences scheduler ticks and ordinary schedule edits/deletion until the command finishes. Each changed record stores the command ID; lost-response retries finish the same operation. Completed commands return the existing receipt. An interrupted command is resumed with `{operation:"apply",id,scheduledFor,requestId}`. If the approved future time has passed, the panel requires review of the replacement next time before continuing. Conflicting evidence remains held; it is never overwritten to force recovery.

The receipt records the actor, decision, original occurrence, original provider outcome and next schedule time. `callDispatched:false` describes the recovery API itself; a confirmed retry may subsequently be dispatched by the scheduler. Historical calls are not silently marked successful and no backlog of calls is created.

## Verification

`tests/scheduleRecovery.test.ts` exercises closed-review recovery, lost responses at each save, repeated submissions, competing decisions, stale evidence, expired review/time, tenant/role boundaries, weekdays, future-only scheduling and preservation of original retry identity. `tests/e2e/schedule-recovery.html` is a browser fixture with no provider or production access.

Local verification on 12 October 2026: all 1,026 tests passed, including 10 recovery tests; TypeScript, API contract generation/check and production build passed. Browser fixtures verified acknowledgement before future-only resumption, separate retry approval, stale-review rejection and interrupted-save continuation. These results do not establish production deployment or provider acceptance.

Deploy the application before using the production control. Deployment does not approve a recovery decision or place a call. For the held coaching occurrence, review its current evidence and explicitly choose future-only resumption in the deployed panel.

