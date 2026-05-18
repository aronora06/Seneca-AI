import { describe, it, expect } from "vitest";

import {
  WebProxyError,
  _internals,
  extractTextFromHtml,
} from "./webProxy.js";

describe("isPrivateIPv4", () => {
  const blocked = [
    "0.0.0.0",
    "0.1.2.3",
    "10.0.0.1",
    "127.0.0.1",
    "127.1.1.1",
    "169.254.169.254", // AWS metadata
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "100.64.0.1", // CGNAT
    "224.0.0.1", // multicast
    "239.255.255.255", // multicast
    "255.255.255.255", // broadcast (also >=224)
  ];

  const allowed = [
    "8.8.8.8",
    "1.1.1.1",
    "172.15.0.1", // just below 172.16
    "172.32.0.1", // just above 172.31
    "100.63.255.255", // just below 100.64
    "100.128.0.1", // just above 100.127
    "169.253.0.1", // just below link-local
    "192.167.0.1", // just below 192.168
  ];

  it.each(blocked)("blocks private %s", (addr) => {
    expect(_internals.isPrivateIPv4(addr)).toBe(true);
  });

  it.each(allowed)("allows public %s", (addr) => {
    expect(_internals.isPrivateIPv4(addr)).toBe(false);
  });
});

describe("isPrivateIPv6", () => {
  const blocked = [
    "::",
    "::1",
    "fe80::1",
    "FE80::dead:beef",
    "fc00::1",
    "fd12:3456::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
  ];

  const allowed = ["2001:4860:4860::8888", "2606:4700:4700::1111"];

  it.each(blocked)("blocks private %s", (addr) => {
    expect(_internals.isPrivateIPv6(addr)).toBe(true);
  });

  it.each(allowed)("allows public %s", (addr) => {
    expect(_internals.isPrivateIPv6(addr)).toBe(false);
  });
});

describe("parseUrl", () => {
  it("accepts https", () => {
    expect(() => _internals.parseUrl("https://example.com/foo")).not.toThrow();
  });

  it("accepts http", () => {
    expect(() => _internals.parseUrl("http://example.com")).not.toThrow();
  });

  it("rejects file://", () => {
    expect(() => _internals.parseUrl("file:///etc/passwd")).toThrow(
      WebProxyError,
    );
  });

  it("rejects javascript: protocol", () => {
    expect(() => _internals.parseUrl("javascript:alert(1)")).toThrow(
      WebProxyError,
    );
  });

  it("rejects garbage", () => {
    expect(() => _internals.parseUrl("not a url")).toThrow(WebProxyError);
  });
});

describe("extractTextFromHtml", () => {
  it("strips script tags and their content", () => {
    const { text } = extractTextFromHtml(
      "<html><body>hello<script>alert(1)</script>world</body></html>",
    );
    expect(text).toContain("hello");
    expect(text).toContain("world");
    expect(text).not.toContain("alert");
  });

  it("collapses whitespace", () => {
    const { text } = extractTextFromHtml(
      "<p>foo     bar</p>\n\n<p>baz</p>",
    );
    expect(text).toBe("foo bar baz");
  });

  it("decodes common entities", () => {
    const { text } = extractTextFromHtml(
      "<p>Tom &amp; Jerry &lt;3</p>",
    );
    expect(text).toBe("Tom & Jerry <3");
  });

  it("truncates to max_chars and reports truncated=true", () => {
    const longHtml = "<p>" + "x".repeat(20_000) + "</p>";
    const { text, truncated } = extractTextFromHtml(longHtml, 500);
    expect(text.length).toBe(500);
    expect(truncated).toBe(true);
  });

  it("returns truncated=false when within cap", () => {
    const { text, truncated } = extractTextFromHtml("<p>short</p>", 100);
    expect(text).toBe("short");
    expect(truncated).toBe(false);
  });
});
