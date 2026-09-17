const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
export const readFlowPath = (data: unknown, path: string): unknown => {
  const parts = path.trim().split('.');
  if (!parts.length || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part) || forbidden.has(part))) throw new Error(`Invalid data path: ${path}`);
  let value: any = data;
  for (const part of parts) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) throw new Error(`Missing flow input: ${path}`);
    value = value[part];
  }
  if (value === undefined) throw new Error(`Missing flow input: ${path}`);
  return value;
};
const text = (value: unknown): string => typeof value === 'string' ? value : JSON.stringify(value);
/** A single substitution pass: source text containing {{...}} remains data. */
export const renderFlowText = (template: string, data: Record<string, unknown>): string =>
  template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, path) => text(readFlowPath(data, path)));

export const renderFlowValue = (template: unknown, data: Record<string, unknown>): any => {
  if (typeof template === 'string') {
    const whole = /^\{\{\s*([^{}]+?)\s*\}\}$/.exec(template);
    return whole ? structuredClone(readFlowPath(data, whole[1])) : renderFlowText(template, data);
  }
  if (Array.isArray(template)) return template.map(value => renderFlowValue(value, data));
  if (template && typeof template === 'object') {
    return Object.fromEntries(Object.entries(template).map(([key, value]) => {
      if (forbidden.has(key)) throw new Error('Reserved object key in action template');
      return [key, renderFlowValue(value, data)];
    }));
  }
  return template;
};
export const renderActionTemplate = (template: string, data: Record<string, unknown>) => {
  let parsed: unknown;
  try { parsed = JSON.parse(template); }
  catch {
    const parsedContent = renderFlowText(template, data);
    return { parsedContent, templateData: { body: parsedContent } as Record<string, any> };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Action template must be a JSON object');
  const rendered = renderFlowValue(parsed, data);
  return { parsedContent: JSON.stringify(rendered), templateData: rendered as Record<string, any> };
};

export interface FlowOutputSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  properties?: Record<string, FlowOutputSchema>;
  required?: string[];
  items?: FlowOutputSchema;
  enum?: Array<string | number | boolean>;
  description?: string;
  maxItems?: number;
  additionalProperties?: false;
}
export const validateOutputSchema = (schema: any, depth = 0): FlowOutputSchema => {
  if (!schema || typeof schema !== 'object' || depth > 8 || !['object', 'array', 'string', 'number', 'integer', 'boolean'].includes(schema.type)) throw new Error('Invalid structured output schema');
  const supported = new Set(['type', 'properties', 'required', 'items', 'enum', 'description', 'maxItems', 'additionalProperties']);
  if (Object.keys(schema).some(key => !supported.has(key)) || (schema.additionalProperties !== undefined && schema.additionalProperties !== false)) throw new Error('Unsupported structured output schema option');
  if (schema.type === 'object') {
    if (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties) || Object.keys(schema.properties).length > 50) throw new Error('Object schema needs up to 50 named properties');
    for (const [key, value] of Object.entries(schema.properties)) {
      if (forbidden.has(key)) throw new Error('Reserved schema property');
      validateOutputSchema(value, depth + 1);
    }
    if (schema.required && (!Array.isArray(schema.required) || schema.required.some((key: any) => typeof key !== 'string' || !Object.hasOwn(schema.properties, key)))) throw new Error('Invalid required schema properties');
  }
  if (schema.type === 'array') validateOutputSchema(schema.items, depth + 1);
  if (schema.maxItems !== undefined && (!Number.isInteger(schema.maxItems) || schema.maxItems < 0 || schema.maxItems > 100)) throw new Error('maxItems must be 0–100');
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.length || schema.enum.length > 100)) throw new Error('Invalid schema enum');
  return schema;
};
export const validateFlowOutput = (value: any, schema: FlowOutputSchema, path = 'output'): void => {
  const valid = schema.type === 'array' ? Array.isArray(value) : schema.type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) : schema.type === 'integer' ? Number.isInteger(value) : schema.type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === schema.type;
  if (!valid) throw new Error(`${path} must be ${schema.type}`);
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path} is not an allowed value`);
  if (schema.type === 'object') {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) throw new Error(`${path}.${key} is required`);
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties || {}, key)) throw new Error(`${path}.${key} is not in the schema`);
      validateFlowOutput(item, schema.properties![key], `${path}.${key}`);
    }
  }
  if (schema.type === 'array') {
    if (value.length > (schema.maxItems ?? 100)) throw new Error(`${path} has too many items`);
    value.forEach((item: any, index: number) => validateFlowOutput(item, schema.items!, `${path}.${index}`));
  }
};
