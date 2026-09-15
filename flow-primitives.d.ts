import './types.js';

declare module './types.js' {
  interface WaitConfig {
    /** Scheduled occurrence that owns this hold. Prevents an old timer completing a later run. */
    occurrenceId?: string;
  }
}
