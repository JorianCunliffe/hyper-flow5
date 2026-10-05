import React from 'react';

/** A failed connection check is not evidence that an account has no mailboxes. */
export function ServiceStatusNotices({ status }: { status?: { mailboxStatus?: string; upgradeRequired?: boolean; lastRun?: { status?: string; error?: string; retryAfter?: number; manualReviewRequired?: boolean; recoveryAskId?: string; recoveryDeadlineAt?: number; recoveryReviewedAt?: number } } }) {
  return <>
    {!!status?.lastRun?.recoveryReviewedAt && <p role="status" className="mt-2 text-xs font-bold text-slate-700">
      Recovery review closed. This occurrence remains failed and held; no retry was requested.
    </p>}
    {status?.lastRun?.manualReviewRequired && <p role="status" className="mt-2 text-xs font-bold text-red-700">
      Outbound action failed — manual review required. {status.lastRun.recoveryAskId ? 'An operator Ask is available in the project inbox.' : 'Operator escalation is being saved.'} The original provider receipt is retained; no replacement call will be placed.
    </p>}
    {status?.lastRun?.status === 'blocked' && <p role="status" className="mt-2 text-xs font-bold text-amber-700">
      Outbound operation held for reconciliation. No new call will be placed. {status.lastRun.error}
      {!!status.lastRun.recoveryDeadlineAt && <> Review deadline: {new Date(status.lastRun.recoveryDeadlineAt).toLocaleString()}.</>}
    </p>}
    {!!status?.lastRun?.retryAfter && status.lastRun.status === 'recoverable' && <p role="status" className="mt-2 text-xs font-bold text-amber-700">
      Provider unavailable. The same occurrence will be checked again after {new Date(status.lastRun.retryAfter).toLocaleString()}. {status.lastRun.error}
    </p>}

    {status?.mailboxStatus === 'unavailable' && <p role="status" className="mt-2 text-xs font-bold text-amber-700">
      Mailbox status is unavailable. Check the Communications connection before relying on this status report.
    </p>}
    {status?.upgradeRequired && <p role="status" className="mt-2 text-xs font-bold text-amber-700">
      A legacy triage schedule is not linked to a project. Review it in schedule settings to link or pause it. Reading this status has not changed the schedule.
    </p>}
  </>;
}
