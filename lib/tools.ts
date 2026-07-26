/**
 * Unified tool definitions and execution.
 *
 * Each tool has:
 *  - A JSON schema for the OpenAI Realtime API (voice)
 *  - A Vercel AI SDK `tool()` builder for SMS / text generation
 *  - A shared `executeTool` function that both paths call
 *
 * Tools are opt-in per phone_config via `enabled_tools: string[]`.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { supabase } from './supabase';

/* ─── Types ─── */

export type ToolName =
  | 'lookup_contact'
  | 'update_contact'
  | 'get_call_history'
  | 'send_sms'
  | 'request_callback';

export interface ToolContext {
  phoneNumber: string;   // external caller / SMS sender
  twilioNumber?: string; // our Twilio number (needed for send_sms)
}

/* ─── Schemas for OpenAI Realtime API session.update ─── */

export const REALTIME_TOOL_SCHEMAS: Record<ToolName, object> = {
  lookup_contact: {
    type: 'function',
    name: 'lookup_contact',
    description: 'Look up a contact\'s full record from the database by phone number.',
    parameters: {
      type: 'object',
      properties: {
        phone_number: { type: 'string', description: 'E.164 number, e.g. +14155550100' },
      },
      required: ['phone_number'],
    },
  },
  update_contact: {
    type: 'function',
    name: 'update_contact',
    description: 'Update notes, name, or company on a contact record.',
    parameters: {
      type: 'object',
      properties: {
        phone_number: { type: 'string', description: 'E.164 number of the contact to update' },
        notes: { type: 'string', description: 'Replace the contact\'s notes with this text' },
        name: { type: 'string', description: 'Contact\'s full name' },
        company: { type: 'string', description: 'Company or organisation' },
      },
      required: ['phone_number'],
    },
  },
  get_call_history: {
    type: 'function',
    name: 'get_call_history',
    description: 'Retrieve recent call history for a contact.',
    parameters: {
      type: 'object',
      properties: {
        phone_number: { type: 'string', description: 'E.164 number' },
        limit: { type: 'number', description: 'How many recent calls to return (default 5)' },
      },
      required: ['phone_number'],
    },
  },
  send_sms: {
    type: 'function',
    name: 'send_sms',
    description: 'Send an SMS to the contact, e.g. to share a link, address, or summary while on a call.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The SMS message text to send' },
      },
      required: ['message'],
    },
  },
  request_callback: {
    type: 'function',
    name: 'request_callback',
    description: 'Log a callback request when the contact wants to be called back.',
    parameters: {
      type: 'object',
      properties: {
        preferred_time: { type: 'string', description: 'When they want to be called back' },
        notes: { type: 'string', description: 'Reason or context for the callback' },
      },
    },
  },
};

/* ─── Vercel AI SDK tools (for SMS / text generation) ─── */

export function buildAiSdkTools(enabledTools: string[], ctx: ToolContext) {
  const all = {
    lookup_contact: tool({
      description: REALTIME_TOOL_SCHEMAS.lookup_contact['description' as keyof object] as string,
      parameters: z.object({ phone_number: z.string() }),
      execute: ({ phone_number }) => executeTool('lookup_contact', { phone_number }, ctx),
    }),
    update_contact: tool({
      description: REALTIME_TOOL_SCHEMAS.update_contact['description' as keyof object] as string,
      parameters: z.object({
        phone_number: z.string(),
        notes: z.string().optional(),
        name: z.string().optional(),
        company: z.string().optional(),
      }),
      execute: (args) => executeTool('update_contact', args as Record<string, unknown>, ctx),
    }),
    get_call_history: tool({
      description: REALTIME_TOOL_SCHEMAS.get_call_history['description' as keyof object] as string,
      parameters: z.object({ phone_number: z.string(), limit: z.number().optional() }),
      execute: ({ phone_number, limit }) =>
        executeTool('get_call_history', { phone_number, limit }, ctx),
    }),
    send_sms: tool({
      description: REALTIME_TOOL_SCHEMAS.send_sms['description' as keyof object] as string,
      parameters: z.object({ message: z.string() }),
      execute: ({ message }) => executeTool('send_sms', { message }, ctx),
    }),
    request_callback: tool({
      description: REALTIME_TOOL_SCHEMAS.request_callback['description' as keyof object] as string,
      parameters: z.object({
        preferred_time: z.string().optional(),
        notes: z.string().optional(),
      }),
      execute: (args) => executeTool('request_callback', args as Record<string, unknown>, ctx),
    }),
  };

  return Object.fromEntries(
    enabledTools
      .filter((n): n is ToolName => n in all)
      .map((n) => [n, all[n]]),
  );
}

/* ─── Shared execution logic ─── */

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  switch (name) {
    case 'lookup_contact': {
      const { data } = await supabase
        .from('contacts')
        .select('*')
        .eq('phone_number', args.phone_number as string)
        .single();
      return data ? { found: true, contact: data } : { found: false };
    }

    case 'update_contact': {
      const updates: Record<string, unknown> = {};
      if (args.notes !== undefined) updates.notes = args.notes;
      if (args.name !== undefined) updates.name = args.name;
      if (args.company !== undefined) updates.company = args.company;

      const { data, error } = await supabase
        .from('contacts')
        .update(updates)
        .eq('phone_number', args.phone_number as string)
        .select()
        .single();

      return error ? { success: false, error: error.message } : { success: true, contact: data };
    }

    case 'get_call_history': {
      const { data } = await supabase
        .from('calls')
        .select('direction,status,started_at,ended_at,duration_seconds,summary')
        .eq('phone_number', args.phone_number as string)
        .order('started_at', { ascending: false })
        .limit((args.limit as number) ?? 5);
      return { calls: data ?? [] };
    }

    case 'send_sms': {
      if (!ctx.twilioNumber) return { success: false, error: 'No Twilio number in context' };
      try {
        const twilio = (await import('twilio')).default;
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        const msg = await client.messages.create({
          to: ctx.phoneNumber,
          from: ctx.twilioNumber,
          body: args.message as string,
        });
        return { success: true, messageSid: msg.sid };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    }

    case 'request_callback': {
      const { data: contact } = await supabase
        .from('contacts')
        .select('id, notes')
        .eq('phone_number', ctx.phoneNumber)
        .single();
      if (contact) {
        const note = `[Callback] ${args.preferred_time || 'ASAP'}${args.notes ? ` — ${args.notes}` : ''}`;
        const merged = [contact.notes, note].filter(Boolean).join('\n');
        await supabase.from('contacts').update({ notes: merged }).eq('id', contact.id);
      }
      return { success: true, logged: true };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}
