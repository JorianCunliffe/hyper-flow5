import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NodeConfigModal } from '../../components/modals/NodeConfigModal';
import { NodeType, type Milestone } from '../../types';
const source: Milestone = { id: 'rooms', name: 'Check availability', subtasks: [], dependsOn: [], estimatedDuration: 0, nodeType: NodeType.WEBHOOK, actionConfig: { template: '{}', resultVariable: 'room_availability' } };
const initial: Milestone = { id: 'triage', name: 'Email triage', subtasks: [], dependsOn: ['rooms'], estimatedDuration: 0, nodeType: NodeType.EMAIL_TRIAGE, actionConfig: { template: '{"connection_id":"synthetic-mailbox"}' } };
const Fixture = () => {
  const [node, setNode] = useState(initial);
  const [open, setOpen] = useState(true);
  return <><button onClick={() => setOpen(true)}>Edit saved node</button><pre aria-label="Saved configuration">{JSON.stringify(node.actionConfig, null, 2)}</pre>{open && <NodeConfigModal milestone={node} milestones={[source, node]} projectData={{ property_information: { weekly_price: 371 }, room_availability_output: { webhook_response: { details: { userMessage: ['Room A'] } } } }} onClose={() => setOpen(false)} onSave={update => setNode(current => ({ ...current, ...update }))} onRun={() => { throw new Error('Fixture does not execute providers'); }} isRunning={false} />}</>;
};
createRoot(document.getElementById('root')!).render(<Fixture />);
