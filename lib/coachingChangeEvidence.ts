/** Speech describes intent. Only the call's persisted receipts establish live changes. */
export function coachingChangeEvidence(transcript: string, callId: string, changes: any[], available = true) {
  const discussesChanges = /\b(approv\w*|reject\w*|set (?:it|this|that)|mark (?:it|this|that)|change (?:the )?status)\b/i.test(transcript);
  const completed = changes.filter(row => row.callId === callId && row.status === 'completed');
  const unresolved = changes.filter(row => row.callId === callId && row.status !== 'completed');
  const requiresReview = discussesChanges && (!available || !completed.length || unresolved.length > 0);
  return {
    requiresReview,
    completed: completed.map(row => ({ id: row.id, action: row.action, title: row.item?.title })),
    instruction: 'Do not include verification codes. A spoken request, completed-work claim, or yes is not a saved change. Only the completed receipts below prove a live change. Attribute other progress to the caller. Never report requested approvals as completed without a matching receipt.',
    ...(requiresReview ? { summary: 'The caller discussed live work changes, but the saved receipts do not confirm that all requested changes completed. Review the call before recording approvals as completed.' } : {}),
  };
}
