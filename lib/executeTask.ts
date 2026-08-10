import { GoogleGenAI, Type } from '@google/genai';
import { Resend } from 'resend';

// Shared task execution logic used by the local Express server (server.ts)
// and the Vercel serverless function (api/tasks/execute.ts).

export interface TaskExecutionResult {
  httpStatus: number;
  body: any;
}

/**
 * Correlation and callback context for actions whose result arrives later via an
 * inbound webhook. When present, providers are told where to call back and are
 * given the ids needed to find this exact run again.
 */
export interface ExecuteContext {
  webhookBaseUrl?: string;
  callbackSecret?: string;
  correlation?: {
    orgId?: string;
    projectId?: string;
    nodeId?: string;
    runId?: string;
  };
  /**
   * Reviewer feedback from a previous attempt. When present this run is a redo,
   * and the feedback takes priority over the model's own self-evaluation.
   */
  revision?: {
    feedback: string;
    priorOutput?: any;
    count: number;
  };
}

const buildCallbackUrl = (ctx: ExecuteContext | undefined, path: string): string | undefined => {
  if (!ctx?.webhookBaseUrl) return undefined;
  const base = ctx.webhookBaseUrl.replace(/\/+$/, '');
  const url = new URL(`${base}${path}`);
  if (ctx.callbackSecret) url.searchParams.set('secret', ctx.callbackSecret);
  return url.toString();
};

const substituteTemplate = (templateFile: string | undefined, projectData: Record<string, any> | undefined) => {
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
  } catch (e) {
    // Fallback to text
  }
  return { parsedContent, templateData };
};

export async function executeTask(
  taskType: string,
  templateFile: string | undefined,
  projectData: Record<string, any> | undefined,
  ctx?: ExecuteContext
): Promise<TaskExecutionResult> {
  const { parsedContent, templateData } = substituteTemplate(templateFile, projectData);
  const logs: string[] = [];

  if (taskType === 'send_email') {
    logs.push('--- REAL EMAIL VIA RESEND ---');
    logs.push(`Email To: ${templateData.to || 'Unknown'}`);
    logs.push(`Email Subject: ${templateData.subject || 'No Subject'}`);
    const emailBody = templateData.body || parsedContent;
    logs.push(`Email Body: ${emailBody}`);

    try {
      if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY environment variable is required');
      const resendClient = new Resend(process.env.RESEND_API_KEY);
      const data = await resendClient.emails.send({
        from: 'Acme Corp <onboarding@resend.dev>',
        to: templateData.to,
        subject: templateData.subject || 'New Communication',
        text: emailBody
      });
      logs.push(`Resend response: ${JSON.stringify(data)}`);

      return {
        httpStatus: 200,
        body: {
          status: 'success',
          output: { email_sent: true, email_data: templateData, resend_id: data.data?.id },
          logs
        }
      };
    } catch (error: any) {
      logs.push(`Resend Error: ${error.message}`);
      return { httpStatus: 500, body: { error: error.message, logs } };
    }
  } else if (taskType === 'send_sms') {
    const smsTo = templateData.to || projectData?.contact_phone || projectData?.phone_number;
    const smsBody = templateData.body || parsedContent;
    logs.push(`SMS To: ${smsTo || 'Unknown'}`);
    logs.push(`SMS Content: ${smsBody}`);

    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;
    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER) {
      try {
        logs.push('--- SENDING SMS VIA TWILIO ---');
        if (!smsTo) throw new Error('No destination number ("to" in template or contact_phone/phone_number in project data)');
        const twilioRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
          method: 'POST',
          headers: {
            'Authorization': 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({ To: smsTo, From: TWILIO_FROM_NUMBER, Body: smsBody })
        });
        const twilioData: any = await twilioRes.json();
        if (!twilioRes.ok) throw new Error(`Twilio error ${twilioRes.status}: ${twilioData.message || JSON.stringify(twilioData)}`);
        logs.push(`Twilio SID: ${twilioData.sid}`);
        return {
          httpStatus: 200,
          body: {
            status: 'success',
            output: { sms_sent: true, sms_sid: twilioData.sid, sms_data: templateData },
            logs
          }
        };
      } catch (smsError: any) {
        logs.push(`SMS Error: ${smsError.message}`);
        return { httpStatus: 500, body: { error: smsError.message, logs } };
      }
    }

    logs.push('--- TWILIO SMS STUB (set TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER to send for real) ---');
    return {
      httpStatus: 200,
      body: {
        status: 'success',
        output: { sms_sent: true, sms_data: templateData },
        logs
      }
    };
  } else if (taskType === 'webhook') {
    try {
      const url = templateData.url;
      if (!url || !/^https?:\/\//.test(url)) {
        throw new Error('Webhook template must include a valid "url" (http/https)');
      }
      const method = (templateData.method || 'POST').toUpperCase();
      const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(templateData.headers || {}) };
      const payload = templateData.payload !== undefined ? templateData.payload : { projectData };

      logs.push(`--- WEBHOOK ${method} ${url} ---`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const hookRes = await fetch(url, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timer);

      const responseText = (await hookRes.text()).substring(0, 2000);
      logs.push(`Response status: ${hookRes.status}`);
      logs.push(`Response body: ${responseText}`);

      let responseJson: any = null;
      try { responseJson = JSON.parse(responseText); } catch (e) { /* not JSON */ }

      if (!hookRes.ok) throw new Error(`Webhook returned ${hookRes.status}`);

      return {
        httpStatus: 200,
        body: {
          status: 'success',
          output: { webhook_called: true, webhook_status: hookRes.status, webhook_response: responseJson ?? responseText },
          logs
        }
      };
    } catch (hookError: any) {
      logs.push(`Webhook Error: ${hookError.message}`);
      return { httpStatus: 500, body: { error: hookError.message, logs } };
    }
  } else if (taskType === 'outgoing_call') {
    const toPhone = templateData.to || projectData?.contact_phone || projectData?.phone_number || '+61415828522';

    try {
      logs.push('--- AI VOICE CALL INITIATED (BLAND AI ULTRA-FAST) ---');
      logs.push(`Dialing ${toPhone}...`);

      if (!process.env.BLAND_API_KEY) throw new Error('BLAND_API_KEY environment variable is required');

      // Ask Bland to call us back when the call completes, instead of relying on
      // the browser to poll. metadata comes back verbatim on the webhook payload,
      // which is how we find the run that started this call.
      const callbackUrl = buildCallbackUrl(ctx, '/api/inbound/voice/bland');
      if (callbackUrl) logs.push(`Completion webhook: ${callbackUrl.replace(/secret=[^&]+/, 'secret=***')}`);
      else logs.push('No webhook base URL configured — falling back to polling for this call.');

      const response = await fetch('https://api.bland.ai/v1/calls', {
        method: 'POST',
        headers: {
          'Authorization': process.env.BLAND_API_KEY,
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
          ...(callbackUrl ? { webhook: callbackUrl } : {}),
          ...(ctx?.correlation ? { metadata: { ...ctx.correlation, source: 'hyperflow' } } : {}),
          task: templateData.prompt || templateData.body || parsedContent || "Hello, this is a test call."
        })
      });
      const responseData: any = await response.json();
      logs.push(`Bland AI Response: ${JSON.stringify(responseData)}`);

      if (!response.ok) {
        throw new Error("Bland AI failed: " + JSON.stringify(responseData));
      }

      return {
        httpStatus: 200,
        body: {
          status: 'success',
          // The call has been placed, not completed. The orchestrator records this
          // as a pending run so the node stays incomplete until the webhook lands.
          pending: !!responseData.call_id,
          externalId: responseData.call_id,
          output: responseData,
          logs
        }
      };
    } catch (callError: any) {
      logs.push(`Call Error: ${callError.message}`);
      return { httpStatus: 500, body: { error: callError.message, logs } };
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

      // A redo carries the reviewer's own words and the draft they rejected.
      // Human feedback is stated as binding so the model does not weigh it as
      // just another suggestion against its own evaluation.
      const revision = ctx?.revision;
      const revisionBlock = revision
        ? `\n\nIMPORTANT — a human reviewer rejected the previous draft and asked for specific changes. Their feedback is binding and takes priority over your own judgement.\n\nReviewer feedback:\n${revision.feedback}\n\nThe draft they rejected:\n${
            typeof revision.priorOutput?.report_content === 'string'
              ? revision.priorOutput.report_content.slice(0, 8000)
              : '(not available)'
          }\n\nAddress every point of the feedback in the new draft.`
        : '';

      if (revision) logs.push(`Step 1: Regenerating draft — revision ${revision.count}, incorporating reviewer feedback...`);
      else logs.push('Step 1: Generating initial draft...');

      const generateRes = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `You are an expert report writer. Use the following context to write a draft report:\n\nSOP: ${sop}\n\nTemplate: ${template}\n\nPrompt: ${prompt}${revisionBlock}`
      });
      const draft = generateRes.text;

      logs.push('Step 2: Evaluating draft...');
      const evalRes = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `You are an expert evaluator. Evaluate the following draft based on the criteria.\n\nCriteria: ${evalCriteria}${
          revision
            ? `\n\nThis draft is a revision. It MUST address the reviewer's feedback below; treat failure to do so as failing the criteria.\n\nReviewer feedback:\n${revision.feedback}`
            : ''
        }\n\nDraft:\n${draft}`,
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

      return {
        httpStatus: 200,
        body: {
          status: 'success',
          output: {
            report_written: true,
            report_link: reportLink,
            report_content: finalReport,
            evaluation: evaluationObject
          },
          logs
        }
      };
    } catch (e: any) {
      logs.push(`Report writing error: ${e.message}`);
      return { httpStatus: 500, body: { error: e.message, logs } };
    }
  }

  return { httpStatus: 200, body: { status: 'unknown_task_type' } };
}
