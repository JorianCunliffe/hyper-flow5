import express from "express";
import path from "path";
import cors from "cors";
import { Resend } from "resend";
import { createServer as createViteServer } from "vite";
import { WebSocketServer } from "ws";

import { GoogleGenAI, Type, Modality, LiveServerMessage } from "@google/genai";

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
      const { taskType, templateFile, projectData, baseUrl } = req.body;
      
      // Substitute curly braces in templateFile
      let parsedContent = templateFile || '';
      if (projectData && typeof parsedContent === 'string') {
         for (const [key, value] of Object.entries(projectData)) {
           const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
           parsedContent = parsedContent.replace(regex, String(value));
         }
      }

      let templateData: any = { body: parsedContent };
      try {
        const json = JSON.parse(parsedContent);
        if (json && typeof json === 'object') {
           templateData = json;
        }
      } catch(e) {
        // Fallback to text
      }

      const logs = [];

      if (taskType === 'send_email') {
        logs.push('--- REAL EMAIL VIA RESEND ---');
        logs.push(`Email To: ${templateData.to || 'Unknown'}`);
        logs.push(`Email Subject: ${templateData.subject || 'No Subject'}`);
        const emailBody = templateData.body || parsedContent;
        logs.push(`Email Body: ${emailBody}`);

        try {
          const resendClient = getResend();
          const data = await resendClient.emails.send({
            from: 'Acme Corp <onboarding@resend.dev>',
            to: templateData.to,
            subject: templateData.subject || 'New Communication',
            text: emailBody
          });
          logs.push(`Resend response: ${JSON.stringify(data)}`);
          
          return res.json({ 
            status: 'success', 
            output: { email_sent: true, email_data: templateData, resend_id: data.data?.id },
            logs
          });
        } catch (error: any) {
          logs.push(`Resend Error: ${error.message}`);
          return res.status(500).json({ error: error.message, logs });
        }
      } else if (taskType === 'send_sms') {
        logs.push('--- TWILIO SMS STUB ---');
        logs.push(`SMS To: ${templateData.to || 'Unknown'}`);
        logs.push(`SMS Content: ${templateData.body || parsedContent}`);
        return res.json({ 
          status: 'success', 
          output: { sms_sent: true, sms_data: templateData },
          logs
        });
      } else if (taskType === 'outgoing_call') {
        const toPhone = templateData.to || projectData?.contact_phone || projectData?.phone_number || '+61415828522'; 
        
        try {
          logs.push('--- AI VOICE CALL INITIATED (BLAND AI ULTRA-FAST) ---');
          logs.push(`Dialing ${toPhone}...`);
          
          const response = await fetch('https://api.bland.ai/v1/calls', {
            method: 'POST',
            headers: {
              'Authorization': 'org_14635a5a658c7487531e84e9b827608ce75e495ded79d57247b746ba6a876646e601f5556ba863e493f769',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              phone_number: toPhone,
              wait_for_greeting: false,
              record: true,
              answered_by_enabled: true,
              noise_cancellation: false,
              interruption_threshold: 500,
              block_interruptions: false,
              max_duration: 12,
              model: "base",
              language: "babel-en",
              background_track: "none",
              voicemail_action: "hangup",
              analysis_schema: {
                proposal_interest: "boolean: whether the user wants to proceed with the proposal",
                call_summary: "string: summary of the conversation"
              },
              task: templateData.prompt || templateData.body || parsedContent || "Hello, this is a test call."
            })
          });
          const responseData = await response.json();
          logs.push(`Bland AI Response: ${JSON.stringify(responseData)}`);

          if (!response.ok) {
              throw new Error("Bland AI failed: " + JSON.stringify(responseData));
          }
          
          return res.json({ 
            status: 'success', 
            output: responseData,
            logs
          });
        } catch (callError: any) {
          logs.push(`Call Error: ${callError.message}`);
          return res.status(500).json({ error: callError.message, logs });
        }
      } else if (taskType === 'write_report') {
        logs.push('--- REPORT WRITING MULTI-STEP GENERATION ---');
        
        const sop = templateData.sop || "Follow standard writing guidelines.";
        const template = templateData.template || "Standard Report format.";
        const evalCriteria = templateData.eval_criteria || "Does it meet the criteria?";
        const prompt = templateData.prompt || templateData.body || parsedContent || "Write a report.";

        try {
          if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");
          const ai = new GoogleGenAI({ 
            apiKey: process.env.GEMINI_API_KEY,
            httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
          });
          
          logs.push('Step 1: Generating initial draft...');
          const generateRes = await ai.models.generateContent({
            model: "gemini-3.5-flash",
            contents: `You are an expert report writer. Use the following context to write a draft report:\n\nSOP: ${sop}\n\nTemplate: ${template}\n\nPrompt: ${prompt}`
          });
          const draft = generateRes.text;

          logs.push('Step 2: Evaluating draft...');
          const evalRes = await ai.models.generateContent({
             model: "gemini-3.5-flash",
             contents: `You are an expert evaluator. Evaluate the following draft based on the criteria.\n\nCriteria: ${evalCriteria}\n\nDraft:\n${draft}`,
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  evaluation: { type: Type.STRING },
                  revisions_needed: { type: Type.ARRAY, items: { type: Type.STRING } },
                  passes_criteria: { type: Type.BOOLEAN }
                },
                required: ["evaluation", "revisions_needed", "passes_criteria"]
              }
            }
          });
          const evaluationObject = JSON.parse(evalRes.text || "{}");
          
          let finalReport = draft;
          if (!evaluationObject.passes_criteria && evaluationObject.revisions_needed?.length > 0) {
            logs.push('Step 3: Revising draft based on evaluation...');
            const reviseRes = await ai.models.generateContent({
              model: "gemini-3.5-flash",
               contents: `You are an expert reviser. Revise the following draft report according to the evaluation and revisions needed.\n\nSOP: ${sop}\n\nTemplate: ${template}\n\nPrompt: ${prompt}\n\nOriginal Draft:\n${draft}\n\nEvaluation: ${evaluationObject.evaluation}\n\nRevisions Needed:\n- ${evaluationObject.revisions_needed.join('\n- ')}\n\nProvide only the final revised complete report.`
            });
            finalReport = reviseRes.text;
          } else {
            logs.push('Step 3: Draft passed evaluation criteria without revisions.');
          }

          logs.push('Step 4: Report generation complete.');
          const reportLink = "https://example.com/docs/report_" + Date.now() + ".pdf";
          
          return res.json({ 
            status: 'success', 
            output: { 
               report_written: true,
               report_link: reportLink,
               report_content: finalReport,
               evaluation: evaluationObject
            },
            logs
          });
        } catch (e: any) {
          logs.push(`Report writing error: ${e.message}`);
          return res.status(500).json({ error: e.message, logs });
        }
      }
      
      res.json({ status: 'unknown_task_type' });
    } catch(e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.get("/api/calls/status/:call_id", async (req, res) => {
    try {
      const response = await fetch(`https://api.bland.ai/v1/calls/${req.params.call_id}`, {
        method: 'GET',
        headers: {
          'Authorization': 'org_14635a5a658c7487531e84e9b827608ce75e495ded79d57247b746ba6a876646e601f5556ba863e493f769'
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
