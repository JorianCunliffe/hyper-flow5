import React from "react";
import { createRoot } from "react-dom/client";
import { CockpitPanel } from "../../components/CockpitPanel";
import { firebaseService } from "../../services/firebaseService";
import {
  selectOperatingItems,
  answerOperatingQuestion,
} from "../../lib/cockpit/model";
const snapshot: any = {
  owner: "hyperflow",
  asOf: "2026-09-09T00:00:00Z",
  viewerUid: "ceo",
  timezone: "Australia/Brisbane",
  items: [
    {
      id: "ob_fixture",
      version: 2,
      projectId: "alpha",
      deliverable: "Prepare the weekly operating report",
      owner: "user:ceo",
      beneficiary: "contact:alex",
      dueAt: "2026-09-09T17:00:00+10:00",
      timezone: "Australia/Brisbane",
      state: "accepted",
      needsDecision: false,
      updatedAt: 1,
      sourceCommunicationIds: ["comm_fixture"],
    },
    {
      id: "ob_supplier",
      version: 1,
      projectId: "alpha",
      deliverable: "Provide the supplier update",
      owner: "contact:alex",
      beneficiary: "user:ceo",
      dueAt: "2026-09-10T17:00:00+10:00",
      timezone: "Australia/Brisbane",
      state: "accepted",
      needsDecision: false,
      updatedAt: 1,
      sourceCommunicationIds: [],
    },
  ],
  contacts: [{ id: "alex", name: "Alex Supplier" }],
  flows: [],
  incomplete: false,
  notices: [],
  projects: [{ id: "alpha", name: "Fixture project" }],
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
};
firebaseService.authorizedFetch = async (input, options = {}) => {
  const url = new URL(String(input), "http://localhost");
  const body = options.body ? JSON.parse(String(options.body)) : null;
  document.getElementById("request-log")!.textContent = JSON.stringify(body);
  return new Response(
    JSON.stringify(
      body?.operation === "question"
        ? answerOperatingQuestion(snapshot, body.question, body.party)
        : {
            ...snapshot,
            items: selectOperatingItems(
              snapshot,
              (url.searchParams.get("view") || "today") as any,
              url.searchParams.get("party") || undefined,
            ),
          },
    ),
  );
};
createRoot(document.getElementById("root")!).render(<CockpitPanel projectId={null} />);
