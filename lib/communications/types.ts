export interface CommunicationCorrelation {
  tenant_id: string;
  external_project_id?: string;
  /** @deprecated transition alias accepted by Communications Service */
  project_id?: string;
  run_id: string;
  task_id: string;
  person_id?: string;
}

export interface CommunicationPurpose {
  type: 'human_ask';
  ask_id: string;
  token?: string;
}

export interface SendSmsRequest {
  to: string;
  from: string;
  body: string;
  correlation: CommunicationCorrelation;
  purpose?: CommunicationPurpose;
  callback_url?: string;
}

/** The only Communications voice overrides HyperFlow is allowed to send. */
export interface HyperFlowCallOverrides {
  systemMessage: string;
  greetingText: string;
  aiSpeaksFirst: true;
  liveTranscript: true;
}

export interface StartCallRequest {
  to: string;
  from: string;
  overrides: HyperFlowCallOverrides;
  correlation: CommunicationCorrelation;
  purpose?: CommunicationPurpose;
  callback_url?: string;
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

export interface ResolveAskResult {
  ask_id: string;
  status: 'resolved' | 'already_resolved';
  communication_id: string;
}

export interface CommunicationsClient {
  sendSms(request: SendSmsRequest): Promise<CommunicationResult>;
  startCall(request: StartCallRequest): Promise<CommunicationResult>;
  getCommunication(id: string): Promise<CommunicationResult>;
  resolveAsk(askId: string, communicationId: string): Promise<ResolveAskResult>;
}
