export const ambientCaptureInstructions = `When the user mentions potentially actionable work outside the current flow objective, call captureWorkItem. Keep the user's original words. Use a stable idempotencyKey for this utterance and reuse it on retries. Capture without asking for a project, date or other missing details. Only after the tool reports success, briefly acknowledge and return to the current conversation. If capture fails, say it was not saved and continue; never claim success. Do not capture filler, completed actions, duplicate tool retries, or matters already handled by the current node. Suggestions never authorize execution.`;
export const captureWorkItemTool = {
  name: 'captureWorkItem',
  description: 'Durably capture an unrelated actionable thought without interrupting the current conversation. Returns the capture ID; does not execute the work.',
  parametersJsonSchema: {
    type: 'object', additionalProperties: false,
    properties: {
      rawText: { type: 'string', description: 'Original actionable statement' },
      idempotencyKey: { type: 'string', description: 'Stable utterance/event ID plus item ordinal, reused on retry' },
      title: { type: 'string' },
      kind: { type: 'string', enum: ['task', 'meeting', 'reminder', 'follow_up', 'note', 'unknown'] },
      proposedProjectName: { type: 'string' }
    }, required: ['rawText', 'idempotencyKey']
  }
};
