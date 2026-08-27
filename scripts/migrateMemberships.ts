import { migrateLegacyMemberships } from '../lib/serverStore.js';

const apply = process.argv.includes('--apply');
const candidates = await migrateLegacyMemberships(apply);
const pending = candidates.filter(item => !item.alreadyMigrated);

console.log(`${candidates.length} legacy user records reference an existing organization.`);
for (const item of candidates) {
  console.log(`${item.alreadyMigrated ? 'EXISTS' : apply ? 'MIGRATED' : 'PENDING'} ${item.uid} -> ${item.orgId} (${item.role})`);
}
if (!apply && pending.length) {
  console.log(`Dry run only. Review these ${pending.length} memberships, then rerun with --apply before deploying the new database rules.`);
}
