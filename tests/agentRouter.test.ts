import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { agentReplyAllowance, agentReplyMode, decideProjectRoute, triageVisibleToProject } from '../lib/agentRouter.js';
import type { ConversationContext, Project, TenantAgentProfile } from '../types.js';

const project = (id: string, name: string): Project => ({
  id, name, company: 'Tenant', type: 'Other', startDate: 0,
  milestones: [], createdAt: 0, updatedAt: 0
});

const profile = (overrides: Partial<TenantAgentProfile> = {}): TenantAgentProfile => ({
  agentId: 'agent_1', displayName: 'Coach', timezone: 'Australia/Brisbane',
  allowedProjectIds: ['coaching', 'email'], clarificationPolicy: 'when_ambiguous',
  ...overrides
});

const context = (projectId: string, expiresAt = 2_000): ConversationContext => ({
  id: 'thread_1', orgId: 'org_1', threadId: 'thread_1', channel: 'sms',
  activeProjectId: projectId, selectionConfidence: 0.85,
  updatedAt: 1, expiresAt
});

describe('omnichannel project routing', () => {
  const projects = [project('coaching', 'Daily Coaching'), project('email', 'Email Triage')];

  test('trusted correlation wins without inspecting message text', () => {
    const decision = decideProjectRoute({
      content: 'Tell me about something else', trustedProjectId: 'coaching', projects, profile: profile(), now: 1_000
    });
    assert.equal(decision.projectId, 'coaching');
    assert.equal(decision.reason, 'trusted_correlation');
  });

  test('an explicit project name overrides a prior conversation context', () => {
    const decision = decideProjectRoute({
      content: 'Switch to Email Triage please', projects, profile: profile(), context: context('coaching'), now: 1_000
    });
    assert.equal(decision.projectId, 'email');
    assert.equal(decision.reason, 'explicit_reference');
  });

  test('continues a live semantic thread but ignores an expired one', () => {
    const active = decideProjectRoute({ content: 'What did we agree?', projects, profile: profile(), context: context('coaching'), now: 1_000 });
    assert.equal(active.projectId, 'coaching');
    assert.equal(active.reason, 'active_context');
    const expired = decideProjectRoute({ content: 'What did we agree?', projects, profile: profile(), context: context('coaching', 999), now: 1_000 });
    assert.equal(expired.kind, 'clarification');
  });

  test('uses a configured default, then a sole visible project, otherwise clarifies', () => {
    assert.equal(decideProjectRoute({ content: 'status?', projects, profile: profile({ defaultProjectId: 'email' }) }).projectId, 'email');
    assert.equal(decideProjectRoute({ content: 'status?', projects, profile: profile({ allowedProjectIds: ['coaching'] }) }).projectId, 'coaching');
    assert.equal(decideProjectRoute({ content: 'status?', projects, profile: profile() }).kind, 'clarification');
  });

  test('never routes to a project outside the agent allowlist', () => {
    const decision = decideProjectRoute({
      content: 'Tell me about Email Triage', trustedProjectId: 'email', projects,
      profile: profile({ allowedProjectIds: ['coaching'] })
    });
    assert.equal(decision.projectId, 'coaching');
    assert.equal(decision.reason, 'single_project');
  });

  test('applies stable Communications person grants before tenant-wide defaults', () => {
    const configured = profile({
      defaultProjectId: 'email',
      personProjectAccess: [
        { personId: 'person_coach', projectIds: ['coaching'] },
        { personId: 'person_email', projectIds: ['email'] }
      ]
    });
    assert.equal(decideProjectRoute({ content: 'status?', projects, profile: configured, personId: 'person_coach' }).projectId, 'coaching');
    assert.equal(decideProjectRoute({ content: 'Daily Coaching', projects, profile: configured, personId: 'person_email' }).projectId, 'email');
    assert.equal(decideProjectRoute({ content: 'status?', projects, profile: configured, personId: 'unknown' }).kind, 'unavailable');
  });

  test('fails closed for an inbound person until primary identity or grants are configured', () => {
    assert.equal(decideProjectRoute({ content: 'Daily Coaching', projects, profile: profile(), personId: 'person_unconfigured' }).kind, 'unavailable');
    assert.equal(decideProjectRoute({
      content: 'Daily Coaching', projects, profile: profile({ primaryPersonId: 'person_primary' }), personId: 'person_primary'
    }).projectId, 'coaching');
  });

  test('honors always-confirm without trapping the clarification reply in a loop', () => {
    const configured = profile({ clarificationPolicy: 'always' });
    const first = decideProjectRoute({ content: 'Daily Coaching', projects, profile: configured, now: 1_000 });
    assert.equal(first.kind, 'clarification');
    const confirmed = decideProjectRoute({
      content: 'Daily Coaching', projects, profile: configured,
      context: { ...context('coaching'), clarificationState: 'awaiting_project' }, now: 1_000
    });
    assert.equal(confirmed.projectId, 'coaching');
  });

  test('connected mailboxes remain draft-only even when send is enabled', () => {
    const configured = profile({ automaticActions: ['draft', 'send'] });
    assert.equal(agentReplyMode('email', { mailboxConnectionId: 'gmail_1' }, configured), 'draft');
    assert.equal(agentReplyMode('email', { mailboxConnectionId: 'gmail_1' }, profile({ automaticActions: ['send'] })), 'none');
    assert.equal(agentReplyMode('email', { connectionId: 'resend_1' }, configured), 'send');
    assert.equal(agentReplyMode('sms', { mailboxConnectionId: 'gmail_1' }, configured), 'send');
  });

  test('limits automatic replies per semantic thread and resets the hourly window', () => {
    const base = context('coaching', 10_000_000);
    assert.equal(agentReplyAllowance({ ...base, replyWindowStartedAt: 1_000, automaticReplyCount: 6 }, 2_000).allowed, false);
    assert.match(agentReplyAllowance({ ...base, replyWindowStartedAt: 1_000, automaticReplyCount: 6 }, 2_000).reason!, /limit/);
    assert.equal(agentReplyAllowance({ ...base, replyWindowStartedAt: 1_000, automaticReplyCount: 6 }, 3_601_001).allowed, true);
    assert.equal(agentReplyAllowance({ ...base, lastAutomaticReplyAt: 1_999 }, 2_000).allowed, false);
  });

  test('never exposes unassigned triage to coaching or unrelated projects', () => {
    const coaching = { ...project('coaching', 'Daily Coaching'), projectData: { project_template: 'daily_coaching' } };
    const email = { ...project('email', 'Email Triage'), projectData: { project_template: 'daily_email_triage' } };
    assert.equal(triageVisibleToProject({ projectId: undefined }, coaching), false);
    assert.equal(triageVisibleToProject({ projectId: 'email' }, coaching), false);
    assert.equal(triageVisibleToProject({ projectId: 'coaching' }, coaching), true);
    assert.equal(triageVisibleToProject({ projectId: undefined }, email), true);
    assert.equal(triageVisibleToProject({ projectId: 'coaching' }, email), false);
  });
});
