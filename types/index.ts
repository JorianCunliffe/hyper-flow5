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
