/** The same handlers and rewrite table serve both hosts. No duplicated business routes. */
import express, { type Express } from "express";
import config from "../../vercel.json";
import gemini from "../../api/gemini/index.js";
import communications from "../../api/communications/status.js";
import triage from "../../api/triage/index.js";
import schedules from "../../api/schedules/index.js";
import advance from "../../api/flow/advance.js";
import execute from "../../api/tasks/execute.js";
import sendEmail from "../../api/send-email.js";
import createOrg from "../../api/organizations/create.js";
import createInvite from "../../api/invites/create.js";
import consumeInvite from "../../api/invites/consume.js";
import asks from "../../api/asks/[token].js";
import { POST as events } from "../../api/events.js";
const handlers: Record<string, any> = {
  "/api/gemini": gemini,
  "/api/communications/status": communications,
  "/api/triage": triage,
  "/api/schedules": schedules,
  "/api/flow/advance": advance,
  "/api/tasks/execute": execute,
  "/api/send-email": sendEmail,
  "/api/organizations/create": createOrg,
  "/api/invites/create": createInvite,
  "/api/invites/consume": consumeInvite,
  "/api/asks/:token": asks,
};
export function mountApi(app: Express) {
  // The signed Web Request handler consumes the original bytes, before any JSON parser.
  for (const [path, action] of [
    ["/api/events", ""],
    ["/api/agent/voice-context", "voice_context"],
    ["/api/agent/capture-work", "capture_work"],
  ]) {
    app.all(
      path,
      express.raw({ type: "application/json", limit: action ? "64kb" : "1mb" }),
      async (req, res, next) => {
        try {
          if (req.method !== "POST") {
            res.setHeader("Allow", "POST");
            return res.status(405).json({ error: "Method not allowed" });
          }
          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers))
            if (value !== undefined)
              headers.set(key, Array.isArray(value) ? value.join(",") : value);
          const url = new URL(req.originalUrl, "http://localhost");
          if (action) url.searchParams.set("action", action);
          const response = await events(
            new Request(url, {
              method: "POST",
              headers,
              body: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
            }),
          );
          res.status(response.status);
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.send(Buffer.from(await response.arrayBuffer()));
        } catch (e) {
          next(e);
        }
      },
    );
  }
  app.use("/api", express.json({ limit: "4mb" }));
  app.use("/forms/ask", express.json({ limit: "4mb" }));
  app.use(express.urlencoded({ extended: true, limit: "4mb" }));
  const register = (source: string, destination: string) => {
    const url = new URL(destination, "http://localhost");
    const handler = handlers[url.pathname];
    if (!handler) throw new Error("No handler for " + destination);
    app.all(source, async (req, res, next) => {
      try {
        // Express 5 query is a getter; pass an explicit request facade. Fixed rewrite selectors win.
        const query = {
          ...req.query,
          ...Object.fromEntries(url.searchParams),
          ...req.params,
        };
        const facade = {
          headers: req.headers,
          method: req.method,
          url: url.pathname,
          query,
          body: req.body,
          cookies: req.cookies,
        };
        await handler(facade, res);
      } catch (e) {
        next(e);
      }
    });
  };
  for (const rewrite of config.rewrites) {
    if (rewrite.destination.startsWith("/api/events")) continue;
    register(rewrite.source, rewrite.destination);
  }
  for (const path of Object.keys(handlers)) register(path, path);
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "API resource not found" }),
  );
  app.use((error: any, _req: any, res: any, next: any) => {
    if (res.headersSent) return next(error);
    res
      .status(error.status || 500)
      .json({
        error:
          error.status === 413
            ? "Request body is too large"
            : error.status === 400
              ? "Invalid JSON request"
              : "API request failed",
      });
  });
}
