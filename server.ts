import {mountApi} from './lib/http/express.js';
import {handleCapturedWork} from './lib/capturedWork/api.js';
import {ambientCaptureInstructions,captureWorkItemTool} from './lib/capturedWork/tool.js';
import {verifyFirebaseIdToken,requireOrganizationMember} from './lib/serverStore.js';
import express from 'express';
import path from 'node:path';
import cors from 'cors';
import {createServer as createViteServer} from 'vite';
import {WebSocketServer} from 'ws';
import {GoogleGenAI,Modality,type LiveServerMessage} from '@google/genai';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());

  mountApi(app);

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

  server.on('upgrade', async (request, socket, head) => {
    const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;
    
    if (pathname === '/api/live-voice') {
      try {
        const token = new URL(request.url || '', `http://${request.headers.host}`).searchParams.get('token') || '';
        const identity = await verifyFirebaseIdToken(token);
        (request as any).captureMember = await requireOrganizationMember(identity.uid);
      } catch {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      wssBrowser.handleUpgrade(request, socket, head, (ws) => {
        wssBrowser.emit('connection', ws, request);
      });
    }
  });

  wssBrowser.on('connection', async (clientWs, req) => {
    console.log("WebSocket connected to /api/live-voice");
    const urlContext = (new URL(req.url || '', `http://${req.headers.host}`).searchParams.get('context') || "You are a helpful assistant.").slice(0, 4000);
    
    const captureMember = (req as any).captureMember;
    const voiceParams = new URL(req.url || '', `http://${req.headers.host}`).searchParams;
    const captureSource = { sourceProjectId: voiceParams.get('projectId') || undefined, sourceRunId: voiceParams.get('runId') || undefined, sourceNodeId: voiceParams.get('nodeId') || undefined };
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
          systemInstruction: { parts: [{ text: `${urlContext}\n${ambientCaptureInstructions}` }] },
          tools: [{ functionDeclarations: [captureWorkItemTool] }],
          speechConfig: {
             voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } }
          }
        },
        callbacks: {
          onmessage: async (msg: LiveServerMessage) => {
             for (const call of msg.toolCall?.functionCalls || []) {
               if (call.name !== 'captureWorkItem') continue;
               let response: any;
               try {
                 if (!captureMember) throw new Error('Authenticated capture context is unavailable');
                 response = await handleCapturedWork({ method: 'POST', body: { ...call.args, ...captureSource } }, captureMember);
               } catch (error: any) { response = { error: error.message, saved: false }; }
               session?.sendToolResponse({ functionResponses: [{ id: call.id, name: call.name, response }] });
             }
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
