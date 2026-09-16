import { AsyncLocalStorage } from 'node:async_hooks';

export interface ActionExecutionScope {
  resourceName?: string;
  freezeCommunicationRequest?: (path: string, idempotencyKey: string, body: unknown) => Promise<any>;
}

const storage = new AsyncLocalStorage<ActionExecutionScope>();

export const withActionExecutionScope = async <T>(
  scope: ActionExecutionScope,
  work: () => Promise<T>
): Promise<T> => storage.run({ ...storage.getStore(), ...scope }, work);

export const currentActionResourceName = (): string | undefined => storage.getStore()?.resourceName;
export const currentCommunicationRequestRecorder = () => storage.getStore()?.freezeCommunicationRequest;
