// Real application shell with local sample data and no live provider requests.
import React from "react";
import { createRoot } from "react-dom/client";
localStorage.setItem("hyperflow_manual_disconnect", "true");
const fixtureSettings = { people: ["Reviewer"] };
const projects = ["alpha", "beta"].map((id) => ({
  id,
  name: id === "alpha" ? "Alpha reporting" : "Beta delivery",
  company: "Acceptance",
  type: "Standard",
  startDate: Date.now(),
  updatedAt: Date.now(),
  timeUnit: "days",
  timeBuffer: 0,
  milestones: [
    {
      id: `m-${id}`,
      name: `${id} milestone`,
      dependsOn: [],
      subtasks: [
        {
          id: `t-${id}`,
          name: `${id} review task`,
          status: "Submitted",
          dueDate: Date.now(),
          accountable: "Reviewer",
          assignedTo: "Reviewer",
        },
      ],
    },
  ],
}));
localStorage.setItem(
  "hyperflow_data_v1",
  JSON.stringify({
    projects,
    settings: fixtureSettings,
    scratchTasks: [],
    activityLogs: [],
  }),
);
const { firebaseService } = await import("../../services/firebaseService");
const requests: string[] = [];
Object.assign(window, { contextRequests: requests });
firebaseService.authorizedFetch = async (input, options = {}) => {
  if (options.method && options.method !== "GET")
    throw new Error("Read-only acceptance fixture");
  const url = new URL(String(input), location.origin);
  requests.push(url.pathname + url.search);
  const projectId = url.searchParams.get("projectId");
  if (url.pathname === "/api/flows")
    return Response.json({
      items: projects.map((p) => ({
        id: "flow-" + p.id,
        projectId: p.id,
        name: p.name + " automation",
      })),
      next: null,
      catalog: {},
    });
  if (url.pathname === "/api/calendar")
    return Response.json({
      projects,
      connections: [],
      items: projects.map((p) => ({
        id: "calendar-" + p.id,
        calendarId: p.name + " calendar",
        connectionId: "fixture",
        policies: [
          {
            projectId: p.id,
            timezone: "Australia/Brisbane",
            bookingEnabled: false,
            revision: 1,
          },
        ],
        proposals: [],
        observations: [],
      })),
    });
  if (url.pathname === "/api/meetings")
    return Response.json({
      data: projects.map((p) => ({
        id: "meeting-" + p.id,
        title: p.name + " meeting",
        recorded_at: new Date().toISOString(),
        metadata: {
          version: 1,
          topics: [
            {
              id: "topic-" + p.id,
              projectId: p.id,
              title: p.name,
              segments: [],
            },
          ],
        },
      })),
      next: null,
    });
  if (url.pathname === "/api/artifacts")
    return Response.json(
      projectId
        ? { items: [], templates: [], connections: [], registryRevision: 0 }
        : { projects },
    );
  if (url.pathname === "/api/publishing")
    return Response.json(
      projectId ? { items: [], targets: [], adapters: [] } : { projects },
    );
  if (url.pathname === "/api/cockpit")
    return new Response(
      JSON.stringify({
        owner: "hyperflow",
        asOf: new Date().toISOString(),
        viewerUid: "fixture",
        timezone: "Australia/Brisbane",
        items: [],
        contacts: [],
        flows: [],
        incomplete: false,
        notices: [],
        projects,
        configuration: {
          primaryPersonId: "",
          receptionistEnabled: false,
          receptionistProjectId: "",
          contactWindow: {
            startHour: 9,
            endHour: 17,
            maxPerDay: 20,
            maxPerContact: 2,
          },
        },
      }),
    );
  if (url.pathname === "/api/commitments")
    return new Response(
      JSON.stringify({ data: [], viewerUid: "fixture", next: null, projectId }),
    );
  if (url.pathname === "/api/triage")
    return Response.json({
      data: projects.map((p) => ({
        id: "triage-" + p.id,
        projectId: p.id,
        communicationId: "comm-" + p.id,
        subject: p.name + " message",
        sender: "review@example.test",
        disposition: "new",
        occurredAt: Date.now(),
        summary: "A sample project update",
      })),
      digests: projects.map((p) => ({
        id: "digest-" + p.id,
        projectId: p.id,
        summary: p.name + " digest",
        deliveryStatus: "completed",
        scheduledFor: Date.now(),
        counts: { total: 1, outstanding: 1, draftsPrepared: 0 },
      })),
    });
  if (url.pathname === "/api/operations")
    return Response.json({
      agentJobs: projects.map((p) => ({
        id: "job-" + p.id,
        communicationId: "comm-" + p.id,
        channel: "email",
        status: "pending",
        updatedAt: Date.now(),
        routing: { projectId: p.id, reason: p.name + " job" },
      })),
      coachingSessions: [],
      externalActions: [],
      schedules: [],
    });
  // Unmocked services must fail explicitly, never pretend an incompatible payload is success.
  return new Response(
    JSON.stringify({
      error: "This service is not connected in the sample-data preview.",
    }),
    { status: 503 },
  );
};
const { App } = await import("../../App");
createRoot(document.getElementById("root")!).render(<App />);
