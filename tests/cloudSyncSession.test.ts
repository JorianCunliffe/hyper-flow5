import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudSyncSession } from '../lib/cloudSyncSession';
import { cloudConflictPreview, inspectCloudMerge, mergeCloudEdits } from '../lib/cloudMerge';

const snapshot = (nodes: any[] = []) => ({ projects: [{ id: 'p', revision: 1, milestones: nodes }] });

test('editing a new node while its first save completes rebases on the submitted node', () => {
  const s = new CloudSyncSession(snapshot());
  s.receive(snapshot(), 1);
  s.draft = snapshot([{ id: 'n', name: 'New Milestone', dependsOn: [] }]);
  const write = s.begin()!;
  s.draft = snapshot([{ id: 'n', name: 'Availability', dependsOn: ['upstream'] }]);
  const committed = structuredClone(write.submitted);
  committed.projects[0].revision = 2;
  s.receive(committed, 2); // Firebase callback arrives before the save promise.
  assert.equal(s.begin(), null); // Do not overlap transactions.
  s.acknowledge(committed, 2);
  assert.equal(s.conflicts.length, 0);
  assert.equal(s.draft.projects[0].milestones[0].name, 'Availability');
  assert.deepEqual(s.draft.projects[0].milestones[0].dependsOn, ['upstream']);
  assert.ok(s.dirty);
  const next = s.begin()!;
  s.acknowledge(next.submitted, 3);
  assert.equal(s.dirty, false);
});

test('a queued later callback merges server results without losing in-flight edits', () => {
  const s = new CloudSyncSession(snapshot([{ id: 'n', name: 'Old', action: { template: 'old' } }]));
  s.receive(s.draft, 1);
  s.draft = snapshot([{ id: 'n', name: 'Renamed', action: { template: 'old' } }]);
  const write = s.begin()!;
  s.draft = snapshot([{ id: 'n', name: 'Renamed', action: { template: 'new' } }]);
  s.receive(snapshot([{ id: 'n', name: 'Renamed', action: { template: 'old', lastRun: 'success' } }]), 3);
  s.acknowledge(write.submitted, 2);
  assert.deepEqual(s.draft.projects[0].milestones[0].action, { template: 'new', lastRun: 'success' });
  assert.equal(s.revision, 3);
});

test('delete versus metadata-only change is not a conflict; delete versus actual edit remains one', () => {
  const base = snapshot([{ id: 'n', name: 'Blank', updatedAt: 1 }]);
  const local = snapshot();
  const remote = snapshot([{ id: 'n', name: 'Blank', updatedAt: 2 }]);
  remote.projects[0].revision = 9;
  assert.equal(mergeCloudEdits(base, local, remote).projects[0].milestones.length, 0);
  remote.projects[0].milestones[0].name = 'Cloud work';
  assert.throws(() => mergeCloudEdits(base, local, remote), /conflict/);
});

test('per-field recovery preserves unrelated cloud changes and requires all choices', () => {
  const base = { name: 'Old', notes: 'Old', serverResult: 0 };
  const s = new CloudSyncSession(base);
  s.receive(base, 1);
  s.draft = { name: 'Local', notes: 'Local notes', serverResult: 0 };
  s.receive({ name: 'Remote', notes: 'Remote notes', serverResult: 5 }, 2);
  assert.equal(s.conflicts.length, 2);
  assert.equal(s.begin(), null);
  assert.throws(() => s.resolve({ 'workspace.name': 'local' }), /every conflict/);
  s.resolve({ 'workspace.name': 'local', 'workspace.notes': 'remote' });
  assert.deepEqual(s.draft, { name: 'Local', notes: 'Remote notes', serverResult: 5 });
  assert.equal(s.begin()?.revision, 2);
});

test('failed save processes deferred cloud changes and keeps the local draft recoverable', () => {
  const s = new CloudSyncSession({ name: 'Old', result: 0 });
  s.receive(s.draft, 1);
  s.draft = { name: 'Local', result: 0 };
  s.begin();
  s.receive({ name: 'Remote', result: 1 }, 2);
  s.failed();
  assert.equal(s.conflicts.length, 1);
  assert.equal(s.draft.name, 'Local');
  assert.equal(s.saving, false);
});

test('saved pending edits can be merged into a refreshed session', () => {
  const restored = new CloudSyncSession({ name: 'Old', result: 0 });
  restored.base = { name: 'Old', result: 0 };
  restored.draft = { name: 'Local', result: 0 };
  restored.receive({ name: 'Old', result: 2 }, 8);
  assert.deepEqual(restored.draft, { name: 'Local', result: 2 });
  assert.equal(restored.begin()?.revision, 8);
});

test('conflict previews mask URL credentials and nested JSON templates', () => {
  const preview = cloudConflictPreview({ template: JSON.stringify({ url: 'https://example.com/?zapikey=SECRET&x=1', headers: { Authorization: 'Bearer PRIVATE' } }) });
  assert.ok(!preview.includes('SECRET'));
  assert.ok(!preview.includes('PRIVATE'));
  assert.ok(preview.includes('[redacted]'));
  assert.equal(cloudConflictPreview(undefined), '(deleted / absent)');
});

test('JSON object order and Firebase empty-value pruning do not create false conflicts', () => {
  assert.equal(inspectCloudMerge({ id: 'n', name: 'old', dependsOn: [] }, { id: 'n', name: 'new', dependsOn: [] }, { name: 'old', id: 'n' }).conflicts.length, 0);
});

test('deleting a just-created node during its save does not resurrect it', () => {
  const s = new CloudSyncSession(snapshot());
  s.receive(snapshot(), 1);
  s.draft = snapshot([{ id: 'n', name: 'Temporary node' }]);
  const write = s.begin()!;
  s.draft = snapshot();
  s.acknowledge(write.submitted, 2);
  assert.equal(s.conflicts.length, 0);
  assert.deepEqual(s.draft.projects[0].milestones, []);
  assert.ok(s.dirty);
});

test('a stale remote callback cannot replace a newer committed version', () => {
  const s = new CloudSyncSession({ name: 'initial' });
  s.receive({ name: 'latest' }, 5);
  s.receive({ name: 'old' }, 4);
  assert.equal(s.draft.name, 'latest');
  assert.equal(s.revision, 5);
});

test('editing again while reviewing a conflict requires refreshed choices', () => {
  const s = new CloudSyncSession({ name: 'initial' });
  s.receive(s.draft, 1);
  s.draft = { name: 'local' };
  s.receive({ name: 'cloud' }, 2);
  s.draft = { name: 'new local edit' };
  assert.throws(() => s.resolve({ 'workspace.name': 'local' }), /Review the updated/);
  assert.equal(s.conflicts[0].local, 'new local edit');
  s.resolve({ 'workspace.name': 'local' });
  assert.equal(s.draft.name, 'new local edit');
});
