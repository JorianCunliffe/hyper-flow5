// Run with agent-browser eval --stdin after opening project-context.html?view=kanban.
(async () => {
  const pause = () => new Promise(resolve => setTimeout(resolve, 200));
  const click = (label, scope = document) => {
    const button = [...scope.querySelectorAll('button')].find(button => button.innerText.trim() === label || button.firstElementChild?.textContent === label);
    if (!button) throw new Error(`Missing button: ${label}`);
    button.click();
  };
  const results = [];
  const check = (ok, label) => { if (!ok) throw new Error(label); results.push(label); };
  const selectProject = id => {
    const select = document.querySelector('.hf-project select');
    select.value = id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const mainText = () => document.querySelector('main').innerText;
  selectProject('alpha'); await pause(); click('Project'); await pause();
  check(location.search.includes('view=kanban') && mainText().includes('alpha review task') && !mainText().includes('beta review task'), 'Kanban stays open and filters Alpha');
  click('Obligations'); await pause();
  check(window.contextRequests.some(r => r.includes('/api/commitments?') && r.includes('projectId=alpha')), 'Obligations requests Alpha');
  document.querySelector('[aria-label="HyperFlow home"]').click(); await pause();
  check(document.querySelector('.hf-project select').value === 'alpha' && window.contextRequests.some(r => r.includes('/api/cockpit?') && r.includes('projectId=alpha')), 'Cockpit retains Alpha');
  selectProject('beta'); await pause();
  check(location.search.includes('view=cockpit') && window.contextRequests.some(r => r.includes('/api/cockpit?') && r.includes('projectId=beta')), 'Switching project preserves Cockpit');
  click('Approvals'); await pause(); click('All Pending'); await pause();
  check(mainText().includes('beta review task') && !mainText().includes('alpha review task'), 'Approvals filters Beta');
  click('Diary'); await pause();
  check(!document.querySelector('.hf-project select') && document.querySelector('.hf-workspace-scope'), 'Workspace page declares its scope');
  click('Obligations'); await pause();
  check(document.querySelector('.hf-project select').value === 'beta', 'Project survives workspace page round trip');
  click('Create', document.querySelector('.hf-groups')); await pause(); click('Reports', document.querySelector('dialog')); await pause(); click('Current State'); await pause();
  check(mainText().includes('beta review task') && !mainText().includes('alpha review task'), 'Reports filters Beta');
  selectProject('alpha'); await pause();
  check(mainText().includes('alpha review task') && !mainText().includes('beta review task'), 'Reports updates after project switch');
  selectProject(''); await pause();
  check(mainText().includes('alpha review task') && mainText().includes('beta review task'), 'All projects restores both records');
  document.querySelector('[aria-label="Search pages and projects"]').click(); await pause();
  click('Beta delivery', document.querySelector('dialog')); await pause();
  check(document.querySelector('.hf-project select').value === 'beta' && document.querySelector('main h2').textContent === 'Beta delivery', 'Project search opens matching project');
  check(!document.querySelector('vite-error-overlay'), 'No Vite error overlay');
  return results;
})()


