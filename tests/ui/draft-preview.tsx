import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MailboxDraftPreview } from '../../components/triage/MailboxDraftPreview';
import type { DraftPreview } from '../../lib/triage/draftPreview';
let reads = 0;
const load = async (id: string): Promise<DraftPreview> => {
  if (id === 'deleted') throw new Error('This draft is no longer available. It may have been sent, moved or deleted in the mailbox.');
  reads++;
  return { provider: 'outlook', subject: 'Room enquiry', to: ['guest@example.com'], cc: [], bcc: [], body: `<p>Hi guest,</p><p>Draft revision ${reads}.<br>Two people: $371/week.</p><script>document.title='UNSAFE'</script><img src="https://invalid.example/tracker">`, bodyType: 'html', truncated: false, webUrl: 'https://outlook.office.com/mail/', fetchedAt: new Date().toISOString() };
};
const Fixture = () => {
  const [id, setId] = useState('existing');
  return <main style={{ maxWidth: 700, margin: '40px auto', fontFamily: 'sans-serif' }}><button onClick={() => setId('deleted')}>Deleted draft</button><button onClick={() => setId('existing')}>Existing draft</button><MailboxDraftPreview key={id} itemId={id} load={load} /></main>;
};
createRoot(document.getElementById('root')!).render(<Fixture />);
