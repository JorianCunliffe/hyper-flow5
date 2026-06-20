import { supabase } from './supabase';
import type { Contact } from '@/types';

export async function buildContextForNumber(
  phoneNumber: string,
): Promise<{ contact: Contact | null; contextBlock: string }> {
  const { data: contact } = await supabase
    .from('contacts')
    .select('*')
    .eq('phone_number', phoneNumber)
    .single();

  if (!contact) {
    return {
      contact: null,
      contextBlock: `Caller phone: ${phoneNumber}\nNo record found in the database.`,
    };
  }

  const lines: string[] = [
    `Name: ${contact.name || 'Unknown'}`,
    `Phone: ${contact.phone_number}`,
  ];
  if (contact.email) lines.push(`Email: ${contact.email}`);
  if (contact.company) lines.push(`Company: ${contact.company}`);
  if (contact.notes) lines.push(`Notes: ${contact.notes}`);
  if (contact.tags?.length) lines.push(`Tags: ${contact.tags.join(', ')}`);
  if (contact.custom_data && Object.keys(contact.custom_data).length) {
    lines.push(`Additional: ${JSON.stringify(contact.custom_data)}`);
  }

  return { contact, contextBlock: lines.join('\n') };
}

export function buildSystemPrompt(
  direction: 'inbound' | 'outbound',
  contextBlock: string,
  customInstructions?: string,
): string {
  const defaultInstructions = customInstructions
    ? customInstructions
    : `You are a professional AI assistant handling a ${direction} phone call.
Be conversational, warm, and concise — this is voice, so keep responses short.
If you know the caller's name, use it naturally. Take notes and answer questions helpfully.`;

  return `${defaultInstructions}

Caller context:
${contextBlock}`;
}
