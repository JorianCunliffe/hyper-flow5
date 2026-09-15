import { getApps } from 'firebase-admin/app';
import { getDatabase, type Database } from 'firebase-admin/database';
import type { WorkspaceNamedResource, WorkspaceResourcePermission } from '../types.js';
import { readSchedulerHealth } from './serverStore.js';

const safeKey = (value: string): string => encodeURIComponent(value).replace(/\./g, '%2E');
const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const ID = /^[A-Za-z0-9_-]{10,200}$/;
const PERMISSIONS = new Set<WorkspaceResourcePermission>(['read', 'append', 'upsert']);

const runtimeDb = async (): Promise<Database> => {
  await readSchedulerHealth();
  const app = getApps().find(candidate => candidate.name === 'hyperflow-server');
  if (!app) throw new Error('HyperFlow runtime database is unavailable');
  return getDatabase(app);
};

const cleanRange = (value: unknown): string | undefined => {
  const range = typeof value === 'string' ? value.trim() : '';
  if (!range) return undefined;
  if (range.length > 200 || /[\u0000-\u001f]/.test(range)) throw new Error('Invalid Google Sheet range');
  return range;
};

const defaultPermissions = (type: WorkspaceNamedResource['type']): WorkspaceResourcePermission[] =>
  type === 'google_doc' ? ['read'] : ['read'];

export const normalizeWorkspaceNamedResources = (input: unknown): WorkspaceNamedResource[] => {
  if (!Array.isArray(input)) return [];
  if (input.length > 25) throw new Error('A project may grant at most 25 named Workspace resources');
  const names = new Set<string>();
  return input.map((raw: any) => {
    if (!raw || typeof raw !== 'object') throw new Error('Workspace resource must be an object');
    const name = String(raw.name || '').trim();
    if (!NAME.test(name)) throw new Error(`Invalid Workspace resource name: ${name || '(blank)'}`);
    const key = name.toLowerCase();
    if (names.has(key)) throw new Error(`Duplicate Workspace resource name: ${name}`);
    names.add(key);
    const type = raw.type === 'google_doc' || raw.type === 'google_sheet_range' ? raw.type : undefined;
    if (!type) throw new Error(`Invalid Workspace resource type for ${name}`);
    const permissions = Array.isArray(raw.permissions) && raw.permissions.length
      ? [...new Set(raw.permissions.filter((permission: unknown) => PERMISSIONS.has(permission as WorkspaceResourcePermission)))] as WorkspaceResourcePermission[]
      : defaultPermissions(type);
    if (!permissions.length) throw new Error(`Workspace resource ${name} requires at least one permission`);

    if (type === 'google_doc') {
      const documentId = String(raw.documentId || '').trim();
      if (!ID.test(documentId)) throw new Error(`Workspace resource ${name} requires a valid documentId`);
      if (permissions.some(permission => permission !== 'read')) throw new Error(`Google Doc resource ${name} supports read permission only`);
      return { name, type, documentId, permissions };
    }

    const spreadsheetId = String(raw.spreadsheetId || '').trim();
    const range = cleanRange(raw.range);
    if (!ID.test(spreadsheetId) || !range) throw new Error(`Workspace resource ${name} requires a valid spreadsheetId and range`);
    return { name, type, spreadsheetId, range, permissions };
  });
};

export const readProjectWorkspaceResources = async (
  orgId: string,
  projectId: string
): Promise<WorkspaceNamedResource[]> => {
  const db = await runtimeDb();
  const snapshot = await db.ref(`workspace_resource_catalog/${safeKey(orgId)}/${safeKey(projectId)}`).get();
  return snapshot.exists() ? normalizeWorkspaceNamedResources(snapshot.val()) : [];
};

export const saveProjectWorkspaceResources = async (
  orgId: string,
  projectId: string,
  input: unknown
): Promise<WorkspaceNamedResource[]> => {
  const resources = normalizeWorkspaceNamedResources(input);
  const db = await runtimeDb();
  await db.ref(`workspace_resource_catalog/${safeKey(orgId)}/${safeKey(projectId)}`).set(resources);
  return resources;
};
