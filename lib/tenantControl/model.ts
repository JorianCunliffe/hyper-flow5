export class TenantControlError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const API_GROUPS = [
  "configuration", "capabilities", "workspace-resources", "discovery", "test-runs", "send-email",
  "captured-work-items",
  "workspace",
  "files",
  "flows",
  "cockpit",
  "commitments",
  "meetings",
  "artifacts",
  "calendar",
  "publishing",
  "communications",
  "integrations",
  "operations",
  "triage",
  "tasks",
  "flow",
  "tenant",
  "service-projects",
  "thread-register",
  "coaching",
  "schedules",
] as const;
export type ApiClient = {
  id: string;
  name: string;
  uid: string;
  secretHash: string;
  scopes: string[];
  createdAt: number;
  expiresAt: number;
  revision: number;
  revokedAt?: number;
  lastUsedAt?: number;
  requestHash: string;
  lastRotationHash?: string;
};
export type TenantControl = {
  revision: number;
  clients: Record<string, ApiClient>;
  dailyLimit: number;
  days: Record<string, { requests: number; clients: Record<string, number> }>;
  audit: Array<{
    id: string;
    at: number;
    actor: string;
    operation: string;
    resource: string;
  }>;
};
export const normalizeControl = (r: TenantControl | null): TenantControl => ({
  revision: r?.revision || 0,
  clients: r?.clients || {},
  dailyLimit: r?.dailyLimit || 0,
  days: r?.days || {},
  audit: r?.audit || [],
});
export interface ControlStore {
  read(org: string): Promise<TenantControl | null>;
  transact(
    org: string,
    fn: (current: TenantControl | null) => TenantControl,
  ): Promise<TenantControl>;
}
