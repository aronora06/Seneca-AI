import { Router } from "express";

export const healthRouter = Router();

healthRouter.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "seneca-api", ts: new Date().toISOString() });
});
