/**
 * Phase F — rate-limit middleware tests.
 */

import express from "express";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import { env } from "../env.js";
import { __resetRateLimitForTests, rateLimit } from "./rateLimit.js";
import { requireAuth } from "./auth.js";

const mutableEnv = env as { rateLimitTurnsPerHour: number };
const originalLimit = mutableEnv.rateLimitTurnsPerHour;

const app = express();
app.use(express.json());
app.post(
  "/api/test-chat",
  requireAuth,
  rateLimit("chat"),
  (_req, res) => {
    res.json({ ok: true });
  },
);

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

afterEach(() => {
  __resetRateLimitForTests();
  mutableEnv.rateLimitTurnsPerHour = originalLimit;
});

async function hit(): Promise<{ status: number; body: unknown; retryAfter: string | null }> {
  const res = await fetch(`${baseUrl}/api/test-chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  return {
    status: res.status,
    body: await res.json().catch(() => null),
    retryAfter: res.headers.get("retry-after"),
  };
}

describe("rateLimit middleware", () => {
  it("allows requests under the budget", async () => {
    const r1 = await hit();
    expect(r1.status).toBe(200);
  });

  it("returns 429 after the budget is exhausted", async () => {
    // The default 60/hr × 1× = 60 chat events. Force a tight
    // limit so we don't have to make 60 requests.
    mutableEnv.rateLimitTurnsPerHour = 2;

    const r1 = await hit();
    const r2 = await hit();
    const r3 = await hit();

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
    expect(r3.retryAfter).toBeTruthy();
    expect(r3.body).toMatchObject({
      code: "rate_limited",
      budget: 2,
      used: 2,
    });
  });

  it("is a no-op when env.rateLimitTurnsPerHour is 0", async () => {
    mutableEnv.rateLimitTurnsPerHour = 0;
    for (let i = 0; i < 5; i++) {
      const r = await hit();
      expect(r.status).toBe(200);
    }
  });
});
