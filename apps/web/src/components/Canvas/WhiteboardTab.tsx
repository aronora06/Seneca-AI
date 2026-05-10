import { Excalidraw, exportToBlob } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSenecaStore } from "../../store/seneca";
import { setWhiteboardApi } from "../../lib/whiteboardBridge";
import { registerCapturer } from "../../lib/captureCanvas";
import { apiJson } from "../../lib/api";
import { useTheme } from "../../theme/ThemeProvider";
import type { WhiteboardState } from "@seneca/shared";

const DEBOUNCE_MS = 600;

/**
 * IMPORTANT: this component intentionally does NOT subscribe to
 * `state.whiteboard`. Reading it via a selector creates an update loop
 * with Excalidraw's `onChange`:
 *
 *   onChange → setWhiteboard(scene) → store update → selector fires →
 *   initialData prop identity changes → Excalidraw setState in cleanup →
 *   "Maximum update depth exceeded".
 *
 * Instead we snapshot the store ONCE on mount (`useState` initializer),
 * pass that as initialData, and only write back via the store actions.
 * The CanvasContainer is responsible for mounting this component only
 * after the session has loaded so the snapshot is meaningful.
 */
export function WhiteboardTab() {
  const sessionId = useSenecaStore((s) => s.session.id);
  const setWhiteboard = useSenecaStore((s) => s.setWhiteboard);
  const { resolved } = useTheme();

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const saveTimer = useRef<number | null>(null);
  const lastSavedJson = useRef<string>("");

  // Read once. Excalidraw owns the live state from here on.
  const [initialData] = useState(() => {
    const initial = useSenecaStore.getState().whiteboard;
    const bg = whiteboardBgFor(resolved);
    if (!initial || !Array.isArray(initial.elements)) {
      return {
        elements: [],
        appState: { viewBackgroundColor: bg, theme: resolved },
      };
    }
    return {
      elements: initial.elements as OrderedExcalidrawElement[],
      appState: {
        ...(initial.appState ?? {}),
        viewBackgroundColor: bg,
        theme: resolved,
      } as Partial<AppState>,
      files: (initial.files ?? {}) as BinaryFiles,
    };
  });

  // When the theme changes, mirror it into Excalidraw via updateScene.
  // Excalidraw's `theme` prop is a controlled API, but updateScene also
  // accepts `appState.theme` and updates seamlessly without a remount.
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.updateScene({
      appState: {
        theme: resolved,
        viewBackgroundColor: whiteboardBgFor(resolved),
      },
    } as Parameters<ExcalidrawImperativeAPI["updateScene"]>[0]);
  }, [resolved]);

  // Register PNG capturer for the vision pipeline.
  useEffect(() => {
    const unregister = registerCapturer("whiteboard", async () => {
      const api = apiRef.current;
      if (!api) return null;
      const elements = api.getSceneElements();
      const appState = api.getAppState();
      const files = api.getFiles();
      const blob = await exportToBlob({
        elements,
        appState: {
          ...appState,
          exportBackground: true,
          viewBackgroundColor: whiteboardBgFor(resolved),
        },
        files,
        mimeType: "image/png",
      });
      return blob;
    });
    return unregister;
  }, [resolved]);

  const persist = useCallback(
    (scene: WhiteboardState) => {
      if (!sessionId) return;
      const next = JSON.stringify(scene.elements);
      if (next === lastSavedJson.current) return;
      lastSavedJson.current = next;
      apiJson(`/api/sessions/${sessionId}/whiteboard`, {
        method: "PUT",
        body: scene,
      }).catch((err) => {
        console.warn("[seneca] whiteboard save failed", err);
      });
    },
    [sessionId],
  );

  const onChange = useCallback(
    (
      elements: readonly OrderedExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
    ) => {
      const next: WhiteboardState = {
        elements: [...elements] as unknown[],
        appState: snapshotAppState(appState),
        files: files as unknown as Record<string, unknown>,
      };
      setWhiteboard(next);

      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        persist(next);
      }, DEBOUNCE_MS);
    },
    [persist, setWhiteboard],
  );

  // Memoized so React doesn't re-create the options object on every render.
  const uiOptions = useMemo(
    () =>
      ({
        canvasActions: {
          toggleTheme: false,
          export: false as const,
          saveAsImage: false,
          loadScene: false,
        },
      }) as Parameters<typeof Excalidraw>[0]["UIOptions"],
    [],
  );

  return (
    <div className="excalidraw-host">
      <Excalidraw
        initialData={initialData}
        theme={resolved}
        excalidrawAPI={(api) => {
          apiRef.current = api;
          setWhiteboardApi(api);
        }}
        onChange={onChange}
        UIOptions={uiOptions}
      />
    </div>
  );
}

function whiteboardBgFor(theme: "light" | "dark"): string {
  // Hardcoded so PNG exports stay readable regardless of which app theme
  // captured the snapshot. Tracks the surface tokens defined in index.css.
  return theme === "dark" ? "#0e0a06" : "#f8f6f1";
}

/**
 * Keep only serializable, persistence-relevant AppState bits.
 * Excalidraw stuffs a lot of transient runtime state in here that we don't
 * want to round-trip through Postgres.
 */
function snapshotAppState(s: AppState): Record<string, unknown> {
  return {
    viewBackgroundColor: s.viewBackgroundColor,
    gridSize: s.gridSize,
    zoom: s.zoom?.value,
    scrollX: s.scrollX,
    scrollY: s.scrollY,
  };
}
