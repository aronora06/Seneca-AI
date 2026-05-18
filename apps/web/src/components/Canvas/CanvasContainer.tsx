import { StrictMode } from "react";

import { useSenecaStore } from "../../store/seneca";
import { TabBar } from "./TabBar";
import { WhiteboardTab } from "./WhiteboardTab";
import { MapTab } from "./MapTab";
import { WebTab } from "./WebTab";
import { DocumentTab } from "./DocumentTab";

/**
 * Phase 7 / tech-debt #4: StrictMode covers every canvas-tab subtree
 * EXCEPT the whiteboard. Excalidraw 0.18 still trips on StrictMode's
 * double-mount via its internal `useSyncExternalStore`; until upstream
 * fixes that, scoping StrictMode below the whiteboard keeps the
 * benefit (catching effect-cleanup bugs in MapTab / WebTab /
 * DocumentTab) without re-triggering the Excalidraw infinite-loop. The
 * whiteboard sibling stays as a plain mount.
 */
export function CanvasContainer() {
  const activeTab = useSenecaStore((s) => s.activeTab);
  // Mount each tab only after the session has loaded AND that tab's
  // backing state has hydrated. This avoids snapshot races (Excalidraw)
  // and zero-sized Leaflet bootstraps.
  const sessionReady = useSenecaStore((s) => s.session.id !== null);
  const whiteboardReady = useSenecaStore(
    (s) => sessionReady && s.whiteboard !== null,
  );
  const mapReady = useSenecaStore(
    (s) => sessionReady && s.mapState !== null,
  );
  const webReady = useSenecaStore(
    (s) => sessionReady && s.webState !== null,
  );
  const documentsReady = useSenecaStore(
    (s) => sessionReady && s.documentsState !== null,
  );

  return (
    <section className="flex h-full flex-1 flex-col overflow-hidden bg-surface">
      <StrictMode>
        <TabBar />
      </StrictMode>
      <div className="relative flex-1 overflow-hidden">
        {/* Whiteboard stays mounted across tab switches so its state
            survives. Intentionally NOT wrapped in StrictMode — see the
            file-level comment for the Excalidraw rationale. */}
        {whiteboardReady && (
          <div
            className={`absolute inset-0 ${
              activeTab === "whiteboard" ? "visible" : "invisible"
            }`}
          >
            <WhiteboardTab />
          </div>
        )}
        {/* Same trick for the map — keep it mounted to preserve Leaflet
            internals (tile cache, draw control, our pins / shapes). */}
        {mapReady && (
          <StrictMode>
            <div
              className={`absolute inset-0 ${
                activeTab === "map" ? "visible" : "invisible"
              }`}
            >
              <MapTab />
            </div>
          </StrictMode>
        )}
        {/* And again for the web tab — staying mounted means the iframe
            keeps its srcdoc + scroll position when the user flips away. */}
        {webReady && (
          <StrictMode>
            <div
              className={`absolute inset-0 ${
                activeTab === "web" ? "visible" : "invisible"
              }`}
            >
              <WebTab />
            </div>
          </StrictMode>
        )}
        {!whiteboardReady && activeTab === "whiteboard" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="font-serif text-base italic text-fg-subtle">
              Preparing the whiteboard…
            </div>
          </div>
        )}
        {!mapReady && activeTab === "map" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="font-serif text-base italic text-fg-subtle">
              Loading the map…
            </div>
          </div>
        )}
        {!webReady && activeTab === "web" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="font-serif text-base italic text-fg-subtle">
              Preparing the web tab…
            </div>
          </div>
        )}
        {/* Documents stays mounted across switches so the loaded PDF doesn't
            re-fetch when the user comes back to it. */}
        {documentsReady && (
          <StrictMode>
            <div
              className={`absolute inset-0 ${
                activeTab === "documents" ? "visible" : "invisible"
              }`}
            >
              <DocumentTab />
            </div>
          </StrictMode>
        )}
        {!documentsReady && activeTab === "documents" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="font-serif text-base italic text-fg-subtle">
              Preparing the documents tab…
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
