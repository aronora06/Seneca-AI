import { DrawIoEmbed, type DrawIoEmbedRef } from "react-drawio";
import { useCallback, useEffect, useRef, useState } from "react";

import type { DiagramsState } from "@seneca/shared";
import { EMPTY_DIAGRAM_XML } from "@seneca/shared";

import { useSenecaStore } from "../../store/seneca";
import { registerCapturer } from "../../lib/captureCanvas";
import { apiJson } from "../../lib/api";
import { useTheme } from "../../theme/ThemeProvider";
import {
  setDiagramBridge,
  type DiagramBridgeApi,
  type DiagramLayoutAlgorithm,
  type DiagramMergeResult,
} from "../../lib/diagramBridge";
import { getDrawIoEmbedBaseUrl } from "../../lib/diagramEmbedUrl";

const DEBOUNCE_MS = 600;
const COMMAND_TIMEOUT_MS = 10_000;

function dataUriToBlob(dataUri: string): Blob | null {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUri);
  if (!match) return null;
  const mime = match[1]!;
  const b64 = match[2]!;
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Snapshot store once on mount — same pattern as WhiteboardTab to avoid
 * iframe reload loops when Zustand updates on every autosave.
 */
export function DiagramsTab() {
  const sessionId = useSenecaStore((s) => s.session.id);
  const setDiagrams = useSenecaStore((s) => s.setDiagrams);
  const { resolved } = useTheme();

  const [initialXml] = useState(() => {
    const d = useSenecaStore.getState().diagrams;
    const xml = d?.xml?.trim() ? d.xml : EMPTY_DIAGRAM_XML;
    return xml;
  });

  const embedRef = useRef<DrawIoEmbedRef | null>(null);
  const readyRef = useRef(false);
  const latestXmlRef = useRef<string>(initialXml);
  const saveTimer = useRef<number | null>(null);
  const lastSavedXml = useRef<string>("");
  const saveAbortRef = useRef<AbortController | null>(null);
  const pendingLoad = useRef<{
    resolve: () => void;
    reject: (e: Error) => void;
  } | null>(null);
  const pendingMerge = useRef<{
    resolve: (r: DiagramMergeResult) => void;
    reject: (e: Error) => void;
  } | null>(null);
  const pendingExport = useRef<{
    resolve: (b: Blob | null) => void;
    reject: (e: Error) => void;
  } | null>(null);
  const pendingLayout = useRef<{
    resolve: () => void;
    reject: (e: Error) => void;
  } | null>(null);

  const [loadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const persist = useCallback(
    (state: DiagramsState) => {
      if (!sessionId) return;
      if (state.xml === lastSavedXml.current) return;
      lastSavedXml.current = state.xml;
      saveAbortRef.current?.abort();
      const controller = new AbortController();
      saveAbortRef.current = controller;
      setSaving(true);
      apiJson(`/api/sessions/${sessionId}/diagrams`, {
        method: "PUT",
        body: state,
        signal: controller.signal,
      })
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          console.warn("[seneca] diagrams save failed", err);
        })
        .finally(() => {
          if (saveAbortRef.current === controller) {
            saveAbortRef.current = null;
            setSaving(false);
          }
        });
    },
    [sessionId],
  );

  const rememberXml = useCallback((xml: string) => {
    latestXmlRef.current = xml;
  }, []);

  const schedulePersist = useCallback(
    (xml: string) => {
      rememberXml(xml);
      const next: DiagramsState = { xml };
      setDiagrams(next);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        persist(next);
      }, DEBOUNCE_MS);
    },
    [persist, setDiagrams, rememberXml],
  );

  const runLayout = useCallback(
    (algorithm: DiagramLayoutAlgorithm) => {
      return new Promise<void>((resolve, reject) => {
        const ref = embedRef.current;
        if (!ref || !readyRef.current) {
          reject(new Error("Diagram editor is not ready."));
          return;
        }
        if (pendingLayout.current) {
          pendingLayout.current.reject(new Error("Diagram layout superseded."));
        }
        const timer = window.setTimeout(() => {
          if (pendingLayout.current) {
            pendingLayout.current.reject(new Error("Diagram layout timed out."));
            pendingLayout.current = null;
          }
        }, COMMAND_TIMEOUT_MS);
        pendingLayout.current = {
          resolve: () => {
            window.clearTimeout(timer);
            pendingLayout.current = null;
            resolve();
          },
          reject: (e) => {
            window.clearTimeout(timer);
            pendingLayout.current = null;
            reject(e);
          },
        };
        ref.layout({ layouts: [algorithm] });
      });
    },
    [],
  );

  const runLoad = useCallback(
    (payload: {
      xml?: string;
      descriptor?: { format: "mermaid"; data: string };
    }) => {
      return new Promise<void>((resolve, reject) => {
        const ref = embedRef.current;
        if (!ref || !readyRef.current) {
          reject(new Error("Diagram editor is not ready."));
          return;
        }
        if (pendingLoad.current) {
          pendingLoad.current.reject(new Error("Diagram load superseded."));
        }
        const timer = window.setTimeout(() => {
          if (pendingLoad.current) {
            pendingLoad.current.reject(new Error("Diagram load timed out."));
            pendingLoad.current = null;
          }
        }, COMMAND_TIMEOUT_MS);
        pendingLoad.current = {
          resolve: () => {
            window.clearTimeout(timer);
            pendingLoad.current = null;
            resolve();
          },
          reject: (e) => {
            window.clearTimeout(timer);
            pendingLoad.current = null;
            reject(e);
          },
        };
        ref.load({
          autosave: true,
          ...(payload.xml != null ? { xml: payload.xml } : {}),
          ...(payload.descriptor ? { descriptor: payload.descriptor } : {}),
        } as Parameters<DrawIoEmbedRef["load"]>[0]);
      });
    },
    [],
  );

  const exportPngInternal = useCallback((): Promise<Blob | null> => {
    return new Promise<Blob | null>((resolve, reject) => {
      const ref = embedRef.current;
      if (!ref || !readyRef.current) {
        reject(new Error("Diagram editor is not ready."));
        return;
      }
      if (pendingExport.current) {
        pendingExport.current.reject(new Error("Diagram export superseded."));
      }
      const timer = window.setTimeout(() => {
        if (pendingExport.current) {
          pendingExport.current.reject(new Error("Diagram export timed out."));
          pendingExport.current = null;
        }
      }, COMMAND_TIMEOUT_MS);
      pendingExport.current = {
        resolve: (b) => {
          window.clearTimeout(timer);
          pendingExport.current = null;
          resolve(b);
        },
        reject: (e) => {
          window.clearTimeout(timer);
          pendingExport.current = null;
          reject(e);
        },
      };
      ref.exportDiagram({
        format: "png",
        keepTheme: true,
        scale: 1,
      });
    });
  }, []);

  useEffect(() => {
    const api: DiagramBridgeApi = {
      isReady: () => readyRef.current && embedRef.current != null,
      getLiveXml: () => latestXmlRef.current,
      loadXml: (xml) => runLoad({ xml }),
      loadMermaid: (data) =>
        runLoad({
          descriptor: { format: "mermaid", data },
        }),
      mergeXml: (xml) =>
        new Promise<DiagramMergeResult>((resolve, reject) => {
          const ref = embedRef.current;
          if (!ref || !readyRef.current) {
            reject(new Error("Diagram editor is not ready."));
            return;
          }
          if (pendingMerge.current) {
            pendingMerge.current.reject(new Error("Diagram merge superseded."));
          }
          const timer = window.setTimeout(() => {
            if (pendingMerge.current) {
              pendingMerge.current.reject(new Error("Diagram merge timed out."));
              pendingMerge.current = null;
            }
          }, COMMAND_TIMEOUT_MS);
          pendingMerge.current = {
            resolve: (r) => {
              window.clearTimeout(timer);
              pendingMerge.current = null;
              resolve(r);
            },
            reject: (e) => {
              window.clearTimeout(timer);
              pendingMerge.current = null;
              reject(e);
            },
          };
          ref.merge({ xml });
        }),
      clear: () => runLoad({ xml: EMPTY_DIAGRAM_XML }),
      layout: runLayout,
      exportPng: exportPngInternal,
    };
    setDiagramBridge(api);
    return () => setDiagramBridge(null);
  }, [runLoad, exportPngInternal, runLayout]);

  useEffect(() => {
    return registerCapturer("diagrams", () => exportPngInternal());
  }, [exportPngInternal]);

  const handleLoad = useCallback(
    (data: { xml: string }) => {
      readyRef.current = true;
      schedulePersist(data.xml);
      pendingLoad.current?.resolve();
    },
    [schedulePersist],
  );

  const handleAutoSave = useCallback(
    (data: { xml: string }) => {
      schedulePersist(data.xml);
      pendingLayout.current?.resolve();
    },
    [schedulePersist],
  );

  const handleMerge = useCallback((data: { error?: string | null }) => {
    const err = data.error;
    const result: DiagramMergeResult =
      err == null || err === ""
        ? { merged: true }
        : { merged: false, error: String(err) };
    pendingMerge.current?.resolve(result);
  }, []);

  const handleExport = useCallback((data: { data: string }) => {
    const blob = dataUriToBlob(data.data);
    pendingExport.current?.resolve(blob);
  }, []);

  return (
    <DiagramShell saving={saving} error={loadError}>
      <DrawIoEmbed
        ref={embedRef}
        autosave
        baseUrl={getDrawIoEmbedBaseUrl()}
        xml={initialXml}
        urlParameters={{
          ui: "min",
          dark: resolved === "dark",
          spin: true,
          libraries: true,
          noSaveBtn: true,
          noExitBtn: true,
          saveAndExit: false,
        }}
        onLoad={handleLoad}
        onAutoSave={handleAutoSave}
        onMerge={handleMerge}
        onExport={handleExport}
      />
    </DiagramShell>
  );
}

function DiagramShell({
  children,
  saving,
  error,
}: {
  children: React.ReactNode;
  saving: boolean;
  error: string | null;
}) {
  return (
    <div className="relative h-full w-full bg-surface">
      {error && (
        <div
          role="alert"
          className="absolute inset-x-0 top-0 z-10 bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          {error}
        </div>
      )}
      <div className="absolute inset-0">{children}</div>
      {saving && (
        <div
          className="pointer-events-none absolute bottom-2 right-3 text-[10px] text-fg-subtle"
          aria-live="polite"
        >
          Saving…
        </div>
      )}
    </div>
  );
}
