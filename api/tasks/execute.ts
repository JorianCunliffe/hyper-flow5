import type { VercelRequest, VercelResponse } from '@vercel/node';
import { executeTask } from '../../lib/executeTask.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { taskType, templateFile, projectData } = req.body || {};
    const result = await executeTask(taskType, templateFile, projectData);
    res.status(result.httpStatus).json(result.body);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
