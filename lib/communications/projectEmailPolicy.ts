import { CommunicationsApiError } from './errors.js';

export type EmailProjectLookup = (tenantId: string, projectId: string) => Promise<{
  project: { emailSendingEnabled?: boolean; isArchived?: boolean };
} | null>;

const storedProject: EmailProjectLookup = async (tenantId, projectId) => {
  const { findProject } = await import('../serverStore.js');
  return findProject(tenantId, projectId);
};

/** Read the saved project on every dispatch; request bodies cannot grant sending. */
export async function assertProjectEmailSendAllowed(
  tenantId: string | undefined, projectId: string | undefined,
  lookup: EmailProjectLookup = storedProject
): Promise<void> {
  if (!tenantId?.trim() || !projectId?.trim()) {
    throw new CommunicationsApiError('Email sending requires an authenticated organization and project', 403);
  }
  const located = await lookup(tenantId, projectId);
  if (!located || located.project.isArchived || located.project.emailSendingEnabled !== true) {
    throw new CommunicationsApiError(
      'Email sending is disabled for this project. Enable it in Edit Project Settings after testing. Mailbox drafts remain available.',
      403, { code: 'project_email_send_disabled' }
    );
  }
}
