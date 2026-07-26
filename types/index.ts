export interface Contact {
  id: string;
  phone_number: string;
  name?: string;
  email?: string;
  company?: string;
  notes?: string;
  tags?: string[];
  custom_data?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TranscriptEntry {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface Call {
  id: string;
  twilio_call_sid?: string;
  contact_id?: string;
  phone_number: string;
  direction: 'inbound' | 'outbound';
  status?: string;
  system_prompt?: string;
  transcript?: TranscriptEntry[];
  summary?: string;
  duration_seconds?: number;
  started_at: string;
  ended_at?: string;
  metadata?: Record<string, unknown>;
  contact?: Contact;
}

export interface OutboundCallRequest {
  to: string;
  systemPrompt?: string;
  metadata?: Record<string, unknown>;
}

export interface PhoneConfig {
  id: string;
  twilio_number: string;
  name: string;
  description?: string;
  // Voice
  call_enabled: boolean;
  call_system_prompt?: string;
  call_voice: string;
  call_greeting?: string;
  // SMS
  sms_enabled: boolean;
  sms_system_prompt?: string;
  // Shared
  enabled_tools: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SmsThread {
  id: string;
  contact_id?: string;
  phone_number: string;
  twilio_number: string;
  phone_config_id?: string;
  last_message_at: string;
  created_at: string;
  contact?: Contact;
}

export interface SmsMessage {
  id: string;
  thread_id: string;
  twilio_message_sid?: string;
  direction: 'inbound' | 'outbound';
  role: 'user' | 'assistant';
  content: string;
  status?: string;
  created_at: string;
}
