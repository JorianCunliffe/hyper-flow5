export type AppView = 'projects' | 'kanban' | 'scratch' | 'feed' | 'approvals' | 'reports' | 'activity' | 'obligations' | 'meetings' | 'flows' | 'cockpit' | 'diary' | 'artifacts' | 'publishing' | 'tenant';

const APP_VIEWS = new Set<AppView>(['projects', 'kanban', 'scratch', 'feed', 'approvals', 'reports', 'activity', 'obligations', 'meetings', 'flows', 'cockpit', 'diary', 'artifacts', 'publishing', 'tenant']);

export const parseAppView = (value: string | null | undefined): AppView =>
  value && APP_VIEWS.has(value as AppView) ? value as AppView : 'projects';

/** Views whose displayed records follow the shared project selection. */
export const hasProjectContext = (view: AppView): boolean =>
  ['projects', 'kanban', 'cockpit', 'obligations', 'approvals', 'feed', 'reports'].includes(view);
