/**
 * Boot-time setup: load .env from the api package root.
 *
 * We use Node 20.6+'s built-in --env-file? No — Railway runs `node dist/server.js`
 * and we want a single source of truth, so we load explicitly via dotenv-like
 * code without taking a dependency. In production (Railway / Vercel), env vars
 * are already in `process.env` and this file is a no-op.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function loadDotenvIfPresent(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/bootstrap.ts → ../  is the package root in dev (tsx),
  // dist/bootstrap.js → ../ is also the package root in prod.
  const candidatePaths = [
    resolve(here, "..", ".env"),
    resolve(here, "..", "..", ".env"),
  ];

  for (const path of candidatePaths) {
    try {
      const raw = readFileSync(path, "utf8");
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq < 1) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (process.env[key] === undefined) {
          process.env[key] = value;
        }
      }
      return;
    } catch {
      // try next path
    }
  }
}

loadDotenvIfPresent();
