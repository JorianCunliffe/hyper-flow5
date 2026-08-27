export const TASK_TYPES = ['send_email', 'send_sms', 'outgoing_call', 'webhook', 'write_report'] as const;

const TASK_TYPE_ALIASES: Record<string, string> = {
  email: 'send_email', sendemail: 'send_email', mail: 'send_email',
  sms: 'send_sms', sendsms: 'send_sms', text: 'send_sms', textmessage: 'send_sms',
  phonecall: 'outgoing_call', call: 'outgoing_call', phone: 'outgoing_call',
  outgoingcall: 'outgoing_call', voice: 'outgoing_call', voicecall: 'outgoing_call',
  webhook: 'webhook', http: 'webhook', post: 'webhook',
  report: 'write_report', writereport: 'write_report', writeup: 'write_report'
};

export const normalizeTaskType = (raw: string | undefined): string | undefined => {
  if (!raw) return undefined;
  const trimmed = String(raw).trim();
  if ((TASK_TYPES as readonly string[]).includes(trimmed)) return trimmed;
  return TASK_TYPE_ALIASES[trimmed.toLowerCase().replace(/[\s_-]+/g, '')];
};

