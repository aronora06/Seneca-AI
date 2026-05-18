/**
 * Documents tab. Renders an uploaded PDF using react-pdf, owns the
 * sidebar / toolbar state, exposes a `DocumentApi` via the bridge so
 * Seneca can flip pages or switch documents.
 *
 * Mirrors WebTab / MapTab in shape:
 *   - snapshot store ONCE on mount; mutate via the bridge.
 *   - register a capturer for the vision pipeline.
 *   - debounced PUT for metadata persistence (only the lightweight
 *     `documents` JSONB; raw PDF bytes go through a separate POST).
 *
 * Bytes are cached per-document in a Map ref so switching back to a
 * previously-viewed PDF is instant. The cache is local to this component
 * instance — when the session changes the whole tree remounts and the
 * cache resets with it.
 */

import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import type {
  DocumentPageText,
  DocumentRecord,
  DocumentsState,
} from "@seneca/shared";

import { ApiError, apiFetchBytes, apiJson, apiUploadBytes } from "../../lib/api";
import { registerCapturer } from "../../lib/captureCanvas";
import {
  getDocumentApi,
  setDocumentApi,
  type DocumentApi,
} from "../../lib/documentBridge";
import { useSenecaStore } from "../../store/seneca";
import { DocumentDropZone } from "./DocumentDropZone";
import { DocumentSidebar } from "./DocumentSidebar";
import { DocumentToolbar } from "./DocumentToolbar";
import { MarkdownViewer } from "./MarkdownViewer";

// One-time worker bootstrap. Pinned to the same version of pdfjs-dist
// react-pdf bundles internally — mismatching versions throw "API/Worker
// version mismatch" at first parse.
pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

const PERSIST_DEBOUNCE_MS = 600;

interface UploadResponse {
  document: DocumentRecord;
  documents: DocumentsState;
}

interface DeleteResponse {
  documents: DocumentsState;
}

export function DocumentTab() {
  const sessionId = useSenecaStore((s) => s.session.id);
  const setDocumentsStore = useSenecaStore((s) => s.setDocuments);

  const [stateSnapshot] = useState<DocumentsState>(() => {
    const initial = useSenecaStore.getState().documentsState;
    return initial ?? { items: [], activeId: null };
  });
  const stateRef = useRef<DocumentsState>(stateSnapshot);

  const [items, setItems] = useState<DocumentRecord[]>(stateSnapshot.items);
  const [activeId, setActiveId] = useState<string | null>(
    stateSnapshot.activeId,
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageCanvasHostRef = useRef<HTMLDivElement | null>(null);
  const saveTimer = useRef<number | null>(null);
  const lastSavedJson = useRef<string>(JSON.stringify(stateSnapshot));
  const fetchAbortRef = useRef<AbortController | null>(null);

  // docId -> bytes. Lazy: filled on first view.
  const bytesCache = useRef<Map<string, Uint8Array>>(new Map());
  // docId -> extracted page text. Used by non-PDF (markdown / html)
  // viewers. Same lazy-load + per-mount cache shape as bytesCache.
  const pagesCache = useRef<Map<string, DocumentPageText[]>>(new Map());

  const [bytesLoading, setBytesLoading] = useState(false);
  const [bytesError, setBytesError] = useState<string | null>(null);
  const [activeBytes, setActiveBytes] = useState<Uint8Array | null>(null);
  const [activePages, setActivePages] = useState<DocumentPageText[] | null>(
    null,
  );
  const [pagesError, setPagesError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Pending page change requested while a doc was still loading; applied
  // once onLoadSuccess fires and we know the real page count.
  const pendingPageRef = useRef<{ docId: string; page: number } | null>(null);

  const activeDoc = useMemo(
    () => items.find((d) => d.id === activeId) ?? null,
    [items, activeId],
  );

  // ── persistence ────────────────────────────────────────────────────────────

  const schedulePersist = useCallback(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const sid = useSenecaStore.getState().session.id;
      if (!sid) return;
      const json = JSON.stringify(stateRef.current);
      if (json === lastSavedJson.current) return;
      lastSavedJson.current = json;
      apiJson(`/api/sessions/${sid}/documents`, {
        method: "PUT",
        body: stateRef.current,
      }).catch((err) => {
        console.warn("[seneca] documents save failed", err);
      });
    }, PERSIST_DEBOUNCE_MS);
  }, []);

  /**
   * Mutate state via this single channel so the ref, the React state, the
   * Zustand mirror, and the persistence timer all stay in sync. Avoids the
   * three-way drift bug we hit with the map/web tabs early on.
   */
  const commit = useCallback(
    (next: DocumentsState, opts: { persist?: boolean } = {}) => {
      stateRef.current = next;
      setItems(next.items);
      setActiveId(next.activeId);
      setDocumentsStore(next);
      if (opts.persist !== false) schedulePersist();
    },
    [schedulePersist, setDocumentsStore],
  );

  // ── byte loading for the active doc ────────────────────────────────────────

  const loadBytesFor = useCallback(
    async (docId: string) => {
      const sid = useSenecaStore.getState().session.id;
      if (!sid) return;
      const cached = bytesCache.current.get(docId);
      if (cached) {
        setActiveBytes(cached);
        setBytesError(null);
        return;
      }

      fetchAbortRef.current?.abort();
      const controller = new AbortController();
      fetchAbortRef.current = controller;

      setBytesLoading(true);
      setBytesError(null);
      setActiveBytes(null);
      try {
        const bytes = await apiFetchBytes(
          `/api/sessions/${sid}/documents/${docId}/bytes`,
          { signal: controller.signal },
        );
        bytesCache.current.set(docId, bytes);
        // Only adopt these bytes if we still want this doc.
        if (stateRef.current.activeId === docId) {
          setActiveBytes(bytes);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const msg = err instanceof Error ? err.message : String(err);
        setBytesError(`Couldn’t load this document. ${msg}`);
      } finally {
        if (fetchAbortRef.current === controller) fetchAbortRef.current = null;
        setBytesLoading(false);
      }
    },
    [],
  );

  const loadPagesFor = useCallback(async (docId: string) => {
    const sid = useSenecaStore.getState().session.id;
    if (!sid) return;
    const cached = pagesCache.current.get(docId);
    if (cached) {
      setActivePages(cached);
      setPagesError(null);
      return;
    }
    setPagesError(null);
    setActivePages(null);
    try {
      const resp = await apiJson<{ pages: DocumentPageText[] }>(
        `/api/sessions/${sid}/documents/${docId}/pages`,
      );
      const pages = Array.isArray(resp.pages) ? resp.pages : [];
      pagesCache.current.set(docId, pages);
      if (stateRef.current.activeId === docId) {
        setActivePages(pages);
      }
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      setPagesError(`Couldn’t load this document. ${msg}`);
    }
  }, []);

  // Trigger a fetch whenever the active doc changes. PDFs need their
  // bytes for react-pdf; markdown/html viewers need the extracted text.
  useEffect(() => {
    if (!activeId) {
      setActiveBytes(null);
      setActivePages(null);
      setBytesError(null);
      setPagesError(null);
      return;
    }
    const cur = stateRef.current;
    const doc = cur.items.find((d) => d.id === activeId);
    const hint = doc?.renderHint ?? "pdfjs";
    if (hint === "pdfjs") {
      void loadBytesFor(activeId);
    } else {
      void loadPagesFor(activeId);
    }
  }, [activeId, loadBytesFor, loadPagesFor]);

  // ── upload / delete actions ────────────────────────────────────────────────

  const upload = useCallback(
    async (file: File) => {
      const sid = useSenecaStore.getState().session.id;
      if (!sid) return;
      setUploading(true);
      setUploadError(null);
      try {
        const buf = await file.arrayBuffer();
        const resp = await apiUploadBytes<UploadResponse>(
          `/api/sessions/${sid}/documents`,
          buf,
          {
            method: "POST",
            // Trust the browser's mime detection; fall back to a
            // generic binary so the server's extractor registry can
            // still sniff magic bytes + extension when the OS hasn't
            // mapped one (e.g. a bare `.md` file).
            contentType: file.type || "application/octet-stream",
            headers: { "X-File-Name": encodeURIComponent(file.name) },
          },
        );
        // Server is the source of truth on the new metadata + activeId.
        // We cache an INDEPENDENT copy of the bytes — `new Uint8Array(buf)`
        // alone would be a view into the same ArrayBuffer fetch / pdfjs
        // can later detach. See the same caveat in pdfTextExtractor.ts;
        // this is the client-side mirror of that fix.
        bytesCache.current.set(resp.document.id, cloneBytes(buf));
        // Skip the persist timer here because the POST already wrote.
        commit(resp.documents, { persist: false });
        lastSavedJson.current = JSON.stringify(resp.documents);
      } catch (err) {
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        setUploadError(msg);
      } finally {
        setUploading(false);
      }
    },
    [commit],
  );

  const remove = useCallback(
    async (documentId: string) => {
      const sid = useSenecaStore.getState().session.id;
      if (!sid) return;
      // Optimistic local removal so the UI snaps. We'll revert on failure.
      const before = stateRef.current;
      const remaining = before.items.filter((d) => d.id !== documentId);
      const optimistic: DocumentsState = {
        items: remaining,
        activeId:
          before.activeId === documentId
            ? (remaining[remaining.length - 1]?.id ?? null)
            : before.activeId,
      };
      bytesCache.current.delete(documentId);
      commit(optimistic, { persist: false });
      try {
        const resp = await apiJson<DeleteResponse>(
          `/api/sessions/${sid}/documents/${documentId}`,
          { method: "DELETE" },
        );
        commit(resp.documents, { persist: false });
        lastSavedJson.current = JSON.stringify(resp.documents);
      } catch (err) {
        // Roll back the local view to the server's last-known state.
        commit(before, { persist: false });
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        setUploadError(`Couldn’t delete the document. ${msg}`);
      }
    },
    [commit],
  );

  // ── per-document mutations ─────────────────────────────────────────────────

  const setActiveDocument = useCallback(
    (documentId: string) => {
      const cur = stateRef.current;
      if (cur.activeId === documentId) return;
      if (!cur.items.some((d) => d.id === documentId)) return;
      commit({ ...cur, activeId: documentId });
    },
    [commit],
  );

  const setDocumentPage = useCallback(
    (documentId: string, page: number) => {
      const cur = stateRef.current;
      const doc = cur.items.find((d) => d.id === documentId);
      if (!doc) return;
      const clamped = clampPage(page, doc.pageCount);
      if (doc.currentPage === clamped) return;
      const nextItems = cur.items.map((d) =>
        d.id === documentId ? { ...d, currentPage: clamped } : d,
      );
      commit({ ...cur, items: nextItems });
    },
    [commit],
  );

  const setDocumentPageCount = useCallback(
    (documentId: string, pageCount: number) => {
      const cur = stateRef.current;
      const doc = cur.items.find((d) => d.id === documentId);
      if (!doc) return;
      if (doc.pageCount === pageCount) return;
      const nextItems = cur.items.map((d) =>
        d.id === documentId
          ? {
              ...d,
              pageCount,
              currentPage: clampPage(d.currentPage, pageCount),
            }
          : d,
      );
      commit({ ...cur, items: nextItems });
    },
    [commit],
  );

  // ── bridge ────────────────────────────────────────────────────────────────

  useEffect(() => {
    const api: DocumentApi = {
      goToPage: (page, documentId) => {
        const cur = stateRef.current;
        const targetId = documentId ?? cur.activeId;
        if (!targetId) {
          throw new Error(
            "No document is loaded. The user needs to upload a PDF first.",
          );
        }
        const doc = cur.items.find((d) => d.id === targetId);
        if (!doc) {
          throw new Error(`Document ${targetId} is not in this session.`);
        }
        // Switch active first so the rendered page corresponds to the docId.
        if (cur.activeId !== targetId) {
          setActiveDocument(targetId);
        }
        if (doc.pageCount > 0) {
          setDocumentPage(targetId, page);
        } else {
          // Page count not known yet (first render in progress). Queue it.
          pendingPageRef.current = { docId: targetId, page };
        }
      },
    };
    setDocumentApi(api);
    return () => {
      if (getDocumentApi() === api) setDocumentApi(null);
    };
  }, [setActiveDocument, setDocumentPage]);

  // ── vision capture ─────────────────────────────────────────────────────────

  useEffect(() => {
    const unregister = registerCapturer("documents", async () => {
      const host = pageCanvasHostRef.current;
      if (!host) return null;
      const canvas = host.querySelector(
        "canvas",
      ) as HTMLCanvasElement | null;
      if (!canvas) return null;
      try {
        return await new Promise<Blob | null>((resolve) =>
          canvas.toBlob((b) => resolve(b), "image/png"),
        );
      } catch (err) {
        console.warn("[seneca] document capture failed", err);
        return null;
      }
    });
    return unregister;
  }, []);

  // ── persist on unmount in case a debounce is still pending ────────────────

  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      const sid = useSenecaStore.getState().session.id;
      if (!sid) return;
      const json = JSON.stringify(stateRef.current);
      if (json === lastSavedJson.current) return;
      apiJson(`/api/sessions/${sid}/documents`, {
        method: "PUT",
        body: stateRef.current,
      }).catch(() => {
        // best-effort
      });
    };
  }, [sessionId]);

  // ── react to external mutations of DocumentsState (Phase 6) ──────────────
  //
  // The DocumentTab snapshots store state on mount and round-trips its
  // own mutations through commit(). But server-fulfilled tools (notably
  // `document_create`) push a new DocumentsState into the store via
  // `setDocuments` directly. Without this subscription, those new docs
  // would never reach the local `items` / `activeId` and the sidebar
  // would silently miss them until the next session reload.
  //
  // Detection rule: when the store contains an id we don't, OR the
  // store's `activeId` differs from ours, treat that as authoritative
  // and rebroadcast through commit() so the persistence layer + the
  // saved-JSON guard stay consistent. We deliberately do NOT clobber
  // local state when the only difference is fields like `currentPage`
  // — the local copy is the source of truth for those.
  useEffect(() => {
    return useSenecaStore.subscribe((state, prev) => {
      const next = state.documentsState;
      if (next === prev.documentsState) return;
      if (!next) return;
      const cur = stateRef.current;
      const curIds = new Set(cur.items.map((it) => it.id));
      const nextIds = new Set(next.items.map((it) => it.id));
      const hasNewDocs = next.items.some((it) => !curIds.has(it.id));
      const lostDocs = cur.items.some((it) => !nextIds.has(it.id));
      const activeChanged = next.activeId !== cur.activeId;
      if (!hasNewDocs && !lostDocs && !activeChanged) return;
      const merged: DocumentsState = {
        items: next.items.map((nx) => {
          const local = cur.items.find((d) => d.id === nx.id);
          // Local wins on currentPage / pageCount when present so the
          // user's in-tab navigation isn't reset by an external push.
          return local
            ? { ...nx, currentPage: local.currentPage, pageCount: local.pageCount }
            : nx;
        }),
        activeId: next.activeId,
      };
      stateRef.current = merged;
      setItems(merged.items);
      setActiveId(merged.activeId);
      lastSavedJson.current = JSON.stringify(merged);
    });
  }, []);

  // ── memo the file= prop so react-pdf doesn't reload on every render ───────
  //
  // react-pdf hands `data` straight to pdfjs-dist, which detaches the
  // ArrayBuffer when it finishes parsing. If we passed `activeBytes`
  // directly, the cached Uint8Array would empty out after the first
  // render and the next re-parse (or session swap, or `Page` re-mount)
  // would throw "PDF file is empty". Wrapping in a fresh copy lets
  // pdfjs detach its sacrificial buffer while our cache stays intact.
  const fileProp = useMemo(
    () => (activeBytes ? { data: cloneBytes(activeBytes) } : null),
    [activeBytes],
  );

  // Once pages arrive for a non-PDF doc, sync the page count so the
  // toolbar shows "page N of M" the same way react-pdf does for PDFs.
  useEffect(() => {
    if (!activeDoc || !activePages) return;
    if (activeDoc.renderHint === "pdfjs") return;
    if (activeDoc.pageCount === activePages.length) return;
    setDocumentPageCount(activeDoc.id, activePages.length);
  }, [activeDoc, activePages, setDocumentPageCount]);

  const activePageText = useMemo(() => {
    if (!activeDoc || !activePages || activePages.length === 0) return "";
    const idx = Math.max(
      0,
      Math.min(activePages.length - 1, activeDoc.currentPage - 1),
    );
    return activePages[idx]?.text ?? "";
  }, [activeDoc, activePages]);

  const renderHint = activeDoc?.renderHint ?? "pdfjs";
  const isPdf = renderHint === "pdfjs";

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full flex-col bg-surface"
    >
      <DocumentToolbar
        document={activeDoc}
        page={activeDoc?.currentPage ?? 1}
        pageCount={activeDoc?.pageCount ?? 0}
        loading={bytesLoading}
        onPrev={() => {
          if (!activeDoc) return;
          setDocumentPage(activeDoc.id, activeDoc.currentPage - 1);
        }}
        onNext={() => {
          if (!activeDoc) return;
          setDocumentPage(activeDoc.id, activeDoc.currentPage + 1);
        }}
        onJump={(p) => {
          if (!activeDoc) return;
          setDocumentPage(activeDoc.id, p);
        }}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
      />
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && (
          <DocumentSidebar
            items={items}
            activeId={activeId}
            uploading={uploading}
            uploadError={uploadError}
            onPick={(id) => setActiveDocument(id)}
            onUpload={upload}
            onDelete={remove}
          />
        )}
        <main className="relative flex-1 overflow-hidden bg-surface-sunk/40">
          {items.length === 0 ? (
            <DocumentDropZone uploading={uploading} onUpload={upload} />
          ) : (
            <div className="absolute inset-0 overflow-auto p-6">
              {(bytesError || pagesError) && (
                <div className="mb-4 rounded-md border border-danger/40 bg-danger-soft px-4 py-3 text-xs text-danger-fg">
                  {bytesError ?? pagesError}
                </div>
              )}
              {isPdf && bytesLoading && !activeBytes && (
                <div className="mt-12 flex items-center justify-center">
                  <Spinner />
                </div>
              )}
              {isPdf && activeDoc && fileProp && (
                <div
                  ref={pageCanvasHostRef}
                  className={clsx(
                    "mx-auto flex w-fit flex-col items-center",
                    "rounded-md border border-border bg-card p-3 shadow-soft dark:shadow-soft-dark",
                  )}
                >
                  <Document
                    file={fileProp}
                    onLoadSuccess={({ numPages }) => {
                      setDocumentPageCount(activeDoc.id, numPages);
                      const pending = pendingPageRef.current;
                      if (pending && pending.docId === activeDoc.id) {
                        pendingPageRef.current = null;
                        setDocumentPage(activeDoc.id, pending.page);
                      }
                    }}
                    onLoadError={(err) => {
                      setBytesError(
                        `PDF.js couldn’t parse this document: ${err.message}`,
                      );
                    }}
                    loading={<Spinner />}
                    error={
                      <div className="px-4 py-6 text-sm text-danger">
                        Failed to load this PDF.
                      </div>
                    }
                  >
                    <Page
                      pageNumber={activeDoc.currentPage}
                      width={pageWidthFromHost(containerRef.current, sidebarOpen)}
                      renderTextLayer
                      renderAnnotationLayer
                      loading={<Spinner />}
                    />
                  </Document>
                </div>
              )}
              {!isPdf && activeDoc && !activePages && !pagesError && (
                <div className="mt-12 flex items-center justify-center">
                  <Spinner />
                </div>
              )}
              {!isPdf && activeDoc && activePages && (
                <div
                  ref={pageCanvasHostRef}
                  className={clsx(
                    "mx-auto max-w-3xl",
                    "rounded-md border border-border bg-card p-8 shadow-soft dark:shadow-soft-dark",
                  )}
                >
                  <MarkdownViewer text={activePageText} />
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-fg-subtle/40 border-t-fg-muted"
    />
  );
}

function clampPage(page: number, pageCount: number): number {
  if (pageCount <= 0) return Math.max(1, Math.floor(page));
  if (page < 1) return 1;
  if (page > pageCount) return pageCount;
  return Math.floor(page);
}

/**
 * Copy bytes into a freshly-allocated ArrayBuffer that is independent of
 * the source. Used in two places:
 *
 *   1. The upload handler caches the result so pdfjs cannot later detach
 *      our cache by parsing the user's File ArrayBuffer.
 *   2. The fileProp memo wraps activeBytes so the throwaway copy is what
 *      pdfjs detaches, leaving the cached entry available for any
 *      subsequent re-parse / re-mount.
 *
 * Accepts either an ArrayBuffer or any Uint8Array-like (Buffer, view).
 * The double-Uint8Array dance is the cheap way to force an independent
 * backing buffer regardless of the input shape.
 */
function cloneBytes(src: ArrayBuffer | Uint8Array): Uint8Array {
  const source = src instanceof Uint8Array ? src : new Uint8Array(src);
  const out = new Uint8Array(source.byteLength);
  out.set(source);
  return out;
}

/**
 * Compute a comfortable rendered page width based on the available area.
 * Caps at 1100px so very wide screens don't render an unreadably big page.
 * Accounts for the sidebar when it's open + outer padding + the page card.
 */
function pageWidthFromHost(
  host: HTMLElement | null,
  sidebarOpen: boolean,
): number {
  const fallback = 720;
  if (!host) return fallback;
  const total = host.clientWidth || fallback;
  const sidebar = sidebarOpen ? 256 : 0;
  // 6 + 6 outer padding (.p-6 each side) + 3 + 3 page card padding.
  const padding = 48 + 24;
  const usable = Math.max(420, total - sidebar - padding);
  return Math.min(1100, usable);
}
