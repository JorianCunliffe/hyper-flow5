import type { ActionDispatch } from './actionDispatch.js';
import type { ActionOutcome } from './flowOrchestrator.js';
import { HttpCommunicationsClient } from './communications/client.js';

/** A missing/unknown receipt never authorizes another POST or a new key. */
export async function reconcileOutboundCall(row: ActionDispatch,
  read = (tenant: string, key: string) => new HttpCommunicationsClient().readCallOperation(tenant, key)
): Promise<ActionOutcome | null> {
  // Use the actual frozen provider key, including legacy/Ask correlation keys.
  const requests = Object.values(row.providerRequests || {});
  const request = requests.find(value => value?.correlation?.run_id === row.id);
  const purpose = request?.purpose?.ask_id;
  const operationKey = row.id.startsWith('op:') && !purpose ? row.id
    : request ? `hyperflow:${row.orgId}:${request.correlation.external_project_id || request.correlation.project_id}:${row.id}:${request.correlation.task_id}:voice:${purpose || 'action'}` : null;
  if (!operationKey) return null;
  try {
    const receipt = await read(row.orgId, operationKey);
    if (receipt.status === 'failed') return {status: 'error', providerCode: 'OUTBOUND_PROVIDER_REJECTED', error: 'The provider rejected the original call'};
    if (!receipt.provider_id || !receipt.communication_id) return null;
    return { status: 'pending', externalExecutionId: receipt.communication_id, externalService: 'communications',
      output: { communication_id: receipt.communication_id }, logs: ['Recovered the original call receipt; no call was dispatched.'] };
  } catch { return null; }
}
