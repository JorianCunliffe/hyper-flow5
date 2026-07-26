import { generateText } from 'ai';
import { openaiProvider } from './ai-provider';
import { supabase } from './supabase';
import { buildContextForNumber, buildSystemPrompt } from './prompts';
import { buildAiSdkTools } from './tools';
import type { PhoneConfig } from '@/types';

export async function handleIncomingSms({
  from,
  to,
  body,
  messageSid,
}: {
  from: string;
  to: string;
  body: string;
  messageSid: string;
}): Promise<string> {
  // 1. Look up or create the contact
  const { contact, contextBlock } = await buildContextForNumber(from);

  let contactId = contact?.id ?? null;
  if (!contactId) {
    const { data: created } = await supabase
      .from('contacts')
      .insert({ phone_number: from })
      .select('id')
      .single();
    contactId = created?.id ?? null;
  }

  // 2. Phone config for our Twilio number
  const { data: config } = (await supabase
    .from('phone_configs')
    .select('*')
    .eq('twilio_number', to)
    .single()) as { data: PhoneConfig | null };

  if (config && !config.sms_enabled) {
    return ''; // SMS disabled for this number — return empty (no reply)
  }

  // 3. Find or create the SMS thread
  let { data: thread } = await supabase
    .from('sms_threads')
    .select('id')
    .eq('phone_number', from)
    .eq('twilio_number', to)
    .single();

  if (!thread) {
    const { data: created } = await supabase
      .from('sms_threads')
      .insert({
        phone_number: from,
        twilio_number: to,
        contact_id: contactId,
        phone_config_id: config?.id ?? null,
      })
      .select('id')
      .single();
    thread = created;
  }

  const threadId = thread?.id;

  // 4. Load the last 20 messages for context
  const { data: history } = await supabase
    .from('sms_messages')
    .select('role, content')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
    .limit(20);

  // 5. Save the inbound message before generating reply
  await supabase.from('sms_messages').insert({
    thread_id: threadId,
    twilio_message_sid: messageSid,
    direction: 'inbound',
    role: 'user',
    content: body,
    status: 'received',
  });

  // 6. Build system prompt — use config's sms_system_prompt if set
  const systemPrompt = config?.sms_system_prompt
    ? `${config.sms_system_prompt}\n\nContact context:\n${contextBlock}`
    : buildSystemPrompt('inbound', contextBlock);

  // 7. Build tools if any are enabled
  const enabledTools = config?.enabled_tools ?? [];
  const tools = enabledTools.length
    ? buildAiSdkTools(enabledTools, { phoneNumber: from, twilioNumber: to })
    : undefined;

  // 8. Generate reply
  const { text: reply } = await generateText({
    model: openaiProvider('gpt-4o'),
    system: systemPrompt,
    messages: [
      ...(history ?? []).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user' as const, content: body },
    ],
    tools,
    maxSteps: tools ? 5 : 1,
    maxTokens: 300,
  });

  // 9. Save the outbound reply and update thread timestamp
  await Promise.all([
    supabase.from('sms_messages').insert({
      thread_id: threadId,
      direction: 'outbound',
      role: 'assistant',
      content: reply,
      status: 'sent',
    }),
    supabase
      .from('sms_threads')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', threadId),
  ]);

  return reply;
}
