import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EditProjectModal } from '../../components/modals/EditProjectModal';
import type { Project } from '../../types';
function Fixture() {
  const [project, setProject] = useState<Project>({ id: 'fixture', name: 'Email testing', company: '', type: '', startDate: Date.now(), createdAt: Date.now(), updatedAt: Date.now(), milestones: [] });
  const [open, setOpen] = useState(true);
  return <><button onClick={() => setOpen(true)}>Edit project</button><output>Saved email sending: {project.emailSendingEnabled === true ? 'enabled' : 'disabled'}</output>
    {open && <EditProjectModal project={project} isOpen onClose={() => setOpen(false)} settings={{ companies: [], projectTypes: [] } as any}
      onBulkOperation={() => {}} onSave={value => { setProject(value); setOpen(false); }} />}</>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
