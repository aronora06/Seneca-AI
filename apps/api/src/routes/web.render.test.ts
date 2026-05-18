/**
 * Phase E — integration tests for the hybrid `/api/web/render`
 * route. The static fetch path is stubbed at the `fetchAndSanitise`
 * boundary so we never overwrite `globalThis.fetch` (which the test
 * client itself uses to drive the route).
 */

import express from "express";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const renderPageMock = vi.hoisted(() => vi.fn());
const isHeadlessAvailableMock = vi.hoisted(() => vi.fn());
const fetchAndSanitiseMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/headlessRender.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/headlessRender.js")>(
    "../lib/headlessRender.js",
  );
  return {
    ...actual,
    renderPage: renderPageMock,
    isHeadlessAvailable: isHeadlessAvailableMock,
  };
});

vi.mock("../lib/webProxy.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/webProxy.js")>(
    "../lib/webProxy.js",
  );
  return {
    ...actual,
    fetchAndSanitise: fetchAndSanitiseMock,
  };
});

import { __resetHeadlessRateLimitForTests } from "../lib/headlessRateLimit.js";
import { HeadlessRenderError } from "../lib/headlessRender.js";
import { WebProxyError } from "../lib/webProxy.js";
import { webRouter } from "./web.js";

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(webRouter);

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

beforeEach(() => {
  __resetHeadlessRateLimitForTests();
  renderPageMock.mockReset();
  isHeadlessAvailableMock.mockReset();
  fetchAndSanitiseMock.mockReset();
});

async function api(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body, headers: res.headers };
}

function stubStaticReturn(html: string, finalUrl = "https://example.com/") {
  fetchAndSanitiseMock.mockResolvedValue({
    html,
    finalUrl,
    title: null,
    status: 200,
  });
}

describe("GET /api/web/render/config", () => {
  it("reports headless availability from the probe", async () => {
    isHeadlessAvailableMock.mockResolvedValue(true);
    const res = await api("/api/web/render/config");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ headlessAvailable: true });
  });

  it("reports false when the probe declines", async () => {
    isHeadlessAvailableMock.mockResolvedValue(false);
    const res = await api("/api/web/render/config");
    expect(res.body).toEqual({ headlessAvailable: false });
  });
});

describe("POST /api/web/render — hybrid resolver", () => {
  it("uses the static engine for content-rich pages", async () => {
    isHeadlessAvailableMock.mockResolvedValue(true);
    const body =
      "<html><body><article>" +
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(40) +
      "</article></body></html>";
    stubStaticReturn(body, "https://example.com/article");

    const res = await api("/api/web/render", {
      method: "POST",
      body: JSON.stringify({
        url: "https://example.com/article",
        sessionId: "sess-static",
      }),
    });
    expect(res.status).toBe(200);
    const json = res.body as { engine: string; static: { html: string } };
    expect(json.engine).toBe("static");
    expect(json.static.html).toContain("Lorem ipsum");
    expect(renderPageMock).not.toHaveBeenCalled();
  });

  it("falls back to headless when the sanitised body looks like a SPA shell", async () => {
    isHeadlessAvailableMock.mockResolvedValue(true);
    renderPageMock.mockResolvedValue({
      screenshot: "AAAA",
      finalUrl: "https://spa.example.com",
      title: "Live",
      links: [],
      readerText: "Hello world",
      viewport: { width: 1280, height: 800 },
    });

    const shell =
      '<html><body><div id="__next"></div><script>1</script><script>2</script><script>3</script></body></html>';
    stubStaticReturn(shell, "https://spa.example.com");

    const res = await api("/api/web/render", {
      method: "POST",
      body: JSON.stringify({
        url: "https://spa.example.com",
        sessionId: "sess-spa",
      }),
    });
    expect(res.status).toBe(200);
    const json = res.body as { engine: string; headless: { screenshot: string } };
    expect(json.engine).toBe("headless");
    expect(json.headless.screenshot).toBe("AAAA");
    expect(renderPageMock).toHaveBeenCalledTimes(1);
  });

  it("degrades to the static result when headless throws but static is available", async () => {
    isHeadlessAvailableMock.mockResolvedValue(true);
    renderPageMock.mockRejectedValue(
      new HeadlessRenderError("navigation_failed", "boom", 502),
    );
    const shell =
      '<html><body><div id="__next"></div><script>1</script><script>2</script><script>3</script></body></html>';
    stubStaticReturn(shell, "https://spa.example.com");

    const res = await api("/api/web/render", {
      method: "POST",
      body: JSON.stringify({
        url: "https://spa.example.com",
        sessionId: "sess-degraded",
      }),
    });
    expect(res.status).toBe(200);
    const json = res.body as {
      engine: string;
      headlessError?: { code: string };
    };
    expect(json.engine).toBe("static");
    expect(json.headlessError?.code).toBe("navigation_failed");
  });

  it("returns 429 with Retry-After once the per-session budget is exhausted", async () => {
    isHeadlessAvailableMock.mockResolvedValue(true);
    renderPageMock.mockResolvedValue({
      screenshot: "z",
      finalUrl: "https://x.example.com",
      title: null,
      links: [],
      readerText: "",
      viewport: { width: 1280, height: 800 },
    });

    const { tryClaimHeadlessRender } = await import(
      "../lib/headlessRateLimit.js"
    );
    for (let i = 0; i < 30; i++) tryClaimHeadlessRender("sess-burned");

    const shell =
      '<html><body><div data-reactroot></div><script>1</script><script>2</script><script>3</script></body></html>';
    stubStaticReturn(shell, "https://x.example.com");

    const res = await api("/api/web/render", {
      method: "POST",
      body: JSON.stringify({
        url: "https://x.example.com",
        sessionId: "sess-burned",
      }),
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    const json = res.body as { code: string; used: number; budget: number };
    expect(json.code).toBe("rate_limited");
    expect(json.used).toBe(30);
    expect(json.budget).toBe(30);
  });

  it("forceEngine=static bypasses the heuristic even on SPA shells", async () => {
    isHeadlessAvailableMock.mockResolvedValue(true);
    const shell =
      '<html><body><div id="__next"></div><script>1</script><script>2</script><script>3</script></body></html>';
    stubStaticReturn(shell, "https://spa.example.com");

    const res = await api("/api/web/render", {
      method: "POST",
      body: JSON.stringify({
        url: "https://spa.example.com",
        sessionId: "sess-force-static",
        forceEngine: "static",
      }),
    });
    expect(res.status).toBe(200);
    expect((res.body as { engine: string }).engine).toBe("static");
    expect(renderPageMock).not.toHaveBeenCalled();
  });

  it("surfaces a 4xx static error when both engines fail", async () => {
    isHeadlessAvailableMock.mockResolvedValue(false);
    fetchAndSanitiseMock.mockRejectedValue(
      new WebProxyError("non_html", "got JSON", 415),
    );

    const res = await api("/api/web/render", {
      method: "POST",
      body: JSON.stringify({
        url: "https://example.com/api.json",
        sessionId: "sess-non-html",
      }),
    });
    expect(res.status).toBe(415);
    expect((res.body as { code: string }).code).toBe("non_html");
  });

  it("rejects missing or non-string url with a 400", async () => {
    const res = await api("/api/web/render", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
