import { NodeType } from '../../../types.js';

// Synthetic identities only. Configuration is inert until explicitly run by a test.
export const setup = {
  orgId: 'sharehouse-test', mailbox: 'outlook-fixture', spreadsheet: 'sheet-fixture',
  schedule: { localTime: '09:15', timezone: 'Australia/Brisbane', daysOfWeek: [1, 2, 3, 4, 5], enabled: false },
  team: { primaryPersonId: 'team-primary', fallbackPersonId: 'team-fallback' },
  resources: [
    { name: 'tasks', range: 'Tasks!A2:H', operations: ['read', 'append'] },
    { name: 'enquiries', range: 'Enquiries!A2:J', operations: ['read', 'upsert'] },
    { name: 'communications', range: 'Communications!A2:G', operations: ['read', 'append'] },
    { name: 'inspections', range: 'Inspections!A2:F', operations: ['read', 'append'] },
  ],
};
export const enquiries = ['E1', 'E2', 'E3', 'E4'].map((id, i) => ({
  id, source_message_id: id, email: `${id.toLowerCase()}@example.invalid`,
  name: `Fixture ${id}`, property: 'Fixture House', mobile: i < 2,
  attended: id === 'E4', reply: 'Proposed inspection; staff confirmation required.',
}));
export const mailbox = [...enquiries, { id: 'A1', kind: 'actionable' }, { id: 'N1', kind: 'non-essential' }, enquiries[0]];
const taskRows = [...enquiries, { id: 'A1', source_message_id: 'A1' }].map(item => ({
  id: item.id, rows: [['2026-09-28', item.id, `${item.id}@example.invalid`, '', 'Fixture House', 'Review request', item.source_message_id, 'open']],
}));
export const planned = {
  summary: 'Group E1 and E2; E3 needs human email delivery; E4 already attended.',
  enquiries,
  open_questions: [{ name: 'inspection_confirmed', type: 'boolean', label: 'Confirm the proposed inspection?', required: true }],
};
const action = (id: string, nodeType: NodeType, dependsOn: string[], template: object, resultVariable?: string, forEach?: object): any => ({
  id, name: id.replaceAll('_', ' '), nodeType, dependsOn, subtasks: [],
  actionConfig: { autoExecute: true, template: JSON.stringify(template), ...(resultVariable ? { resultVariable } : {}), ...(forEach ? { forEach } : {}) },
});
const hold = (id: string, dependsOn: string[], prompt: string, fieldsSource?: string, mode: 'morning' | 'incident' = 'morning'): any => ({
  id, name: id.replaceAll('_', ' '), nodeType: NodeType.WAIT, subtasks: [], dependsOn,
  holdConfig: { kind: 'human', payloadVariable: `${id}_answer`, human: {
    kind: 'question', prompt, ...(fieldsSource ? { fieldsSource } : { fields: [{ name: 'team_answer', label: 'Where is the team?', type: 'string', required: true }] }),
    channels: ['web', 'voice', 'sms'], assignees: ['team-primary'],
    escalation: { mode, ...setup.team, retryMinutes: 10, repeatLocalTime: '09:15', timezone: 'Australia/Brisbane', daysOfWeek: [1, 2, 3, 4, 5] },
  } },
});
export function fullWorkflow(): any {
  return {
    id: 'sharehouse-fixture', name: 'Sharehouse full workflow — isolated', company: 'Fixture', type: 'Other', startDate: 0,
    projectData: { triage_connection_id: setup.mailbox },
    milestones: [
      action('triage', NodeType.EMAIL_TRIAGE, [], { connection_id: setup.mailbox }, 'intake'),
      action('read_enquiries', NodeType.GOOGLE_SHEET_READ, [], { resource_name: 'enquiries' }, 'existing'),
      action('read_inspections', NodeType.GOOGLE_SHEET_READ, [], { resource_name: 'inspections' }, 'slots'),
      action('write_tasks', NodeType.GOOGLE_SHEET_APPEND, ['triage'], { resource_name: 'tasks', values: '{{item.rows}}', idempotency_key: '{{item.id}}' }, 'written', { source: 'intake_output.tasks', key: 'id' }),
      action('plan', NodeType.REPORT, ['write_tasks', 'read_enquiries', 'read_inspections'], { prompt: 'Produce the inspection plan and questions, excluding attended enquirers.', source_data: { intake: '{{intake_output}}', enquiries: '{{existing_output}}', inspections: '{{slots_output}}' } }, 'plan'),
      action('drafts', NodeType.MAILBOX_DRAFT, ['plan'], { to: ['{{item.email}}'], subject: 'Fixture inspection enquiry', text: '{{item.reply}}', in_reply_to: '{{item.source_message_id}}' }, 'drafts', { source: 'plan_output.enquiries', key: 'id' }),
      hold('morning_answers', ['drafts'], 'Read the plan {{plan_output.summary}} and each draft {{drafts_output}}. Ask every open question and confirm each answer.', 'plan_output.open_questions'),
      action('finalise', NodeType.REPORT, ['morning_answers'], { prompt: 'Use only confirmed answers to finalise existing drafts and inspection allocations.', answers: '{{morning_answers_answer}}', drafts: '{{drafts_output}}' }, 'final'),
      action('update_drafts', NodeType.MAILBOX_DRAFT_UPDATE, ['finalise'], { provider_draft_id: '{{item.provider_draft_id}}', to: ['{{item.email}}'], subject: 'Confirmed fixture inspection', text: '{{item.text}}' }, 'updated', { source: 'final_output.drafts', key: 'provider_draft_id' }),
      action('upsert_enquiries', NodeType.GOOGLE_SHEET_UPSERT, ['update_drafts'], { resource_name: 'enquiries', values: '{{item.row}}', key_column: 2, key_value: '{{item.email}}', idempotency_key: '{{item.operationId}}', expected_rows: '{{existing_output.google_sheet_values}}' }, 'allocated', { source: 'final_output.enquiries', key: 'email' }),
      action('write_slots', NodeType.GOOGLE_SHEET_APPEND, ['upsert_enquiries'], { resource_name: 'inspections', values: '{{item.rows}}', idempotency_key: '{{item.id}}' }, 'booked', { source: 'final_output.slots', key: 'id' }),
      action('notify', NodeType.SMS, ['write_slots'], { person_id: '{{item.personId}}', body: '{{item.body}}' }, 'notified', { source: 'final_output.notifications', key: 'personId' }),
      action('audit', NodeType.GOOGLE_SHEET_APPEND, ['notify'], { resource_name: 'communications', values: '{{final_output.auditRows}}', idempotency_key: '{{final_output.auditOperationId}}' }, 'audited'),
      { id: 'inbound', name: 'Inspection enquiry event', nodeType: NodeType.EVENT_TRIGGER, dependsOn: [], subtasks: [], eventTriggerConfig: { eventTypes: ['communication.received'], channels: ['sms'], directions: ['inbound'], personIds: ['enquirer-E1', 'enquirer-E2'], payloadVariable: 'incident' } },
      action('acknowledge', NodeType.SMS, ['inbound'], { target_source: 'event_person', body: 'I am checking with the team.' }, 'acknowledged'),
      hold('incident_answers', ['acknowledge'], 'Confirm where the team is for this inspection.', undefined, 'incident'),
      action('reply', NodeType.SMS, ['incident_answers'], { target_source: 'event_person', body: '{{incident_answers_answer.values.team_answer}}' }, 'replied'),
      action('incident_audit', NodeType.GOOGLE_SHEET_APPEND, ['reply'], { resource_name: 'communications', values: [['Fixture incident resolved']], idempotency_key: '{{flow_run_id}}' }, 'incident_logged'),
    ],
  };
}

// Canned boundaries are intentionally explicit: this does not test classifier/model/providers.
export const fixtures = {
  triage: { status: 'success', output: { tasks: taskRows, enquiries } },
  read_enquiries: { status: 'success', output: { attended: ['E4'], google_sheet_values: [['2026-09-28', 'Fixture E4', 'e4@example.invalid', '', 'Fixture House', 'attended', '', 'true', '', '2026-09-28']] } },
  read_inspections: { status: 'success', output: { slots: [] } },
  write_tasks: { status: 'success', output: { appended: true } },
  plan: { status: 'success', output: planned },
  drafts: { status: 'success', output: { provider_draft_id: 'fixture-draft' } },
  acknowledge: { status: 'success', output: { delivered: true } },
};

export const knownGaps = [
  'Provider outcomes and planning/classification are canned, not acceptance evidence.',
  'Generic test-runs do not resume human answers or external callbacks; the separate continuation regression covers synthetic finalisation only.',
  'Incident escalation has component coverage but the full inbound provider scenario is not verified.',
  'End-of-run audit does not yet prove logging of each failed contact at the time it occurs.',
  'Resource grants, schedule and contact authority need dedicated APIs and UI verification; graph save alone does not configure them.',
  'No complete prompt-compiler representation or live proof of same-field concurrent draft-edit protection; provider-version guards have component coverage.',
];
