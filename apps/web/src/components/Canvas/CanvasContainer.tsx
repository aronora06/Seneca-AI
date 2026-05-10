import { useSenecaStore } from "../../store/seneca";
import { TabBar } from "./TabBar";
import { WhiteboardTab } from "./WhiteboardTab";

export function CanvasContainer() {
  const activeTab = useSenecaStore((s) => s.activeTab);
  // Mount Excalidraw only after the session has loaded; otherwise the
  // snapshot used as initialData would be empty AND we'd risk a re-mount
  // when whiteboard state arrives, which Excalidraw doesn't tolerate
  // gracefully.
  const ready = useSenecaStore(
    (s) => s.session.id !== null && s.whiteboard !== null,
  );

  return (
    <section className="flex h-full flex-1 flex-col overflow-hidden bg-surface">
      <TabBar />
      <div className="relative flex-1 overflow-hidden">
        {/* Whiteboard stays mounted across tab switches so its state survives. */}
        {ready && (
          <div
            className={`absolute inset-0 ${
              activeTab === "whiteboard" ? "visible" : "invisible"
            }`}
          >
            <WhiteboardTab />
          </div>
        )}
        {!ready && activeTab === "whiteboard" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="font-serif text-base italic text-fg-subtle">
              Preparing the whiteboard…
            </div>
          </div>
        )}
        {ready && activeTab !== "whiteboard" && (
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <div className="card max-w-md p-6 text-center">
              <p className="font-serif text-lg text-fg">
                {activeTab === "documents" && "Documents tab"}
                {activeTab === "web" && "Web tab"}
                {activeTab === "map" && "Map tab"}
              </p>
              <p className="mt-1 text-sm text-fg-muted">
                Coming in Phase 3. For now, the whiteboard is the active canvas.
              </p>
              <button
                type="button"
                className="btn-primary mt-4"
                onClick={() =>
                  useSenecaStore.getState().setActiveTab("whiteboard")
                }
              >
                Back to whiteboard
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
