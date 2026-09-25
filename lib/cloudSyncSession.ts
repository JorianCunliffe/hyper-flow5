import { inspectCloudMerge, mergeCloudEdits, sameCloudValue, type CloudConflictChoice, type CloudConflictDetail } from './cloudMerge.js';

/** One writer at a time; a committed write is the ancestor of edits made during that write. */
export class CloudSyncSession<T> {
  base: T | null = null;
  draft: T;
  revision = 0;
  conflicts: CloudConflictDetail[] = [];
  private conflictRemote: T | null = null;
  private pending: { submitted: T; base: T | null; revision: number } | null = null;
  private deferred: { data: T; revision: number } | null = null;
  constructor(initial: T) { this.draft = initial; }
  get saving() { return this.pending !== null; }
  get dirty() { return this.base !== null && !sameCloudValue(this.draft, this.base); }

  receive(data: T, revision: number) {
    if (revision < this.revision) return;
    if (this.pending) {
      if (!this.deferred || revision >= this.deferred.revision) this.deferred = { data, revision };
      return;
    }
    this.revision = revision;
    const inspected = this.base === null ? { merged: data, conflicts: [] } : inspectCloudMerge(this.base, this.draft, data);
    this.conflicts = inspected.conflicts;
    this.conflictRemote = this.conflicts.length ? data : null;
    if (!this.conflicts.length) { this.base = data; this.draft = inspected.merged; }
  }

  begin() {
    if (this.pending || this.conflicts.length || !this.dirty) return null;
    this.pending = { submitted: this.draft, base: this.base, revision: this.revision };
    return this.pending;
  }

  acknowledge(committed: T, revision: number) {
    if (!this.pending) throw new Error('No cloud save is in progress');
    const submitted = this.pending.submitted;
    this.pending = null;
    // Do not merge the acknowledgement against the pre-save baseline: a new
    // node edited during the request would appear to be two competing inserts.
    this.base = submitted;
    this.receive(committed, revision);
    this.flushDeferred();
  }

  failed() { this.pending = null; this.flushDeferred(); }
  private flushDeferred() {
    const deferred = this.deferred;
    this.deferred = null;
    if (deferred && deferred.revision > this.revision) this.receive(deferred.data, deferred.revision);
  }

  resolve(choices: Record<string, CloudConflictChoice>) {
    if (!this.base || !this.conflictRemote || !this.conflicts.length) throw new Error('No conflict to resolve');
    const remote = this.conflictRemote;
    const refreshed = inspectCloudMerge(this.base, this.draft, remote);
    if (!sameCloudValue(refreshed.conflicts, this.conflicts)) {
      this.conflicts = refreshed.conflicts;
      if (!this.conflicts.length) { this.base = remote; this.draft = refreshed.merged; this.conflictRemote = null; return; }
      throw new Error('The conflicting edits changed. Review the updated versions before applying choices.');
    }
    const result = mergeCloudEdits(this.base, this.draft, remote, 'workspace', detail => {
      if (!choices[detail.path]) throw new Error('Choose a version for every conflict');
      return choices[detail.path];
    });
    this.base = remote;
    this.draft = result;
    this.conflicts = [];
    this.conflictRemote = null;
  }
}
