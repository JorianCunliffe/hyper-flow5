const text = { type: "string" };
export const briefingOperations = [
  "list_tasks",
  "list_approvals",
  "subjects",
  "list_projects",
  "read_item",
  "report",
  "prepare_change",
  "confirm_change",
  "change_result",
  "changes",
  "settings",
  "readiness",
  "map_assignee",
];
export const briefingRequestSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    operation: { type: "string", enum: briefingOperations },
    subject: text,
    projectId: text,
    itemId: text,
    version: text,
    status: text,
    reportType: { type: "string", enum: ["workload", "progress", "approvals"] },
    startDate: { type: "string", format: "date" },
    endDate: { type: "string", format: "date" },
    includeClosed: { type: "boolean" },
    after: text,
    limit: { type: "integer", minimum: 1, maximum: 100 },
    action: {
      type: "string",
      enum: ["set_status", "progress", "submit", "approve", "reject"],
    },
    note: { type: "string", maxLength: 2000 },
    requestId: { type: "string", minLength: 8, maxLength: 120 },
    id: text,
    confirmed: { type: "boolean" },
    visualChecked: { type: "boolean" },
    contentChecked: { type: "boolean" },
    publicUseChecked: { type: "boolean" },
    name: text,
    userId: text,
    enabled: { type: "boolean" },
    allowTaskUpdates: { type: "boolean" },
    allowApprovals: { type: "boolean" },
    requireSmsVerification: { type: "boolean", description: "Require an SMS code on outbound coaching calls. Inbound calls always require verification." },
    sections: {
      type: "array",
      items: { type: "string", enum: ["tasks", "approvals", "reports"] },
      maxItems: 3,
      uniqueItems: true,
    },
    reportSubject: { type: "string", enum: ["me", "all"] },
    reportDays: { type: "integer", minimum: 1, maximum: 365 },
    projectIds: { type: ["array", "null"], items: text },
  },
  required: ["operation"],
};
export const briefingVoiceSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "tenant_id",
    "person_id",
    "communication_id",
    "thread_id",
    "service_identity",
    "args",
  ],
  properties: {
    tenant_id: text,
    person_id: text,
    communication_id: text,
    thread_id: text,
    service_identity: text,
    args: {
      ...briefingRequestSchema,
      properties: {
        ...briefingRequestSchema.properties,
        operation: {
          type: "string",
          enum: [
            "request_code",
            "start_briefing",
            "verify_code",
            "decide_item",
            "create_task",
            ...briefingOperations.filter(
              (o) =>
                !["settings", "map_assignee", "changes", "readiness"].includes(
                  o,
                ),
            ),
          ],
        },
        code: { type: "string", maxLength: 12 },
        title: {type:'string',maxLength:500},
        description: {type:'string',maxLength:5000},
      },
    },
    evidence: {
      type: "object",
      description:
        "Trusted media-stream evidence supplied by Communications, never model arguments",
      properties: {
        human: { type: ["object", "null"] },
        assistant: { type: ["object", "null"] },
      },
    },
  },
};
