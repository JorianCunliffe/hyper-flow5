export interface CommunicationCorrelation {
  tenant_id?: string;
  project_id: string;
  run_id: string;
  task_id: string;
}

export interface SendSmsRequest {
  channel: 'sms';
  to: string;
  content: string;
  correlation: CommunicationCorrelation;
}

export interface StartCallRequest {
  channel: 'voice';
  to: string;
  instruction: string;
  correlation: CommunicationCorrelation;
}

export interface DeliverAskRequest {
  ask_id: string;
  ask_token: string;
  channel: 'email' | 'sms' | 'voice';
  person_id: string;
  question: string;
  response_type: string;
  response_schema?: Record<string, unknown>;
  reply_to?: string;
  form_url?: string;
  correlation: Omit<CommunicationCorrelation, 'run_id'> & { run_id?: string };
}

export type CommunicationStatus =
  | 'accepted'
  | 'queued'
  | 'ready'
  | 'running'
  | 'in_progress'
  | 'waiting'
  | 'completed'
  | 'failed';

export interface CommunicationResult {
  id: string;
  status: CommunicationStatus;
  channel?: 'sms' | 'voice';
  output?: Record<string, unknown>;
  error?: string;
}

export interface CommunicationsClient {
  sendSms(request: SendSmsRequest): Promise<CommunicationResult>;
  startCall(request: StartCallRequest): Promise<CommunicationResult>;
  deliverAsk(request: DeliverAskRequest): Promise<CommunicationResult>;
  getCommunication(id: string): Promise<CommunicationResult>;
}
