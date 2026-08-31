import { createHash, randomUUID } from 'node:crypto';
import type { ExternalActionReceipt, WorkspaceResourceGrant } from '../../types.js';
import {
  claimExternalActionReceipt,
  finishExternalActionReceipt,
  listWorkspaceConnectionRefs,
  readWorkspaceCredential,
  readWorkspaceResourceGrant,
  saveWorkspaceConnectionRef,
  writeWorkspaceCredential
} from '../serverStore.js';
import { credentialFingerprint, openCredential, sealCredential, type SealedCredential } from './credentialCrypto.js';
import { refreshGoogleToken, type GoogleTokenSet } from './googleOAuth.js';

export interface StoredGoogleCredential {
  tokens: GoogleTokenSet;
  accountEmail: string;
  scopes: string[];
}

export interface GoogleResource {
  id: string;
  name: string;
  kind: 'document' | 'spreadsheet';
  modifiedTime?: string;
  canEdit?: boolean;
}

export const googleWorkspaceConnectionId = (accountEmail: string): string =>
  `google_${credentialFingerprint(accountEmail.trim().toLowerCase())}`;

export const storeGoogleWorkspaceCredential = async (
  orgId: string,
  credential: StoredGoogleCredential
): Promise<string> => {
  const connectionId = googleWorkspaceConnectionId(credential.accountEmail);
  await writeWorkspaceCredential(orgId, connectionId, sealCredential(credential) as unknown as Record<string, unknown>);
  await saveWorkspaceConnectionRef(orgId, {
    id: connectionId,
    provider: 'google',
    accountEmail: credential.accountEmail,
    state: 'connected',
    scopes: credential.scopes,
    updatedAt: Date.now()
  });
  return connectionId;
};

const readStoredCredential = async (orgId: string, connectionId: string): Promise<StoredGoogleCredential> => {
  const connections = await listWorkspaceConnectionRefs(orgId);
  if (!connections.some(connection => connection.id === connectionId && connection.state === 'connected')) {
    throw new Error('Google Workspace connection is not connected for this tenant');
  }
  const sealed = await readWorkspaceCredential(orgId, connectionId);
  if (!sealed) throw new Error('Google Workspace credential is unavailable');
  return openCredential<StoredGoogleCredential>(sealed as unknown as SealedCredential);
};

export const googleAccessToken = async (orgId: string, connectionId: string): Promise<string> => {
  const credential = await readStoredCredential(orgId, connectionId);
  if (credential.tokens.access_token && Number(credential.tokens.expires_at || 0) > Date.now() + 60_000) {
    return credential.tokens.access_token;
  }
  if (!credential.tokens.refresh_token) throw new Error('Google Workspace connection has expired and cannot be refreshed');
  const tokens = await refreshGoogleToken(credential.tokens.refresh_token);
  await writeWorkspaceCredential(orgId, connectionId, sealCredential({ ...credential, tokens }) as unknown as Record<string, unknown>);
  return tokens.access_token;
};

const googleJson = async <T>(url: string, accessToken: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {})
    }
  });
  const body = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error(`Google Workspace request failed (${response.status})`);
  return body as T;
};

export const listGoogleWorkspaceResources = async (
  orgId: string,
  connectionId: string,
  kind?: GoogleResource['kind']
): Promise<GoogleResource[]> => {
  const accessToken = await googleAccessToken(orgId, connectionId);
  const mimeTypes = kind === 'document'
    ? ['application/vnd.google-apps.document']
    : kind === 'spreadsheet'
      ? ['application/vnd.google-apps.spreadsheet']
      : ['application/vnd.google-apps.document', 'application/vnd.google-apps.spreadsheet'];
  const query = new URLSearchParams({
    q: `trashed = false and (${mimeTypes.map(mime => `mimeType = '${mime}'`).join(' or ')})`,
    pageSize: '100',
    orderBy: 'modifiedTime desc',
    fields: 'files(id,name,mimeType,modifiedTime,capabilities(canEdit))'
  });
  const result = await googleJson<{ files?: Array<{ id: string; name: string; mimeType: string; modifiedTime?: string; capabilities?: { canEdit?: boolean } }> }>(
    `https://www.googleapis.com/drive/v3/files?${query}`, accessToken
  );
  return (result.files || []).map(file => ({
    id: file.id,
    name: file.name,
    kind: file.mimeType.endsWith('.document') ? 'document' : 'spreadsheet',
    modifiedTime: file.modifiedTime,
    canEdit: file.capabilities?.canEdit === true
  }));
};

/** Read-only preflight used before a coaching project exists. */
export const validateGoogleWorkspaceSelection = async (input: {
  orgId: string;
  connectionId: string;
  documentId: string;
  spreadsheetId: string;
  sheetRange: string;
}): Promise<{ documentTitle?: string; sheetRange: string; canAppend: boolean }> => {
  if (!input.connectionId || !input.documentId || !input.spreadsheetId || !input.sheetRange) {
    throw new Error('Google connection, Doc, Sheet and allowed range are required');
  }
  const accessToken = await googleAccessToken(input.orgId, input.connectionId);
  const [document, sheet, resources] = await Promise.all([
    googleJson<any>(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(input.documentId)}`, accessToken),
    googleJson<{ range?: string }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}/values/${encodeURIComponent(input.sheetRange)}`,
      accessToken
    ),
    listGoogleWorkspaceResources(input.orgId, input.connectionId, 'spreadsheet')
  ]);
  const selectedSheet = resources.find(resource => resource.id === input.spreadsheetId);
  if (!selectedSheet) throw new Error('Selected Google Sheet is not available to this connection');
  return {
    documentTitle: typeof document.title === 'string' ? document.title : undefined,
    sheetRange: sheet.range || input.sheetRange,
    canAppend: selectedSheet.canEdit === true
  };
};

const documentText = (document: any): string => (document.body?.content || [])
  .flatMap((element: any) => element.paragraph?.elements || [])
  .map((element: any) => element.textRun?.content || '')
  .join('');

const requireGrant = async (orgId: string, projectId: string): Promise<WorkspaceResourceGrant> => {
  const grant = await readWorkspaceResourceGrant(orgId, projectId);
  if (!grant) throw new Error('Google Workspace resources are not configured for this project');
  return grant;
};

export const readGrantedGoogleDoc = async (orgId: string, projectId: string): Promise<{
  documentId: string; title?: string; revisionId?: string; text: string; readAt: string;
}> => {
  const grant = await requireGrant(orgId, projectId);
  if (!grant.documentId) throw new Error('A Google Doc is not configured for this project');
  const accessToken = await googleAccessToken(orgId, grant.connectionId);
  const document = await googleJson<any>(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(grant.documentId)}`, accessToken
  );
  return {
    documentId: grant.documentId,
    title: typeof document.title === 'string' ? document.title : undefined,
    revisionId: typeof document.revisionId === 'string' ? document.revisionId : undefined,
    text: documentText(document).slice(0, 100_000),
    readAt: new Date().toISOString()
  };
};

export const readGrantedGoogleSheet = async (orgId: string, projectId: string): Promise<{
  spreadsheetId: string; range: string; values: unknown[][]; readAt: string;
}> => {
  const grant = await requireGrant(orgId, projectId);
  if (!grant.spreadsheetId || !grant.sheetRange) throw new Error('A Google Sheet and range are not configured for this project');
  const accessToken = await googleAccessToken(orgId, grant.connectionId);
  const result = await googleJson<{ range?: string; values?: unknown[][] }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(grant.spreadsheetId)}/values/${encodeURIComponent(grant.sheetRange)}`,
    accessToken
  );
  const values = (result.values || []).slice(0, 500).map(row => row.slice(0, 50));
  return { spreadsheetId: grant.spreadsheetId, range: result.range || grant.sheetRange, values, readAt: new Date().toISOString() };
};

const requestHash = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Coaching, email, document, and transcript text is untrusted data. RAW keeps
// values beginning with =, +, -, or @ from becoming executable Sheet formulas.
export const GOOGLE_SHEET_VALUE_INPUT_OPTION = 'RAW' as const;

export const appendGrantedGoogleSheet = async (
  orgId: string,
  projectId: string,
  idempotencyKey: string,
  values: unknown[][]
): Promise<Record<string, unknown>> => {
  if (!idempotencyKey.trim()) throw new Error('idempotencyKey is required');
  if (!Array.isArray(values) || values.length === 0 || values.length > 100 || values.some(row => !Array.isArray(row) || row.length > 50)) {
    throw new Error('Google Sheet append values must contain 1-100 rows and at most 50 columns');
  }
  const grant = await requireGrant(orgId, projectId);
  if (!grant.spreadsheetId || !grant.sheetRange) throw new Error('A Google Sheet and range are not configured for this project');
  const hash = requestHash({ projectId, spreadsheetId: grant.spreadsheetId, range: grant.sheetRange, values });
  const receipt: ExternalActionReceipt = {
    id: randomUUID(), orgId, projectId, kind: 'google_sheet_append', idempotencyKey,
    requestHash: hash, status: 'running', startedAt: Date.now()
  };
  const claimed = await claimExternalActionReceipt(receipt);
  if (claimed.duplicate) {
    if (claimed.receipt.status === 'completed') return claimed.receipt.response || {};
    throw new Error('Google Sheet action is already running');
  }
  try {
    const accessToken = await googleAccessToken(orgId, grant.connectionId);
    const query = new URLSearchParams({ valueInputOption: GOOGLE_SHEET_VALUE_INPUT_OPTION, insertDataOption: 'INSERT_ROWS' });
    const result = await googleJson<Record<string, unknown>>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(grant.spreadsheetId)}/values/${encodeURIComponent(grant.sheetRange)}:append?${query}`,
      accessToken,
      { method: 'POST', body: JSON.stringify({ majorDimension: 'ROWS', values }) }
    );
    const response = {
      spreadsheetId: grant.spreadsheetId,
      range: grant.sheetRange,
      updates: result.updates || null
    };
    await finishExternalActionReceipt(claimed.receipt, { status: 'completed', response });
    return response;
  } catch (error: any) {
    await finishExternalActionReceipt(claimed.receipt, { status: 'failed', error: error?.message || String(error) });
    throw error;
  }
};

const parseWritableRange = (range: string): { sheet: string; startColumn: string; endColumn: string; startRow: number } => {
  const match = range.match(/^(.+)!([A-Z]+)(\d*)\s*:\s*([A-Z]+)(\d*)$/i);
  if (!match) throw new Error('Google Sheet upsert requires an A1 range such as Coaching!A2:G');
  return {
    sheet: match[1],
    startColumn: match[2].toUpperCase(),
    endColumn: match[4].toUpperCase(),
    startRow: match[3] ? Number(match[3]) : 1
  };
};

export const upsertGrantedGoogleSheet = async (
  orgId: string,
  projectId: string,
  idempotencyKey: string,
  keyColumn: number,
  keyValue: unknown,
  values: unknown[]
): Promise<Record<string, unknown>> => {
  if (!idempotencyKey.trim()) throw new Error('idempotencyKey is required');
  if (!Number.isInteger(keyColumn) || keyColumn < 0 || keyColumn >= 50) throw new Error('keyColumn must be a zero-based column index from 0 to 49');
  if (keyValue === undefined || keyValue === null || String(keyValue).trim() === '') throw new Error('keyValue is required');
  if (!Array.isArray(values) || values.length === 0 || values.length > 50) throw new Error('Google Sheet upsert values must contain 1-50 columns');
  if (String(values[keyColumn] ?? '') !== String(keyValue)) throw new Error('The upsert row value at keyColumn must equal keyValue');
  const grant = await requireGrant(orgId, projectId);
  if (!grant.spreadsheetId || !grant.sheetRange) throw new Error('A Google Sheet and range are not configured for this project');
  const writableRange = parseWritableRange(grant.sheetRange);
  const hash = requestHash({ projectId, spreadsheetId: grant.spreadsheetId, range: grant.sheetRange, keyColumn, keyValue, values });
  const receipt: ExternalActionReceipt = {
    id: randomUUID(), orgId, projectId, kind: 'google_sheet_upsert', idempotencyKey,
    requestHash: hash, status: 'running', startedAt: Date.now()
  };
  const claimed = await claimExternalActionReceipt(receipt);
  if (claimed.duplicate) {
    if (claimed.receipt.status === 'completed') return claimed.receipt.response || {};
    throw new Error('Google Sheet action is already running');
  }
  try {
    const accessToken = await googleAccessToken(orgId, grant.connectionId);
    const current = await googleJson<{ values?: unknown[][] }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(grant.spreadsheetId)}/values/${encodeURIComponent(grant.sheetRange)}`,
      accessToken
    );
    const matches = (current.values || []).map((row, index) => ({ row, index }))
      .filter(entry => String(entry.row[keyColumn] ?? '') === String(keyValue));
    if (matches.length > 1) throw new Error('Google Sheet upsert key is ambiguous because multiple rows match');
    let result: Record<string, unknown>;
    let operation: 'updated' | 'appended';
    if (matches.length === 1) {
      const rowNumber = writableRange.startRow + matches[0].index;
      const targetRange = `${writableRange.sheet}!${writableRange.startColumn}${rowNumber}:${writableRange.endColumn}${rowNumber}`;
      const query = new URLSearchParams({ valueInputOption: GOOGLE_SHEET_VALUE_INPUT_OPTION });
      result = await googleJson<Record<string, unknown>>(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(grant.spreadsheetId)}/values/${encodeURIComponent(targetRange)}?${query}`,
        accessToken,
        { method: 'PUT', body: JSON.stringify({ majorDimension: 'ROWS', values: [values] }) }
      );
      operation = 'updated';
    } else {
      const query = new URLSearchParams({ valueInputOption: GOOGLE_SHEET_VALUE_INPUT_OPTION, insertDataOption: 'INSERT_ROWS' });
      result = await googleJson<Record<string, unknown>>(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(grant.spreadsheetId)}/values/${encodeURIComponent(grant.sheetRange)}:append?${query}`,
        accessToken,
        { method: 'POST', body: JSON.stringify({ majorDimension: 'ROWS', values: [values] }) }
      );
      operation = 'appended';
    }
    const response = { spreadsheetId: grant.spreadsheetId, range: grant.sheetRange, operation, updates: result.updates || result };
    await finishExternalActionReceipt(claimed.receipt, { status: 'completed', response });
    return response;
  } catch (error: any) {
    await finishExternalActionReceipt(claimed.receipt, { status: 'failed', error: error?.message || String(error) });
    throw error;
  }
};
