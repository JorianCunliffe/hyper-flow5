import type { TenantAgentProfile } from '../types.js';
import { createCommunicationsClient } from './communications/client.js';

const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const personGrantedToProject = (
  profile: TenantAgentProfile | null | undefined,
  personId: string,
  projectId: string
): boolean => {
  const grants = profile?.personProjectAccess || [];
  return grants.some(grant => grant.personId === personId && grant.projectIds.includes(projectId));
};

/**
 * Autonomous flows may select a stable granted person id. They may never turn a
 * phone number or email address copied from event/message content into authority.
 */
export const resolveGrantedPersonTarget = async (input: {
  orgId: string;
  projectId: string;
  personId: string;
  channel: 'email' | 'sms' | 'voice';
  profile: TenantAgentProfile | null | undefined;
}): Promise<string> => {
  const personId = String(input.personId || '').trim();
  if (!personId || personId.includes('{{')) throw new Error('Autonomous communication requires a literal granted person_id');
  if (!personGrantedToProject(input.profile, personId, input.projectId)) {
    throw new Error('Autonomous communication target is not granted to this project');
  }
  const people = await createCommunicationsClient().listPeople(input.orgId);
  const matches = people.filter(person => person.id === personId);
  if (matches.length !== 1) throw new Error('Granted Communications person could not be resolved uniquely');
  const target = input.channel === 'email' ? matches[0].email : matches[0].phone;
  if (!target) throw new Error(`Granted person has no ${input.channel === 'email' ? 'email address' : 'phone number'}`);
  if (input.channel === 'email' && !EMAIL.test(target)) throw new Error('Granted person email is invalid');
  if (input.channel !== 'email' && !E164.test(target)) throw new Error('Granted person phone number must use E.164 format');
  return target;
};
