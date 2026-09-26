import { handleConfiguration } from '../../lib/configuration/api.js';
import { handleTestRuns } from '../../lib/configuration/testRuns.js';
import { discoveryResponse } from '../../lib/http/discovery.js';
import { handleCapturedWork } from '../../lib/capturedWork/api.js';
import { CaptureError } from '../../lib/capturedWork/model.js';
import { handleLifecycle } from '../../lib/tenantLifecycle/api.js';
import { handleFiles } from '../../lib/files/api.js';
import { FileError } from '../../lib/files/model.js';
import { LifecycleError } from '../../lib/tenantLifecycle/model.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from '@google/genai';
import { ApiAuthError, requireAppMember } from '../../lib/apiAuth.js';
import { handleVisibleFlows, publicFlowResponse } from '../../lib/visibleFlows/api.js';
import { FlowError } from '../../lib/visibleFlows/model.js';
import { handleCockpit } from '../../lib/cockpit/api.js';
import { handleCalendar } from '../../lib/calendar/api.js';
import { publishingRequest } from '../../lib/publishing/store.js';
import { PublishingError } from '../../lib/publishing/model.js';
import { handleArtifacts } from '../../lib/artifacts/api.js';
import { ArtifactError } from '../../lib/artifacts/model.js';
import { CalendarError } from '../../lib/calendar/model.js';
import { handleTenantControl, handleWorkspace } from '../../lib/tenantControl/api.js';
import { TenantControlError } from '../../lib/tenantControl/model.js';

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
  try {
    const action = typeof req.query.action === 'string' ? req.query.action : '';
    if (action === 'tenant' && req.query.view === 'lifecycle') return res.status(200).json(await handleLifecycle(req));
    const member = await requireAppMember(req);
    if (action === 'captured-work-items') { res.setHeader('Cache-Control', 'no-store'); return res.status(200).json(await handleCapturedWork(req, member)); }
    if (action === 'discovery') {if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});return res.status(200).json(discoveryResponse(req.query.format));}
    if (action === 'configuration') { res.setHeader('Cache-Control', 'no-store'); return res.status(200).json(await handleConfiguration(req,member)); }
    if (action === 'test_runs') { res.setHeader('Cache-Control', 'no-store'); return res.status(200).json(await handleTestRuns(req,member)); }
    if (action === 'files') return res.status(200).json(await handleFiles(req,member));
    if (action === 'tenant') return res.status(200).json(await handleTenantControl(req,member));
    if (action === 'workspace') return res.status(200).json(await handleWorkspace(req,member));
    if (action === 'flows') return res.status(200).json(publicFlowResponse(await handleVisibleFlows(req,member)));
    if (action === 'cockpit') return res.status(200).json(publicFlowResponse(await handleCockpit(req,member)));
    if (action === 'publishing') return res.status(200).json(await publishingRequest(req,member));
    if (action === 'artifacts') return res.status(200).json(await handleArtifacts(req,member));
    if (action === 'calendar') return res.status(200).json(await handleCalendar(req,member));
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (action === 'brainstormSubtasks') return await brainstormSubtasks(req, res);
    if (action === 'generateProjectStructure') return await generateProjectStructure(req, res);
    return res.status(404).json({ error: 'Unknown Gemini operation' });
  } catch (error: any) {
    console.error(error);
    return res.status(error instanceof CaptureError || error instanceof FileError || error instanceof LifecycleError || error instanceof ApiAuthError || error instanceof TenantControlError || error instanceof FlowError || error instanceof CalendarError || error instanceof ArtifactError || error instanceof PublishingError ? error.status : 500).json({ error: error?.message || String(error) });
  }
}
