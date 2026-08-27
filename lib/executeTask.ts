import { GoogleGenAI, Type } from '@google/genai';
import { Resend } from 'resend';
import { createCommunicationsClient } from './communications/client.js';
import type { CommunicationCorrelation, CommunicationResult, HyperFlowCallOverrides } from './communications/types.js';
import { safeWebhookFetch } from './safeWebhook.js';
import { normalizeTaskType, TASK_TYPES } from './taskTypes.js';
export { normalizeTaskType, TASK_TYPES } from './taskTypes.js';

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
  communicationsFromNumber?: string;
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
  } catch {
    // Fallback to text
  }
  return { parsedContent, templateData };
};

const communicationCorrelation = (ctx: ExecuteContext | undefined): CommunicationCorrelation => {
  const correlation = ctx?.correlation;
  if (!correlation?.orgId || !correlation.projectId || !correlation.nodeId || !correlation.runId) {
    throw new Error('Communications tasks require orgId, projectId, nodeId and runId correlation');
  }
  return {
    tenant_id: correlation.orgId,
    external_project_id: correlation.projectId,
    run_id: correlation.runId,
    task_id: correlation.nodeId
  };
};

const E164 = /^\+[1-9]\d{7,14}$/;

const communicationFromNumber = (
  templateData: Record<string, any>,
  projectData: Record<string, any> | undefined,
  ctx: ExecuteContext | undefined
): string => {
  const from = String(
    templateData.from || projectData?.communications_from_number || ctx?.communicationsFromNumber ||
    process.env.COMMUNICATIONS_FROM_NUMBER || ''
  ).trim();
  if (!E164.test(from)) throw new Error('A valid E.164 Communications sending number is required');
  return from;
};

const communicationCallbackUrl = (ctx: ExecuteContext | undefined): string => {
  const baseUrl = String(ctx?.webhookBaseUrl || process.env.PUBLIC_BASE_URL || '').trim();
  let parsed: URL;
  try { parsed = new URL(baseUrl); } catch { throw new Error('PUBLIC_BASE_URL must be an absolute HTTPS URL'); }
  if (parsed.protocol !== 'https:') throw new Error('PUBLIC_BASE_URL must use HTTPS for Communications callbacks');
  return `${parsed.toString().replace(/\/$/, '')}/api/events`;
};

const callOverrides = (instruction: string): HyperFlowCallOverrides => ({
  systemMessage: `You are making an outbound call for HyperFlow. Complete this instruction and stay focused on it: ${instruction}`,
  greetingText: `Begin the call briefly and then: ${instruction}`,
  aiSpeaksFirst: true,
  liveTranscript: true
});

const communicationResponse = (
  result: CommunicationResult,
  logs: string[],
  output: Record<string, unknown>
): TaskExecutionResult => {
  if (result.status === 'failed') {
    const error = result.error || 'Communications API reported a failed communication';
    logs.push(`Communication failed: ${error}`);
    return { httpStatus: 502, body: { status: 'error', error, logs } };
  }

  const completed = result.status === 'completed';
  logs.push(`Communication ${result.id} ${completed ? 'completed' : `accepted with status ${result.status}`}`);
  return {
    httpStatus: completed ? 200 : 202,
    body: {
      status: 'success',
      pending: !completed,
      externalId: result.id,
      externalExecutionId: result.id,
      externalService: 'communications',
      startedAt: Date.now(),
      output: {
        ...output,
        ...(result.output || {}),
        communication_id: result.id,
        communication_status: result.status
      },
      logs
    }
  };
};

export async function executeTask(
  rawTaskType: string,
  templateFile: string | undefined,
  projectData: Record<string, any> | undefined,
  ctx?: ExecuteContext
): Promise<TaskExecutionResult> {
  const taskType = normalizeTaskType(rawTaskType);
  if (!taskType) {
    return {
      httpStatus: 400,
      body: {
        status: 'unknown_task_type',
        error: `Unknown task type "${rawTaskType ?? ''}". Expected one of: ${TASK_TYPES.join(', ')}.`,
        logs: [`Task type "${rawTaskType ?? ''}" did not match any known action.`]
      }
    };
  }
  const { parsedContent, templateData } = substituteTemplate(templateFile, projectData);
  const logs: string[] = [];

  if (taskType === 'send_email') {
    logs.push('--- DISPATCHING EMAIL VIA RESEND ---');
    const emailBody = templateData.body || parsedContent;

    try {
      if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY environment variable is required');
      const resendClient = new Resend(process.env.RESEND_API_KEY);
      const data = await resendClient.emails.send({
        from: process.env.RESEND_FROM_EMAIL || 'HyperFlow <automation@projectflow.online>',
        to: templateData.to,
        subject: templateData.subject || 'New Communication',
        text: emailBody
      });
      if (data.error) throw new Error(data.error.message || 'Resend rejected the email');
      logs.push(`Email accepted by Resend${data.data?.id ? ` as ${data.data.id}` : ''}`);

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

    try {
      if (!smsTo) throw new Error('No destination number ("to" in template or contact_phone/phone_number in project data)');
      if (!E164.test(String(smsTo))) throw new Error('SMS destination number must use E.164 format');
      logs.push('--- DISPATCHING SMS VIA COMMUNICATIONS API ---');
      const result = await createCommunicationsClient().sendSms({
        to: String(smsTo),
        from: communicationFromNumber(templateData, projectData, ctx),
        body: String(smsBody || ''),
        correlation: communicationCorrelation(ctx),
        callback_url: communicationCallbackUrl(ctx)
      });
      return communicationResponse(result, logs, { sms_data: templateData });
    } catch (smsError: any) {
      logs.push(`Communications Error: ${smsError.message}`);
      return { httpStatus: 500, body: { status: 'error', error: smsError.message, logs } };
    }
  } else if (taskType === 'webhook') {
    try {
      const url = templateData.url;
      if (!url || typeof url !== 'string') {
        throw new Error('Webhook template must include a valid HTTPS "url"');
      }
      const method = (templateData.method || 'POST').toUpperCase();
      if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        throw new Error('Webhook method must be GET, HEAD, POST, PUT, PATCH, or DELETE');
      }
      const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(templateData.headers || {}) };
      const payload = templateData.payload !== undefined ? templateData.payload : { projectData };

      logs.push(`--- DISPATCHING ${method} WEBHOOK ---`);
      const hookRes = await safeWebhookFetch(url, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(payload)
      });
      const responseText = hookRes.text.substring(0, 2000);
      logs.push(`Webhook completed with status ${hookRes.status}`);

      let responseJson: any = null;
      try { responseJson = JSON.parse(responseText); } catch { /* not JSON */ }

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
    const toPhone = templateData.to || projectData?.contact_phone || projectData?.phone_number;

    try {
      logs.push('--- DISPATCHING VOICE CALL VIA COMMUNICATIONS API ---');

      if (!toPhone) throw new Error('No destination number ("to" in template or contact_phone/phone_number in project data)');
      if (!E164.test(String(toPhone))) throw new Error('Call destination number must use E.164 format');
      const instruction = templateData.instruction || templateData.prompt || templateData.body || parsedContent;
      if (!instruction) throw new Error('Outgoing call requires an instruction, prompt or body');

      const result = await createCommunicationsClient().startCall({
        to: String(toPhone),
        from: communicationFromNumber(templateData, projectData, ctx),
        overrides: callOverrides(String(instruction)),
        correlation: communicationCorrelation(ctx),
        callback_url: communicationCallbackUrl(ctx)
      });
      return communicationResponse(result, logs, { call_data: templateData });
    } catch (callError: any) {
      logs.push(`Communications Error: ${callError.message}`);
      return { httpStatus: 500, body: { status: 'error', error: callError.message, logs } };
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
      return {
        httpStatus: 200,
        body: {
          status: 'success',
          output: {
            report_written: true,
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

  // Unreachable: normalizeTaskType above only returns members of TASK_TYPES,
  // each of which is handled. Kept so adding a type without a branch fails loudly.
  return {
    httpStatus: 500,
    body: { status: 'unhandled_task_type', error: `Task type "${taskType}" is recognised but has no handler.` }
  };
}
