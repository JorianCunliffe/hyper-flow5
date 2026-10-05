/** Real component with a provider-free transport. Never touches tenant data. */
import React from "react";
import { createRoot } from "react-dom/client";
import ReceptionistsPanel from "../../components/ReceptionistsPanel";
let config: any = {
  revision: 1,
  lines: [
    {
      id: "fixture_line",
      identity: "+61400000001",
      enabled: false,
      name: "Cairns Sharehouse",
      greeting: "Hello, Cairns Sharehouse. How can I help?",
      timezone: "Australia/Brisbane",
      inboxOwner: "fixture_admin",
      projectIds: ["sharehouse"],
    },
  ],
  projects: [
    {
      projectId: "sharehouse",
      enabled: true,
      label: "Cairns Sharehouse",
      aliases: [],
      visibility: "public",
      knowledge: "Public accommodation enquiries and inspection requests.",
      historySourceProjectIds: ["sharehouse"],
      intakeOwner: "fixture_admin",
      actions: ["booking", "resume_ask"],
      booking: {
        resourceName: "diary",
        staffPersonId: "carol",
        durationMinutes: 15,
        travelMinutes: 5,
        properties: ["Martyn St", "Other St"],
        columns: {
          date: 0,
          time: 1,
          property: 2,
          attendees: 3,
          groupSize: 4,
          status: 5,
        },
      },
    },
  ],
};
const projects = [
  { id: "sharehouse", name: "Cairns Sharehouse Morning Run v2" },
];
const enquiries = [
  {
    id: "enquiry",
    name: "Test caller",
    request: "TEST ONLY inspection enquiry",
    status: "needs_review",
    updatedAt: 1,
  },
];
const transport = async (url: string, body?: any) => {
  if (url === "/api/integrations")
    return { people: [{ id: "carol", name: "Carol (fixture)" }] };
  if (url.startsWith("/api/workspace/resources"))
    return { resources: [{ name: "diary", permissions: ["read", "append"] }] };
  if (!body)
    return {
      config: structuredClone(config),
      projects,
      enquiries,
      bookingOperations: [],
      askOperations: [],
      enabled: true,
      mode: config.lines.length ? "configured" : "legacy",
    };
  if (body.operation === "prepare" || body.operation === "review_activation")
    return {
      config: body.config,
      reviewHash: "fixture_hash",
      checks: [{ name: "Fixture only — zero provider calls", ok: true }],
      effects: body.config.lines.map((l: any) => ({
        number: l.identity,
        smsEnabled: l.smsEnabled === true,
        services: l.projectIds,
      })),
    };
  if (body.operation === "preview")
    return {
      kind: body.config.lines[0]?.enabled ? "routed" : "disabled",
      publicService: "Cairns Sharehouse",
    };
  if (body.operation === "apply" || body.operation === "activate") {
    config = {
      ...structuredClone(body.config),
      revision: config.revision + 1,
      lines: body.config.lines.map((l: any) => ({
        ...l,
        enabled: body.operation === "activate" && l.enabled,
      })),
    };
    return { config };
  }
  if (body.operation === "review_enquiry") {
    enquiries[0].status = body.status;
    return { enquiry: enquiries[0] };
  }
  return { saved: true };
};
createRoot(document.getElementById("root")!).render(
  <main>
    <p className="bg-amber-100 p-3">
      Browser fixture — no production configuration, calls, messages or bookings
    </p>
    <ReceptionistsPanel transport={transport} />
  </main>,
);
