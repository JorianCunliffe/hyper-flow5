import './types.js';

declare module './types.js' {
  interface WaitConfig {
    /** Scheduled occurrence that owns this hold. Prevents an old timer completing a later run. */
    occurrenceId?: string;
  }

  interface ReadyCondition {
    /** Generic scalar comparisons for decision nodes without feature-specific branching code. */
    oneOf?: Array<string | number | boolean>;
    notEquals?: string | number | boolean;
  }

  interface ActionConfig {
    /** Default is block. Continue makes an error a completed graph result so a Decision can branch on it. */
    failureMode?: 'block' | 'continue';
    /** Optional project-data prefix receiving terminal status and standard result metadata. */
    resultVariable?: string;
  }

  interface WorkspaceResourceGrant {
    /** Human-named resources selectable by action templates. Legacy document/sheet fields remain the defaults. */
    resources?: Array<{
      name: string;
      type: 'google_doc' | 'google_sheet_range';
      documentId?: string;
      spreadsheetId?: string;
      range?: string;
      permissions?: Array<'read' | 'append' | 'upsert'>;
    }>;
  }

  interface TenantAgentProfile {
    /** Capability-level authority. Legacy automaticActions remains supported during migration. */
    capabilityPolicy?: Record<string, 'automatic' | 'approval' | 'denied'>;
  }
}
