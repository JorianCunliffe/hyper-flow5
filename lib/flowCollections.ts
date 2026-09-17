import type { Milestone, Project } from '../types.js';
import { readFlowPath } from './flowData.js';

/** Materialize once before dispatch; restarts use the frozen batch data. */
export const expandCollection = (project: Project, node: Milestone): Project => {
  const config = node.actionConfig!;
  if (config.collection) return project;
  const each = config.forEach!;
  const items = readFlowPath(project.projectData || {}, each.source);
  const limit = each.maxItems ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Array.isArray(items) || items.length > limit) throw new Error(`For each source must be an array of at most ${Math.min(limit, 100)} items`);
  const keys = new Set<string>();
  const existingIds = new Set(project.milestones.map(m => m.id));
  const children: Milestone[] = items.map((item, index) => {
    const key = readFlowPath(item, each.key);
    if (!['string', 'number'].includes(typeof key) || !String(key).trim() || String(key).length > 200) throw new Error('Each item needs a stable, nonempty string or numeric key');
    const value = String(key);
    if (keys.has(value)) throw new Error(`Duplicate collection item key: ${value}`);
    keys.add(value);
    // Index identities are safe because the entire input list and shared data
    // are frozen together in the run checkpoint before any child executes.
    const id = `${node.id}__item_${index}`;
    if (existingIds.has(id)) throw new Error('Collection node identity collision');
    const data = { item, item_key: value, item_index: index };
    return {
      ...node, id, name: `${node.name} — item ${index + 1}`, subtasks: [], asks: [], completedAt: undefined,
      dependsOn: index ? [`${node.id}__item_${index - 1}`] : [...node.dependsOn],
      reviewPolicy: undefined,
      actionConfig: {
        ...config, forEach: undefined, collection: undefined, collectionParentId: node.id, collectionItem: item,
        template: config.template, collectionData: structuredClone(data),
        resultVariable: undefined, lastRun: undefined, runHistory: undefined, revision: undefined,
        autoExecute: true, failureMode: 'block'
      }
    };
  });
  const entryIds = project.projectData?.flow_entry_node_ids;
  return { ...project, projectData: Array.isArray(entryIds) && entryIds.includes(node.id) && children.length ? { ...project.projectData, flow_entry_node_ids: [...entryIds, children[0].id] } : project.projectData, milestones: [...project.milestones.map(m => m.id === node.id ? {
    ...m, dependsOn: children.length ? [children.at(-1)!.id] : m.dependsOn,
    actionConfig: { ...config, collection: { childIds: children.map(c => c.id), originalDependsOn: [...node.dependsOn], data: structuredClone(project.projectData || {}) } }
  } : m), ...children] };
};

/** The editable project keeps its original graph; expansion belongs to a run. */
export const collapseCollections = (project: Project): Project => ({
  ...project,
  projectData: Array.isArray(project.projectData?.flow_entry_node_ids) ? { ...project.projectData, flow_entry_node_ids: project.projectData.flow_entry_node_ids.filter((id: string) => !project.milestones.find(node => node.id === id)?.actionConfig?.collectionParentId) } : project.projectData,
  milestones: project.milestones.filter(node => !node.actionConfig?.collectionParentId).map(node => {
    if (!node.actionConfig?.collection) return node;
    return { ...node, dependsOn: node.actionConfig.collection.originalDependsOn,
      actionConfig: { ...node.actionConfig, collection: undefined } };
  })
});
