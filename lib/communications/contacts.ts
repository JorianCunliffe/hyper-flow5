import { ApiAuthError } from '../apiAuth.js';
import type { AuthenticatedMember } from '../serverStore.js';
import { HttpCommunicationsClient } from './client.js';

type Directory = Pick<HttpCommunicationsClient, 'listPeople' | 'createPerson'>;

export async function handleContacts(
  req: { method?: string; body?: unknown },
  member: AuthenticatedMember,
  client?: Directory
) {
  if (!['GET', 'POST'].includes(req.method || '')) throw new ApiAuthError(405, 'Method not allowed');
  if (req.method === 'GET') return { status: 200, body: { data: await (client || new HttpCommunicationsClient()).listPeople(member.orgId) } };
  if (!['owner', 'admin'].includes(member.role)) throw new ApiAuthError(403, 'Administrator membership required');
  const input = req.body as Record<string, unknown> | undefined;
  if (!input || Array.isArray(input) || typeof input !== 'object' || Object.keys(input).some(key => !['name', 'phone_number'].includes(key))) {
    throw new ApiAuthError(400, 'Only name and phone_number are accepted');
  }
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 200) throw new ApiAuthError(400, 'name must contain 1–200 characters');
  if (typeof input.phone_number !== 'string' || !/^\+[1-9]\d{7,14}$/.test(input.phone_number)) throw new ApiAuthError(400, 'phone_number must use E.164 format');
  const directory = client || new HttpCommunicationsClient();
  const existing = (await directory.listPeople(member.orgId)).filter(person => person.phone === input.phone_number);
  if (existing.length > 1 || existing.some(person => person.name?.trim().toLowerCase() !== (input.name as string).trim().toLowerCase())) {
    throw new ApiAuthError(409, 'Phone number already belongs to another or ambiguous contact');
  }
  if (existing.length) return { status: 200, body: { person: existing[0], created: false } };
  const person = await directory.createPerson(member.orgId, { name: input.name.trim(), phone_number: input.phone_number });
  return { status: 201, body: { person, created: true } };
}
