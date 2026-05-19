/**
 * Phase F — /api/health and /api/ready probe tests.
 */

import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requestId } from "../middleware/requestId.js";
import { healthRouter } from "./health.js";

const app = express();
app.use(requestId);
app.use(healthRouter);

let baseUrl = "";
let serverHandle: import("node:http").Server;

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      serverHandle = app.listen(0, () => {
        const addr = serverHandle.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    }),
);

afterAll(
  () =>
    new Promise<void>((resolve, reject) => {
      serverHandle.close((err) => (err ? reject(err) : resolve()));
    }),
);

describe("GET /api/health", () => {
  it("returns ok with a request id header", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toMatch(/[0-9a-f-]+/);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, service: "seneca-api" });
  });
});

describe("GET /api/ready", () => {
  it("returns 200 with the dev-bypass checks structure", async () => {
    const res = await fetch(`${baseUrl}/api/ready`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      mode: string;
      checks: {
        anthropic: boolean;
        supabase: boolean;
        voyage: boolean;
        tavily: boolean;
        elevenlabs: boolean;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("dev-bypass");
    expect(body.checks).toMatchObject({
      anthropic: true,
      supabase: true,
    });
    expect(typeof body.checks.voyage).toBe("boolean");
    expect(typeof body.checks.tavily).toBe("boolean");
    expect(typeof body.checks.elevenlabs).toBe("boolean");
  });
});

describe("requestId middleware", () => {
  it("echoes back a client-supplied X-Request-Id", async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { "x-request-id": "test-123" },
    });
    expect(res.headers.get("x-request-id")).toBe("test-123");
  });
});
