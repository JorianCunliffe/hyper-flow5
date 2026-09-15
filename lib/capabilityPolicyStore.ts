import { getApps } from 'firebase-admin/app';
import { getDatabase, type Database } from 'firebase-admin/database';
import type { CapabilityPolicyMode } from '../types.js';
import { readSchedulerHealth } from './serverStore.js';

export type TenantCapabilityPolicy = Record<string, CapabilityPolicyMode>;

const safeKey = (value: string): string => encodeURIComponent(value).replace(/\./g, '%2E');
const CAPABILITY = /^[a-z][a-z0-9_.:-]{0,79}$/;
const MODES = new Set<CapabilityPolicyMode>(['automatic', 'approval', 'denied']);

const runtimeDb = async (): Promise<Database> => {
  await readSchedulerHealth();
  const app = getApps().find(candidate => candidate.name === 'hyperflow-server');
  if (!app) throw new Error('HyperFlow runtime database is unavailable');
  return getDatabase(app);
};

export const normalizeCapabilityPolicy = (input: unknown): TenantCapabilityPolicy => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const entries = Object.entries(input as Record<string, unknown>).slice(0, 100);
  const policy: TenantCapabilityPolicy = {};
  for (const [rawCapability, rawMode] of entries) {
    const capability = rawCapability.trim().toLowerCase();
    if (!CAPABILITY.test(capability)) throw new Error(`Invalid capability name: ${rawCapability}`);
    if (!MODES.has(rawMode as CapabilityPolicyMode)) throw new Error(`Invalid policy mode for ${capability}`);
    policy[capability] = rawMode as CapabilityPolicyMode;
  }
  return policy;
};

export const readTenantCapabilityPolicy = async (orgId: string): Promise<TenantCapabilityPolicy> => {
  const db = await runtimeDb();
  const snapshot = await db.ref(`capability_policy/${safeKey(orgId)}`).get();
  return snapshot.exists() ? normalizeCapabilityPolicy(snapshot.val()) : {};
};

export const saveTenantCapabilityPolicy = async (
  orgId: string,
  input: unknown
): Promise<TenantCapabilityPolicy> => {
  const policy = normalizeCapabilityPolicy(input);
  const db = await runtimeDb();
  await db.ref(`capability_policy/${safeKey(orgId)}`).set(policy);
  return policy;
};
