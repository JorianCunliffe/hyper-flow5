import express from "express";
import path from "path";
import cors from "cors";
import { Resend } from "resend";
import { createServer as createViteServer } from "vite";
import { WebSocketServer } from "ws";

import { GoogleGenAI, Type, Modality, LiveServerMessage } from "@google/genai";
import { executeTask } from "./lib/executeTask";
import { normalizeBlandCallback } from "./lib/inboundVoice";
import { advanceServerFlow, resolveCallbackAndAdvance } from "./lib/serverFlow";
import { claimWebhookEvent, isServerStoreConfigured, releaseWebhookEvent } from "./lib/serverStore";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  let resend: Resend | null = null;
  const getResend = () => {
    if (!resend) {
      if (!process.env.RESEND_API_KEY) {
        throw new Error('RESEND_API_KEY environment variable is required');
      }
      resend = new Resend(process.env.RESEND_API_KEY);
    }
    return resend;
  };

  const callSessions = new Map<string, { history: any[], context: string }>();

  app.post("/api/gemini/generateProjectStructure", async (req, res) => {
    try {
      const { name, type } = req.body;
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: `Generate a logical project structure for a project named "${name}" of type "${type}". 
        The response must be a JSON object containing milestones. 
        Each milestone must have a unique ID, a name, a list of subtasks, and an array of 'dependsOn' milestone IDs to form a sequence or parallel paths.
        Ensure there is at least one start milestone (empty dependsOn).
        Each subtask needs a name, description, and status.`,
        config: {
          responseMimeType: "application/json",
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
                        required: ["name", "description"]
                      }
                    }
                  },
                  required: ["id", "name", "dependsOn", "subtasks"]
                }
              }
            }
          }
        }
      });
      const text = response.text;
      res.status(200).json(text ? JSON.parse(text) : null);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: String(error) });
    }
  });

  app.post("/api/gemini/brainstormSubtasks", async (req, res) => {
    try {
      const { milestoneName, projectContext } = req.body;
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: `Given a milestone called "${milestoneName}" in a project described as "${projectContext}", suggest 5 critical subtasks that might be required.
        Return a JSON array of objects, each with 'name' and 'description'.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                description: { type: Type.STRING }
              },
              required: ["name", "description"]
            }
          }
        }
      });
      res.status(200).json(response.text ? JSON.parse(response.text) : []);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: String(error) });
    }
  });

  app.post("/api/send-email", async (req, res) => {
    try {
      const { to, subject, html } = req.body;
      
      const resendClient = getResend();
      const { data, error } = await resendClient.emails.send({
        from: "automation@projectflow.online",
        to,
        subject,
        html,
      });

      if (error) {
        return res.status(400).json({ error });
      }

      res.status(200).json({ data });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: String(error) });
    }
  });

  app.post("/api/tasks/execute", async (req, res) => {
    try {
      const { taskType, templateFile, projectData, correlation, revision } = req.body;
      const result = await executeTask(taskType, templateFile, projectData, {
        webhookBaseUrl: process.env.PUBLIC_BASE_URL,
        callbackSecret: process.env.WEBHOOK_SECRET,
        correlation,
        revision
      });
      res.status(result.httpStatus).json(result.body);
    } catch(e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // Inbound: Bland call completion. Mirrors api/inbound/voice/bland.ts so local
  // dev (with a tunnel pointing at PUBLIC_BASE_URL) behaves like production.
  app.post("/api/inbound/voice/bland", async (req, res) => {
    const expected = process.env.WEBHOOK_SECRET;
    if (expected && req.query.secret !== expected) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!isServerStoreConfigured()) {
      console.error('Bland webhook received but server store is not configured');
      return res.status(200).json({ ok: false, reason: 'server_store_not_configured' });
    }

    const event = normalizeBlandCallback(req.body);
    if (!event.eventId) return res.status(400).json({ error: 'Missing call_id' });
    if (!event.orgId || !event.projectId) {
      console.error('Bland webhook missing correlation metadata', { callId: event.eventId });
      return res.status(200).json({ ok: false, reason: 'missing_correlation' });
    }

    const claimed = await claimWebhookEvent('bland', event.eventId);
    if (!claimed) return res.status(200).json({ ok: true, duplicate: true });

    try {
      const outcome = await resolveCallbackAndAdvance(
        event.orgId,
        event.projectId,
        { runId: event.runId, externalId: event.eventId },
        { status: event.status, output: event.output, logs: event.logs, error: event.error, resolvedBy: 'webhook:bland' }
      );
      if (!outcome.ok) {
        console.warn('Bland webhook could not be applied', { callId: event.eventId, reason: outcome.reason });
        return res.status(200).json({ ok: false, reason: outcome.reason });
      }
      return res.status(200).json({ ok: true, log: outcome.log, pending: outcome.pending });
    } catch (e) {
      await releaseWebhookEvent('bland', event.eventId);
      console.error('Bland webhook handler failed', e);
      return res.status(500).json({ error: 'Handler failed' });
    }
  });

  app.post("/api/flow/advance", async (req, res) => {
    const expected = process.env.WEBHOOK_SECRET;
    if (!expected) return res.status(503).json({ error: 'WEBHOOK_SECRET is not configured' });
    if (req.headers['x-webhook-secret'] !== expected) return res.status(403).json({ error: 'Forbidden' });
    if (!isServerStoreConfigured()) {
      return res.status(503).json({ error: 'Server-side persistence is not configured' });
    }

    const { orgId, projectId } = req.body || {};
    if (!orgId || !projectId) return res.status(400).json({ error: 'orgId and projectId are required' });
    try {
      const outcome = await advanceServerFlow(String(orgId), String(projectId));
      if (!outcome.ok) return res.status(404).json({ error: outcome.reason });
      return res.status(200).json(outcome);
    } catch (e: any) {
      console.error('Server-side advance failed', e);
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });


  app.get("/api/calls/status/:call_id", async (req, res) => {
    try {
      if (!process.env.BLAND_API_KEY) throw new Error('BLAND_API_KEY environment variable is required');
      const response = await fetch(`https://api.bland.ai/v1/calls/${req.params.call_id}`, {
        method: 'GET',
        headers: {
          'Authorization': process.env.BLAND_API_KEY
        }
      });
      const data = await response.json();
      res.json(data);
    } catch(e) {
      res.status(500).json({ error: String(e) });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.use((req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  const wssBrowser = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;
    
    if (pathname === '/api/live-voice') {
      wssBrowser.handleUpgrade(request, socket, head, (ws) => {
        wssBrowser.emit('connection', ws, request);
      });
    }
  });

  wssBrowser.on('connection', async (clientWs, req) => {
    console.log("WebSocket connected to /api/live-voice");
    const urlContext = new URL(req.url || '', `http://${req.headers.host}`).searchParams.get('context') || "You are a helpful assistant.";
    
    let session: any = null;

    try {
      if (!process.env.GEMINI_API_KEY) {
        console.error("GEMINI_API_KEY missing");
        clientWs.close();
        return;
      }
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      session = await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: { parts: [{ text: urlContext }] },
          speechConfig: {
             voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } }
          }
        },
        callbacks: {
          onmessage: (msg: LiveServerMessage) => {
             const audio = msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
             if (audio) {
               if (clientWs.readyState === 1) { // OPEN
                 clientWs.send(JSON.stringify({ audio }));
               }
             }
             if (msg.serverContent?.interrupted) {
               if (clientWs.readyState === 1) { // OPEN
                 clientWs.send(JSON.stringify({ interrupted: true }));
               }
             }
          }
        }
      });

      clientWs.on('message', (data) => {
        try {
          const { audio } = JSON.parse(data.toString());
          if (audio) {
             session.sendRealtimeInput({
               audio: {
                 mimeType: "audio/pcm;rate=16000",
                 data: audio
               }
             });
          }
        } catch(e) {}
      });

      clientWs.on('close', () => {
        // cleanup if needed
      });
    } catch (e) {
      console.error("Gemini Live connection failed", e);
      clientWs.close();
    }
  });

}

startServer();
