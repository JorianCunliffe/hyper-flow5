import { GoogleGenAI, Type } from '@google/genai';
import type { HumanAsk, HumanResponse } from '../../types.js';
import { buildResponse, type BuildResponseInput } from '../askResponses.js';

const MODEL = process.env.COMMUNICATIONS_INTENT_MODEL || 'gemini-3.5-flash';

const evidenceExcerpt = (text: string): string => text.trim().replace(/\s+/g, ' ').slice(0, 500);

/**
 * Deterministic parsing always runs first. A model is used only for genuine
 * prose that the Ask parser could not classify, and its structured result is
 * still passed through the Ask schema before it can affect workflow state.
 */
export const interpretAskResponse = async (
  ask: HumanAsk,
  input: BuildResponseInput,
  generate = (request: Parameters<GoogleGenAI['models']['generateContent']>[0]) =>
    new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }).models.generateContent(request)
): Promise<HumanResponse> => {
  const deterministic = buildResponse(ask, input);
  if (!deterministic.needsInterpretation || !input.text?.trim() || !process.env.GEMINI_API_KEY) {
    return deterministic;
  }

  try {
    const fields = (ask.fields || []).map(field => ({
      name: field.name,
      label: field.label,
      type: field.type,
      required: field.required
    }));
    const response = await generate({
      model: MODEL,
      contents: [
        'Extract only the response explicitly supported by the message. Do not infer unstated agreement or values.',
        `Ask kind: ${ask.kind}`,
        `Ask prompt: ${ask.prompt}`,
        ask.kind === 'approval'
          ? `Allowed decisions: ${(ask.responseContract?.allowedDecisions || ['approved', 'rejected', 'revise']).join(', ')}`
          : 'This is not an approval. Extract field values only; do not return a decision.',
        `Expected intents: ${(ask.responseContract?.expectedIntents || []).join(', ') || 'not constrained'}`,
        `Fields: ${JSON.stringify(fields)}`,
        `Message: ${input.text}`
      ].join('\n'),
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            intent: { type: Type.STRING },
            ...(ask.kind === 'approval' ? { decision: { type: Type.STRING } } : {}),
            values: { type: Type.OBJECT },
            confidence: { type: Type.NUMBER },
            evidence: { type: Type.STRING }
          },
          required: ['intent', 'confidence', 'evidence']
        }
      }
    });
    const extracted = JSON.parse(response.text || '{}');
    const confidence = Math.max(0, Math.min(1, Number(extracted.confidence) || 0));
    const allowed = ask.responseContract?.allowedDecisions || ['approved', 'rejected', 'revise'];
    const decision = ask.kind === 'approval' && allowed.includes(extracted.decision) ? extracted.decision : undefined;
    const interpreted = buildResponse(ask, {
      ...input,
      decision,
      values: extracted.values && typeof extracted.values === 'object' ? extracted.values : undefined
    });
    const threshold = ask.responseContract?.confidenceThreshold ?? 0.9;
    const policy = ask.responseContract?.automaticProgress || 'validated';
    const needsReview = ask.responseContract?.reviewRequired === true
      || policy === 'never'
      || confidence < threshold
      || interpreted.needsInterpretation === true;
    return {
      ...interpreted,
      confidence,
      needsInterpretation: needsReview || undefined,
      intent: typeof extracted.intent === 'string' ? extracted.intent : undefined,
      evidenceExcerpt: typeof extracted.evidence === 'string'
        ? evidenceExcerpt(extracted.evidence)
        : evidenceExcerpt(input.text),
      modelVersion: MODEL,
      interpretedAt: Date.now()
    };
  } catch {
    // Model unavailability can never turn an uncertain response into approval.
    return deterministic;
  }
};
