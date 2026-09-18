// Open project-context.html?view=kanban before running with agent-browser eval --stdin.
(async () => {
  const pause = () => new Promise((resolve) => setTimeout(resolve, 250));
  const results = [];
  const check = (ok, label) => {
    if (!ok) throw new Error(label);
    results.push(label);
  };
  const select = (label, value) => {
    const el = document.querySelector(`select[aria-label="${label}"]`);
    if (!el) throw new Error("Missing " + label);
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const view = async (name) => {
    const button = [...document.querySelectorAll(".hf-views button")].find(
      (b) => b.textContent.startsWith(name),
    );
    if (!button) throw new Error("Missing view " + name);
    button.click();
    await pause();
  };
  const text = () => document.querySelector("main")?.innerText || "";
  const click = (label) => {
    const button = [...document.querySelectorAll("button")].find(
      (b) => b.innerText.trim() === label,
    );
    if (!button) throw new Error("Missing " + label);
    button.click();
  };
  check(
    document.querySelectorAll(".hf-shell > div").length === 2,
    "Exactly two navigation rows",
  );
  check(
    document.querySelectorAll(".hf-views > button").length === 7,
    "Seven direct views",
  );
  check(
    !document.querySelector(
      ".hf-pins,.hf-context,.hf-section-pages,.hf-groups",
    ),
    "No old category, breadcrumb, pins or third row",
  );
  select("Project context", "alpha");
  await pause();
  check(
    text().includes("alpha review task") &&
      !text().includes("beta review task"),
    "Task board filters Alpha",
  );
  await view("Overview");
  check(
    window.contextRequests.some(
      (r) => r.includes("/api/cockpit?") && r.includes("projectId=alpha"),
    ),
    "Overview requests selected project",
  );
  select("Overview options", "approvals");
  await pause();
  click("All Pending");
  await pause();
  check(
    text().includes("alpha review task") &&
      !text().includes("beta review task"),
    "Decisions filter selected project",
  );
  await view("Work");
  select("Work options", "obligations");
  await pause();
  check(
    window.contextRequests.some(
      (r) => r.includes("/api/commitments?") && r.includes("projectId=alpha"),
    ),
    "Commitments request selected project",
  );
  await view("Communications");
  check(
    text().includes("Alpha reporting message") &&
      !text().includes("Beta delivery message"),
    "Messages filter selected project",
  );
  select("Message type", "digests");
  await pause();
  check(
    text().includes("Alpha reporting digest") &&
      !text().includes("Beta delivery digest"),
    "Digests filter selected project",
  );
  select("Message type", "runs");
  await pause();
  check(
    text().includes("Alpha reporting job") &&
      !text().includes("Beta delivery job"),
    "Operational history filters selected project",
  );
  select("Communications options", "meetings");
  await pause();
  check(
    text().includes("Alpha reporting meeting") &&
      !text().includes("Beta delivery meeting"),
    "Meetings filter selected project",
  );
  await view("Calendar");
  const calendar = document.querySelector("select:not(.hf-shell select)");
  check(
    [...document.querySelectorAll("option")].some(
      (o) => o.textContent === "Alpha reporting calendar",
    ) &&
      ![...document.querySelectorAll("option")].some(
        (o) => o.textContent === "Beta delivery calendar",
      ),
    "Calendar choices follow selected project",
  );
  await view("Documents");
  check(
    window.contextRequests.some(
      (r) => r.includes("/api/artifacts?") && r.includes("projectId=alpha"),
    ),
    "Documents request selected project",
  );
  select("Documents options", "publishing");
  await pause();
  check(
    window.contextRequests.some(
      (r) => r.includes("/api/publishing?") && r.includes("projectId=alpha"),
    ),
    "Publishing requests selected project",
  );
  await view("Automations");
  check(
    [...document.querySelectorAll("option")].some(
      (o) => o.textContent === "Alpha reporting automation",
    ) &&
      ![...document.querySelectorAll("option")].some(
        (o) => o.textContent === "Beta delivery automation",
      ),
    "Automations filter selected project",
  );
  await view("Reports");
  select("Report type", "current");
  await pause();
  check(
    text().includes("alpha review task") &&
      !text().includes("beta review task"),
    "Reports filter selected project",
  );
  select("Project context", "beta");
  await pause();
  check(
    location.search.includes("view=reports") &&
      text().includes("beta review task") &&
      !text().includes("alpha review task"),
    "Switching context preserves view and refreshes records",
  );
  select("Project context", "");
  await pause();
  check(
    text().includes("alpha review task") && text().includes("beta review task"),
    "All projects restores both projects",
  );
  await view("Work");
  check(
    document.querySelector('[aria-label="Work options"]').value ===
      "obligations",
    "Each view remembers its last option",
  );
  check(!document.querySelector("vite-error-overlay"), "No Vite error overlay");
  return results;
})();
