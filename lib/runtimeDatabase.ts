import { getApps } from 'firebase-admin/app';
import { getDatabase, type Database } from 'firebase-admin/database';
import { readSchedulerHealth } from './serverStore.js';

/**
 * Reuses serverStore's validated/initialized Firebase Admin app without parsing
 * credentials independently in each runtime subsystem.
 */
export const runtimeDatabase = async (): Promise<Database> => {
  await readSchedulerHealth();
  const app = getApps().find(candidate => candidate.name === 'hyperflow-server');
  if (!app) throw new Error('HyperFlow runtime database is unavailable');
  return getDatabase(app);
};
