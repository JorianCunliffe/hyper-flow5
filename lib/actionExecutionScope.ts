import { AsyncLocalStorage } from 'node:async_hooks';

export interface ActionExecutionScope {
  resourceName?: string;
}

const storage = new AsyncLocalStorage<ActionExecutionScope>();

export const withActionExecutionScope = async <T>(
  scope: ActionExecutionScope,
  work: () => Promise<T>
): Promise<T> => storage.run(scope, work);

export const currentActionResourceName = (): string | undefined => storage.getStore()?.resourceName;
