/**
 * Vitest setup for the web workspace.
 *
 * happy-dom doesn't ship Web Crypto's `randomUUID`. Several modules
 * (notably `runTurn.ts`) call `crypto.randomUUID()` at module load, so
 * we patch it onto the global before any test imports run.
 */

if (typeof globalThis.crypto === "undefined") {
  // happy-dom 14+ ships crypto already, but earlier versions don't.
  (globalThis as { crypto?: Crypto }).crypto = {} as Crypto;
}

const cryptoObj = globalThis.crypto as Crypto & {
  randomUUID?: () => string;
};

if (typeof cryptoObj.randomUUID !== "function") {
  let counter = 0;
  Object.defineProperty(cryptoObj, "randomUUID", {
    value: () => {
      counter += 1;
      const hex = counter.toString(16).padStart(12, "0");
      return `00000000-0000-4000-8000-${hex}` as `${string}-${string}-${string}-${string}-${string}`;
    },
    configurable: true,
    writable: true,
  });
}

// Stub localStorage if happy-dom hasn't already.
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, String(v));
    },
    removeItem: (k) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
}

// React 18's `act` helper expects this global to be set in any
// non-React-Native test environment. Without it, every render via
// `react-dom/client` logs "The current testing environment is not
// configured to support act(...)" — harmless but noisy.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
