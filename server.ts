import express from "express";
import path from "path";
import cors from "cors";
import { Resend } from "resend";
import { createServer as createViteServer } from "vite";
import { WebSocketServer } from "ws";

import { GoogleGenAI, Type, Modality, LiveServerMessage } from "@google/genai";
import { executeTask } from "./lib/executeTask";
import { advanceServerFlow, readAskByToken, respondToAsk } from "./lib/serverFlow";
import { receiveExternalEvent } from "./lib/externalEvents";
import { isServerStoreConfigured } from "./lib/serverStore";

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

  // Durable provider-neutral inbox. Mirrors api/events.ts for local development.
  app.post("/api/events", async (req, res) => {
    const apiKey = process.env.COMMUNICATIONS_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'COMMUNICATIONS_API_KEY is not configured' });
    if (req.headers.authorization !== `Bearer ${apiKey}`) return res.status(403).json({ error: 'Forbidden' });
    if (!isServerStoreConfigured()) return res.status(503).json({ error: 'Server-side persistence is not configured' });

    try {
      const outcome = await receiveExternalEvent(req.body);
      return res.status(outcome.retryable ? 409 : 200).json(outcome);
    } catch (error: any) {
      if (/required|JSON object/.test(error?.message || '')) return res.status(400).json({ error: error.message });
      console.error('External event handler failed', error);
      return res.status(500).json({ error: 'Handler failed' });
    }
  });

  // Read or answer a single ask, authorised by its token. Mirrors
  // api/asks/[token].ts so a review link works the same in local dev.
  app.all(["/api/asks/:token", "/forms/ask/:token"], async (req, res) => {
    if (!isServerStoreConfigured()) {
      return res.status(503).json({ error: 'Server-side persistence is not configured' });
    }

    const token = String(req.params.token || '');
    const orgId = String(req.query.org || '');
    const projectId = String(req.query.project || '');
    if (!token || !orgId || !projectId) {
      return res.status(400).json({ error: 'token, org and project are required' });
    }

    try {
      const found = await readAskByToken(orgId, projectId, token);
      // Same response for a bad token and a missing ask — do not confirm which.
      if (!found) return res.status(404).json({ error: 'Not found' });

      if (req.method === 'GET') {
        const { ask, nodeName, projectName } = found;
        return res.status(200).json({
          projectName,
          nodeName,
          ask: {
            id: ask.id, kind: ask.kind, status: ask.status, prompt: ask.prompt,
            fields: ask.fields, artifact: ask.artifact, createdAt: ask.createdAt, dueAt: ask.dueAt,
            responses: ask.responses.map(r => ({
              at: r.at, via: r.via, actor: r.actor, decision: r.decision,
              text: r.text, attachments: r.attachments, needsInterpretation: r.needsInterpretation
            }))
          }
        });
      }

      if (req.method === 'POST') {
        const { decision, text, values, attachments, actor } = req.body || {};
        if (typeof text === 'string' && text.length > 20000) {
          return res.status(413).json({ error: 'Comment is too long' });
        }

        const outcome = await respondToAsk({
          orgId, projectId, askToken: token, channel: 'web',
          response: {
            actor: typeof actor === 'string' && actor.trim() ? actor.trim() : 'via link',
            decision, text, structured: values, attachments
          }
        });
        if (!outcome.ok) {
          const status = outcome.reason === 'already_answered' ? 409
            : outcome.reason === 'ask_not_found' || outcome.reason === 'project_not_found' ? 404
            : 400;
          return res.status(status).json({ error: outcome.reason });
        }
        return res.status(200).json({
          ok: true,
          askStatus: outcome.askStatus,
          log: outcome.log,
          needsInterpretation: outcome.response?.needsInterpretation ?? false
        });
      }

      return res.status(405).json({ error: 'Method not allowed' });
    } catch (e: any) {
      console.error('Ask endpoint failed', e);
      return res.status(500).json({ error: 'Request failed' });
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
