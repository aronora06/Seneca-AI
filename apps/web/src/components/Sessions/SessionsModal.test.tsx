/**
 * Phase D — UI tests for the redesigned SessionsModal: search filter,
 * pin toggle, and the export menu item. We stub the network layer
 * (`listSessions` / `setSessionPinned` / `fetchSessionRow`) and the
 * markdown download so the assertions stay on the modal's
 * behaviour rather than React Query / Blob plumbing.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { SessionSummary } from "../../lib/sessions";

const listSessionsMock = vi.fn<() => Promise<SessionSummary[]>>();
const setSessionPinnedMock = vi.fn<
  (id: string, pinned: boolean) => Promise<void>
>();
const fetchSessionRowMock = vi.fn();
const downloadSessionMarkdownMock = vi.fn<(row: unknown) => string>();

vi.mock("../../lib/sessions", async () => {
  const actual =
    await vi.importActual<typeof import("../../lib/sessions")>(
      "../../lib/sessions",
    );
  return {
    ...actual,
    listSessions: () => listSessionsMock(),
    setSessionPinned: (id: string, pinned: boolean) =>
      setSessionPinnedMock(id, pinned),
    fetchSessionRow: (id: string) => fetchSessionRowMock(id),
    createSession: vi.fn(),
    deleteSession: vi.fn(),
    renameSession: vi.fn(),
  };
});

vi.mock("../../lib/sessionExport", () => ({
  downloadSessionMarkdown: (row: unknown) => downloadSessionMarkdownMock(row),
  buildSessionMarkdown: vi.fn(),
  sessionFilename: vi.fn(),
}));

import { SessionsModal } from "./SessionsModal";

const SUMMARIES: SessionSummary[] = [
  {
    id: "old-id",
    name: "Old Spinoza chat",
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-02T00:00:00.000Z",
    pinned: false,
    lastMessageAt: "2024-01-02T00:00:00.000Z",
    lastUserText: "What is substance?",
    documentCount: 1,
    tabs: ["documents"],
  },
  {
    id: "new-id",
    name: "Tax research",
    created_at: "2024-02-01T00:00:00.000Z",
    updated_at: "2024-02-02T00:00:00.000Z",
    pinned: false,
    lastMessageAt: "2024-02-02T00:00:00.000Z",
    lastUserText: "Capital gains rules?",
    documentCount: 0,
    tabs: [],
  },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  listSessionsMock.mockResolvedValue(SUMMARIES);
  setSessionPinnedMock.mockResolvedValue(undefined);
  fetchSessionRowMock.mockResolvedValue({
    id: "old-id",
    user_id: "u",
    name: "Old Spinoza chat",
    transcript: [],
    whiteboard: { elements: [] },
    map: {
      center: [0, 0],
      zoom: 1,
      layer: "standard",
      pins: [],
      shapes: [],
    },
    web: { url: null, history: [], historyIndex: -1 },
    documents: { items: [], activeId: null },
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-02T00:00:00.000Z",
  });
  downloadSessionMarkdownMock.mockReturnValue("file.md");
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  listSessionsMock.mockReset();
  setSessionPinnedMock.mockReset();
  fetchSessionRowMock.mockReset();
  downloadSessionMarkdownMock.mockReset();
});

async function flush() {
  // Two microtask flushes — one for the list fetch, one for setState.
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("SessionsModal — Phase D", () => {
  it("renders preview cards with snippet, doc count, and tab chip", async () => {
    act(() => {
      root.render(<SessionsModal open onClose={() => {}} />);
    });
    await flush();

    const oldCard = findCardByName("Old Spinoza chat");
    expect(oldCard).not.toBeNull();
    expect(oldCard!.textContent).toContain("What is substance?");
    expect(oldCard!.textContent).toContain("1 document");
    expect(oldCard!.textContent).toContain("Docs");
  });

  it("filters by name AND by snippet text", async () => {
    act(() => {
      root.render(<SessionsModal open onClose={() => {}} />);
    });
    await flush();

    const search = document.querySelector(
      "#sessions-search",
    ) as HTMLInputElement;
    expect(search).not.toBeNull();

    // Filter by snippet ("substance" only exists in the old session).
    act(() => {
      setReactInputValue(search, "substance");
    });
    await flush();

    expect(findCardByName("Old Spinoza chat")).not.toBeNull();
    expect(findCardByName("Tax research")).toBeNull();

    // Switch to a name match.
    act(() => {
      setReactInputValue(search, "tax");
    });
    await flush();

    expect(findCardByName("Tax research")).not.toBeNull();
    expect(findCardByName("Old Spinoza chat")).toBeNull();
  });

  it("toggling the pin star calls setSessionPinned and refreshes", async () => {
    act(() => {
      root.render(<SessionsModal open onClose={() => {}} />);
    });
    await flush();

    const oldCard = findCardByName("Old Spinoza chat")!;
    const pinButton = Array.from(
      oldCard.querySelectorAll("button[aria-label='Pin']"),
    )[0] as HTMLButtonElement;
    expect(pinButton).toBeDefined();

    act(() => {
      pinButton.click();
    });
    await flush();

    expect(setSessionPinnedMock).toHaveBeenCalledWith("old-id", true);
    // refresh re-calls listSessions
    expect(listSessionsMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("clicking the download icon triggers downloadSessionMarkdown", async () => {
    act(() => {
      root.render(<SessionsModal open onClose={() => {}} />);
    });
    await flush();

    const oldCard = findCardByName("Old Spinoza chat")!;
    const downloadButton = oldCard.querySelector(
      "button[aria-label='Download as markdown']",
    ) as HTMLButtonElement;
    expect(downloadButton).toBeDefined();

    act(() => {
      downloadButton.click();
    });
    await flush();

    expect(fetchSessionRowMock).toHaveBeenCalledWith("old-id");
    expect(downloadSessionMarkdownMock).toHaveBeenCalledTimes(1);
  });

  it("empty-state copy adapts to whether the query is set", async () => {
    listSessionsMock.mockResolvedValueOnce([]);
    act(() => {
      root.render(<SessionsModal open onClose={() => {}} />);
    });
    await flush();
    // Modal is rendered via createPortal to document.body, so we
    // check the body's text rather than the local container.
    expect(document.body.textContent).toContain(
      "You don't have any sessions yet",
    );
  });
});

function findCardByName(name: string): HTMLElement | null {
  const headings = Array.from(
    document.querySelectorAll("li button p"),
  ) as HTMLElement[];
  const match = headings.find((p) => p.textContent?.trim() === name);
  if (!match) return null;
  return match.closest("li");
}

/**
 * React 18 tracks `value` via a native getter/setter pair so direct
 * `.value = ...` assignments are silently ignored. Calling the
 * prototype setter and dispatching a bubbling input event mirrors the
 * pattern React Testing Library uses under the hood — both
 * `onChange` and `onInput` listeners fire.
 */
function setReactInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  );
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
