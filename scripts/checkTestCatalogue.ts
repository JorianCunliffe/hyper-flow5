/** Offline catalogue validation only. Never imports execution/provider clients. */
import { readFileSync, writeFileSync } from 'node:fs';
import { TASK_TYPES } from '../lib/taskTypes.js';
import { ACTION_TASK_TYPE } from '../lib/nodeTypes.js';
import { taskContracts } from '../lib/http/taskContracts.js';
import { NodeType } from '../types.js';

const root = new URL('../docs/testing/', import.meta.url);
const catalogue = JSON.parse(readFileSync(new URL('catalogue.json', root), 'utf8'));
const template = JSON.parse(readFileSync(new URL('campaign-template.json', root), 'utf8'));
const errors: string[] = [];
const ids = new Set<string>();
const capabilities = new Set<string>();
const knownCapabilities = new Set([
  ...TASK_TYPES.map(t => `task:${t}`),
  ...Object.values(NodeType).map(t => `node:${t}`),
]);
for (const c of catalogue.cases) {
  if (!/^[A-Z]+-\d{2}(-NEG)?$/.test(c.id) || ids.has(c.id)) errors.push(`Invalid/duplicate ID: ${c.id}`);
  ids.add(c.id);
  for (const key of ['title', 'area', 'profile']) if (!c[key]) errors.push(`${c.id}: missing ${key}`);
  for (const key of ['steps', 'expected', 'prerequisites', 'modes', 'evidenceBundles']) {
    if (!Array.isArray(c[key]) || !c[key].length) errors.push(`${c.id}: empty ${key}`);
  }
  if (!catalogue.profiles[c.profile]) errors.push(`${c.id}: unknown profile`);
  if (c.priority !== 'release-required' || c.initialStatus !== 'NOT RUN') errors.push(`${c.id}: invalid baseline state`);
  for (const mode of c.modes) if (!['fixture', 'live', 'browser'].includes(mode)) errors.push(`${c.id}: unknown mode ${mode}`);
  for (const bundle of c.evidenceBundles) if (!catalogue.evidenceBundles[bundle]) errors.push(`${c.id}: unknown evidence bundle`);
  for (const capability of c.capabilities) {
    if (!knownCapabilities.has(capability)) errors.push(`${c.id}: unknown capability ${capability}`);
    capabilities.add(capability);
  }
}
for (const c of catalogue.cases) for (const dep of c.dependencies) {
  if (!ids.has(dep) || dep === c.id) errors.push(`${c.id}: invalid dependency ${dep}`);
}
for (const capability of knownCapabilities) if (!capabilities.has(capability)) errors.push(`Missing coverage: ${capability}`);
for (const task of new Set([...TASK_TYPES, ...Object.keys(taskContracts)])) {
  if (!TASK_TYPES.includes(task as typeof TASK_TYPES[number]) || !(task in taskContracts)) errors.push(`Task contract drift: ${task}`);
  const positive = catalogue.cases.find((c: any) => c.capabilities.includes(`task:${task}`) && c.modes.includes('live'));
  const negative = catalogue.cases.find((c: any) => c.capabilities.includes(`task:${task}`) && c.id.endsWith('-NEG'));
  if (!positive || !negative) errors.push(`Missing positive/negative task coverage: ${task}`);
}
for (const [node, task] of Object.entries(ACTION_TASK_TYPE)) {
  if (!catalogue.cases.some((c: any) => c.capabilities.includes(`node:${node}`) && c.capabilities.includes(`task:${task}`))) {
    errors.push(`Missing action/node mapping: ${node}/${task}`);
  }
}
if (template.catalogueVersion !== catalogue.catalogueVersion || template.status !== 'NOT RUN' || template.results.length) {
  errors.push('Campaign template must match catalogue and contain no executed results');
}
const md = ['# HyperFlow test catalogue', '',
  `Version **${catalogue.catalogueVersion}** · ${catalogue.cases.length} cases · default status **NOT RUN**.`, '',
  'Generated operator index of [catalogue.json](catalogue.json). See [campaign instructions](README.md). Every row is release-required; required variants are separate results. Fixture means isolated, deterministic tests; live means actual provider evidence; browser means UI verification.', '',
  '| ID | Area | Modes | Case / procedure | Required outcome |',
  '| --- | --- | --- | --- | --- |',
  ...catalogue.cases.map((c: any) => `| ${c.id} | ${c.area} | ${c.modes.join(', ')} | **${c.title}**<br>${c.steps.join('<br>')} | ${c.expected.join('<br>')} |`), ''].join('\n');
if (process.argv.includes('--render') && !errors.length) writeFileSync(new URL('CATALOGUE.md', root), md);
if (readFileSync(new URL('CATALOGUE.md', root), 'utf8').replace(/\r\n/g, '\n') !== md) errors.push('Operator index is stale: run npm run test:catalogue -- --render');
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Catalogue valid: ${ids.size} cases, ${TASK_TYPES.length} actions, ${Object.values(NodeType).length} node types. No provider calls; no acceptance results changed.`);
}
