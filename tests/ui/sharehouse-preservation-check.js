// Run on sharehouse-setup.html with: agent-browser eval --stdin < this-file
// Exercises the real modal; assertions inspect its persisted result, not save helpers.
(async () => {
  const pause = () => new Promise(resolve => setTimeout(resolve, 150));
  const key = 'sharehouse-isolated-setup-v1';
  const results = [];
  const check = (ok, label) => { if (!ok) throw new Error(label); results.push(label); };
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const click = text => {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text);
    if (!button) throw new Error('Missing button: ' + text);
    button.click();
  };
  const human = id => JSON.parse(localStorage.getItem(key)).project.milestones.find(n => n.id === id).holdConfig.human;
  const fill = (label, value) => {
    const wrapper = [...document.querySelectorAll('label')].find(e => e.textContent.trim().startsWith(label));
    const el = wrapper?.querySelector('textarea,input');
    if (!el) throw new Error('Missing input: ' + label);
    const prototype = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  click('Load preservation regression'); await pause();
  const before = human('incident_answers');
  check(before.fields.length === 2 && before.quorum === 2, 'Nontrivial static schema and quorum seeded');
  click('Edit selected node'); await pause();
  fill('Prompt', 'Confirm arrival time without changing the question contract.');
  const voice = [...document.querySelectorAll('label')].find(e => e.textContent.trim() === 'voice')?.querySelector('input');
  check(Boolean(voice && !voice.disabled), 'Delivery channel is editable');
  voice.click(); await pause();
  click('Save'); await pause();
  const after = human('incident_answers');
  check(equal(after.fields, before.fields), 'Static fields, types, required flags and options survive save');
  check(after.responsePolicy === 'quorum' && after.quorum === 2, 'Quorum response policy survives save');
  check(after.prompt === 'Confirm arrival time without changing the question contract.', 'Prompt edit is applied');
  check(after.channels.includes('voice'), 'Channel edit is applied');
  click('Edit selected node'); await pause(); click('Save'); await pause();
  check(equal(human('incident_answers').fields, before.fields), 'Reopening and saving preserves schema again');
  const select = document.querySelector('select[aria-label="Workflow node"]');
  select.value = 'morning_answers'; select.dispatchEvent(new Event('change', { bubbles: true })); await pause();
  const morning = human('morning_answers');
  click('Edit selected node'); await pause(); click('Save'); await pause();
  check(human('morning_answers').fieldsSource === morning.fieldsSource, 'Dynamic schema source survives save');
  check(equal(human('morning_answers').escalation, morning.escalation), 'Escalation settings survive save');
  return { passed: results.length, results, providerCalls: 0 };
})();
