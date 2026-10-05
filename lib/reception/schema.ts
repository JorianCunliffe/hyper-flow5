// Shared, discoverable configuration contract. Runtime validation remains authoritative.
const string = { type: "string" };
const strings = { type: "array", items: string };
const enabled = { type: "boolean" };
export const receptionProjectSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "projectId",
    "enabled",
    "label",
    "visibility",
    "intakeOwner",
    "actions",
  ],
  properties: {
    projectId: string,
    enabled,
    label: { ...string, maxLength: 100 },
    aliases: strings,
    visibility: { type: "string", enum: ["public", "recognized"] },
    knowledge: { ...string, maxLength: 12000 },
    historySourceProjectIds: strings,
    intakeOwner: string,
    actions: {
      type: "array",
      items: {
        type: "string",
        enum: ["availability", "booking", "resume_ask"],
      },
    },
    availabilityConnection: string,
    booking: {
      type: "object",
      additionalProperties: false,
      required: [
        "resourceName",
        "staffPersonId",
        "durationMinutes",
        "travelMinutes",
        "properties",
        "columns",
      ],
      properties: {
        resourceName: string,
        staffPersonId: string,
        durationMinutes: {
          type: "integer",
          minimum: 5,
          maximum: 120,
          default: 15,
        },
        travelMinutes: {
          type: "integer",
          minimum: 0,
          maximum: 120,
          default: 5,
        },
        properties: { ...strings, minItems: 1 },
        columns: {
          type: "object",
          additionalProperties: false,
          required: [
            "date",
            "time",
            "property",
            "attendees",
            "groupSize",
            "status",
          ],
          properties: Object.fromEntries(
            [
              "date",
              "time",
              "property",
              "attendees",
              "groupSize",
              "status",
            ].map((name) => [
              name,
              { type: "integer", minimum: 0, maximum: 49 },
            ]),
          ),
        },
      },
    },
  },
};
export const receptionConfigSchema = {
  type: "object",
  required: ["lines", "projects"],
  properties: {
    revision: { type: "integer", minimum: 0 },
    projects: { type: "array", maxItems: 100, items: receptionProjectSchema },
    lines: {
      type: "array",
      maxItems: 25,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "identity",
          "enabled",
          "name",
          "greeting",
          "timezone",
          "projectIds",
          "inboxOwner",
        ],
        properties: {
          id: string,
          identity: { ...string, pattern: "^\\+[1-9][0-9]{7,14}$" },
          enabled,
          smsEnabled: { type: "boolean", default: false, description: "Opt-in SMS reception on this number; requires SMS send authority." },
          name: string,
          greeting: string,
          timezone: { ...string, default: "Australia/Brisbane" },
          projectIds: strings,
          inboxOwner: string,
          hours: {
            type: "object",
            required: ["days", "start", "end"],
            properties: {
              days: {
                type: "array",
                items: { type: "integer", minimum: 0, maximum: 6 },
                minItems: 1,
              },
              start: string,
              end: string,
            },
          },
        },
      },
    },
  },
};
