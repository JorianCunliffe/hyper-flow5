import type { Milestone, Project } from '../types.js';
import { activeOccurrenceId } from './flowEngine.js';

/** Enforced before dispatch for every action, including manual execution. */
export const requireCurrentResults = (project: Project, node: Milestone): void => {
  for (const key of node.actionConfig?.requiredResults || []) {
    const sources = project.milestones.filter(candidate => candidate.actionConfig?.resultVariable === key);
    if (sources.length !== 1 || sources[0].id === node.id) throw new Error(`Required result ${key} must identify one other node`);
    const run = sources[0].actionConfig?.lastRun;
    const occurrence = activeOccurrenceId(project.projectData);
    if (!occurrence || run?.scheduleOccurrenceId !== occurrence || run?.status !== 'success' || run.communicationOutcome?.successful === false) {
      throw new Error(`Required result ${key} has not succeeded in this run. Run ${sources[0].name} first.`);
    }
  }
};

/** Explicitly selected context only; never send the entire project store to AI. */
export const validateReferenceContext = (value: unknown): unknown => {
  if (value === undefined) return undefined;
  if (value === null || (typeof value === 'string' && !value.trim())) throw new Error('Reference context is empty');
  const encoded = JSON.stringify(value);
  if (!encoded || encoded.length > 40000) throw new Error('Reference context must be at most 40,000 characters; select narrower data paths');
  return structuredClone(value);
};

export const listFlowDataPaths = (data: unknown, prefix = '', depth = 0): string[] => {
  if (!data || typeof data !== 'object' || depth > 6) return [];
  return Object.entries(data).slice(0, 100).flatMap(([key, value]) => {
    if (!/^[A-Za-z0-9_-]+$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) return [];
    const path = prefix ? `${prefix}.${key}` : key;
    return [path, ...listFlowDataPaths(value, path, depth + 1)];
  }).slice(0, 500);
};
