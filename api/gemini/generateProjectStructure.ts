import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from '@google/genai';
import { ApiAuthError, requireAppMember } from '../../lib/apiAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    await requireAppMember(req);
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
                      properties: {
                        name: { type: Type.STRING },
                        description: { type: Type.STRING }
                      },
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
    const text = response.text;
    res.status(200).json(text ? JSON.parse(text) : null);
  } catch (error: any) {
    console.error(error);
    res.status(error instanceof ApiAuthError ? error.status : 500).json({ error: error?.message || String(error) });
  }
}
