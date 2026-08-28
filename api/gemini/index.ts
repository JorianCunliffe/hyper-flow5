import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from '@google/genai';
import { ApiAuthError, requireAppMember } from '../../lib/apiAuth.js';

const brainstormSubtasks = async (req: VercelRequest, res: VercelResponse) => {
  const { milestoneName, projectContext } = req.body || {};
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3.5-flash',
    contents: `Given a milestone called "${milestoneName}" in a project described as "${projectContext}", suggest 5 critical subtasks that might be required.
    Return a JSON array of objects, each with 'name' and 'description'.`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: { name: { type: Type.STRING }, description: { type: Type.STRING } },
          required: ['name', 'description']
        }
      }
    }
  });
  return res.status(200).json(response.text ? JSON.parse(response.text) : []);
};

const generateProjectStructure = async (req: VercelRequest, res: VercelResponse) => {
  const { name, type } = req.body || {};
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3.5-flash',
    contents: `Generate a logical project structure for a project named "${name}" of type "${type}".
    The response must be a JSON object containing milestones.
    Each milestone must have a unique ID, a name, a list of subtasks, and an array of 'dependsOn' milestone IDs to form a sequence or parallel paths.
    Ensure there is at least one start milestone (empty dependsOn).
    Each subtask needs a name, description, and status.`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          milestones: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                name: { type: Type.STRING },
                dependsOn: { type: Type.ARRAY, items: { type: Type.STRING } },
                subtasks: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: { name: { type: Type.STRING }, description: { type: Type.STRING } },
                    required: ['name', 'description']
                  }
                }
              },
              required: ['id', 'name', 'dependsOn', 'subtasks']
            }
          }
        }
      }
    }
  });
  return res.status(200).json(response.text ? JSON.parse(response.text) : null);
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    await requireAppMember(req);
    const action = typeof req.query.action === 'string' ? req.query.action : '';
    if (action === 'brainstormSubtasks') return await brainstormSubtasks(req, res);
    if (action === 'generateProjectStructure') return await generateProjectStructure(req, res);
    return res.status(404).json({ error: 'Unknown Gemini operation' });
  } catch (error: any) {
    console.error(error);
    return res.status(error instanceof ApiAuthError ? error.status : 500).json({ error: error?.message || String(error) });
  }
}
