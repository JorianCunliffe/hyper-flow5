
import React from 'react';
import { GitBranch, RefreshCw, Mail, MessageSquare, Phone, Webhook, FileText, Circle, LucideIcon, BookOpen, TableProperties, BrainCircuit } from 'lucide-react';
import { NodeType } from './types';

export interface NodeTypeMeta {
  label: string;
  icon: LucideIcon;
  color: string;      // main accent (bg for icon chip)
  ringClass: string;  // tailwind ring color for the node shell
  description: string;
}

export const NODE_TYPE_META: Record<NodeType, NodeTypeMeta> = {
  [NodeType.MILESTONE]: { label: 'Milestone', icon: Circle, color: '#6366f1', ringClass: 'ring-slate-100', description: 'Standard milestone with subtasks' },
  [NodeType.DECISION]: { label: 'Decision', icon: GitBranch, color: '#f59e0b', ringClass: 'ring-amber-200', description: 'Branches the flow based on project data conditions' },
  [NodeType.LOOP]: { label: 'Loop', icon: RefreshCw, color: '#8b5cf6', ringClass: 'ring-violet-200', description: 'Repeats a section until an exit condition or max iterations' },
  [NodeType.EMAIL]: { label: 'Email', icon: Mail, color: '#3b82f6', ringClass: 'ring-blue-200', description: 'Sends an email via Resend' },
  [NodeType.SMS]: { label: 'SMS', icon: MessageSquare, color: '#10b981', ringClass: 'ring-emerald-200', description: 'Sends an SMS via the Communications API' },
  [NodeType.PHONE_CALL]: { label: 'Phone Call', icon: Phone, color: '#0ea5e9', ringClass: 'ring-sky-200', description: 'Starts a voice call via the Communications API' },
  [NodeType.WEBHOOK]: { label: 'Webhook', icon: Webhook, color: '#64748b', ringClass: 'ring-slate-300', description: 'Calls an external HTTP endpoint' },
  [NodeType.REPORT]: { label: 'Report', icon: FileText, color: '#ec4899', ringClass: 'ring-pink-200', description: 'Generates a report with AI (draft, evaluate, revise)' },
  [NodeType.GOOGLE_DOC]: { label: 'Read Doc', icon: BookOpen, color: '#4285f4', ringClass: 'ring-blue-200', description: 'Reads the Google Doc allowlisted for this project' },
  [NodeType.GOOGLE_SHEET_READ]: { label: 'Read Sheet', icon: TableProperties, color: '#0f9d58', ringClass: 'ring-emerald-200', description: 'Reads the Google Sheet range allowlisted for this project' },
  [NodeType.GOOGLE_SHEET_APPEND]: { label: 'Append Sheet', icon: TableProperties, color: '#188038', ringClass: 'ring-emerald-300', description: 'Appends rows idempotently to the allowlisted Google Sheet range' },
  [NodeType.COACHING_EXTRACT]: { label: 'Coach Result', icon: BrainCircuit, color: '#7c3aed', ringClass: 'ring-violet-300', description: 'Extracts a typed coaching result from a verified human call' }
};

// Default mappings for the initial statuses
export const DEFAULT_STATUS_COLORS: Record<string, string> = {
  'Completed': '#dcfce7',
  'Started': '#dbeafe',
  'Ready': '#e0e7ff',
  'Needs preparation': '#fed7aa',
  'Submitted': '#fce7f3',
  'Held': '#fef9c3',
  'Not Complete': '#f1f5f9',
  'Not started': '#f1f5f9',
  'Abandoned': '#fee2e2'
};

export const getStatusColor = (status: string) => DEFAULT_STATUS_COLORS[status] || '#f1f5f9';

export const getStatusBorderColor = (status: string) => {
  const borders: Record<string, string> = {
    'Completed': '#22c55e',
    'Started': '#3b82f6',
    'Ready': '#6366f1',
    'Needs preparation': '#f97316',
    'Submitted': '#db2777',
    'Held': '#eab308',
    'Not Complete': '#94a3b8',
    'Not started': '#94a3b8',
    'Abandoned': '#ef4444'
  };
  return borders[status] || '#94a3b8';
};
