export type AppView = 'projects' | 'kanban' | 'scratch' | 'feed' | 'approvals' | 'reports' | 'activity';

const APP_VIEWS = new Set<AppView>(['projects', 'kanban', 'scratch', 'feed', 'approvals', 'reports', 'activity']);

export const parseAppView = (value: string | null | undefined): AppView =>
  value && APP_VIEWS.has(value as AppView) ? value as AppView : 'projects';
