import { describe, it, expect } from "vitest";
import { Buffer } from "node:buffer";

import { documentStore, looksLikePdf } from "./documentStorage.js";

describe("looksLikePdf", () => {
  it("accepts a real PDF magic header", () => {
    const buf = Buffer.from("%PDF-1.7\nrest of pdf");
    expect(looksLikePdf(buf)).toBe(true);
  });

  it("rejects empty buffers", () => {
    expect(looksLikePdf(Buffer.alloc(0))).toBe(false);
  });

  it("rejects buffers shorter than the magic", () => {
    expect(looksLikePdf(Buffer.from("%PD"))).toBe(false);
  });

  it("rejects HTML pretending to be a PDF", () => {
    expect(looksLikePdf(Buffer.from("<!doctype html>..."))).toBe(false);
  });

  it("rejects PNG", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(looksLikePdf(png)).toBe(false);
  });

  it("is case-sensitive on the magic bytes", () => {
    expect(looksLikePdf(Buffer.from("%pdf-1.7"))).toBe(false);
  });
});

describe("documentStore memory implementation", () => {
  // In tests env DEV_BYPASS_AUTH=true is set in test/setup.ts so this
  // exports the memory store.
  const u1 = "user-a";
  const u2 = "user-b";
  const s1 = "session-1";
  const s2 = "session-2";

  it("round-trips bytes for a single user / session", async () => {
    const payload = Buffer.from("%PDF-1.7\nhello");
    await documentStore.put(u1, s1, "doc-1", payload, "application/pdf");

    const fetched = await documentStore.get(u1, s1, "doc-1");
    expect(fetched).not.toBeNull();
    expect(fetched!.bytes.equals(payload)).toBe(true);
    expect(fetched!.contentType).toBe("application/pdf");
  });

  it("returns null for unknown doc ids", async () => {
    const got = await documentStore.get(u1, s1, "does-not-exist");
    expect(got).toBeNull();
  });

  it("isolates docs across users", async () => {
    await documentStore.put(u1, s1, "doc-iso", Buffer.from("a"), "application/pdf");
    const wrongUser = await documentStore.get(u2, s1, "doc-iso");
    expect(wrongUser).toBeNull();
  });

  it("isolates docs across sessions for the same user", async () => {
    await documentStore.put(u1, s1, "doc-cross", Buffer.from("a"), "application/pdf");
    const wrongSession = await documentStore.get(u1, s2, "doc-cross");
    expect(wrongSession).toBeNull();
  });

  it("delete removes a doc and is idempotent", async () => {
    await documentStore.put(u1, s1, "doc-del", Buffer.from("a"), "application/pdf");
    await documentStore.delete(u1, s1, "doc-del");
    expect(await documentStore.get(u1, s1, "doc-del")).toBeNull();
    // second delete is a no-op
    await expect(documentStore.delete(u1, s1, "doc-del")).resolves.not.toThrow();
  });

  it("deleteForSession wipes every doc under the session prefix", async () => {
    await documentStore.put(u1, s1, "doc-x", Buffer.from("x"), "application/pdf");
    await documentStore.put(u1, s1, "doc-y", Buffer.from("y"), "application/pdf");
    await documentStore.put(u1, s2, "doc-z", Buffer.from("z"), "application/pdf");
    await documentStore.deleteForSession(u1, s1);
    expect(await documentStore.get(u1, s1, "doc-x")).toBeNull();
    expect(await documentStore.get(u1, s1, "doc-y")).toBeNull();
    // Sibling session for the same user is untouched.
    expect(await documentStore.get(u1, s2, "doc-z")).not.toBeNull();
  });

  it("deleteForSession isolates by user", async () => {
    await documentStore.put(u1, s1, "doc-self", Buffer.from("a"), "application/pdf");
    await documentStore.put(u2, s1, "doc-them", Buffer.from("b"), "application/pdf");
    await documentStore.deleteForSession(u1, s1);
    // Calling user's row gone; other user's row untouched.
    expect(await documentStore.get(u1, s1, "doc-self")).toBeNull();
    expect(await documentStore.get(u2, s1, "doc-them")).not.toBeNull();
  });
});
