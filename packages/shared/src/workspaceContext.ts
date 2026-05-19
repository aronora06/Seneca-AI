/**
 * Prompt formatting for {@link WorkspaceContext} (types live in types.ts).
 */

import type { WorkspaceContext } from "./types.js";

export type {
  WorkspaceContext,
  WorkspaceDocumentsContext,
  WorkspaceMapContext,
  WorkspaceVisionMode,
  WorkspaceWebContext,
  WorkspaceWhiteboardContext,
} from "./types.js";

/**
 * Turn the structured snapshot into a compact system-prompt appendix.
 * Kept factual and imperative so the model treats it as ground truth.
 */
export function formatWorkspaceContextForPrompt(ctx: WorkspaceContext): string {
  const lines: string[] = [
    "<workspace_context>",
    "Ground truth for the shared canvas (updated each turn; vision may still be off):",
    "",
    `Active tab: ${ctx.activeTab}`,
    `Vision for this turn: ${ctx.vision}${ctx.vision === "off" ? " — you do not receive a screenshot; rely on this block and tools." : ctx.vision === "locked" ? " — you also receive a screenshot of the active tab." : " — you receive one screenshot of the active tab on this message only."}`,
    `UI theme: ${ctx.uiTheme}`,
    "",
    "Whiteboard:",
    `- Background: ${ctx.whiteboard.backgroundColor} (${ctx.uiTheme} surface — ${ctx.uiTheme === "light" ? "warm off-white, not a dark chalkboard" : "dark surface"})`,
    `- Use stroke/text color ${ctx.whiteboard.recommendedStrokeColor} unless you have a deliberate accent that still contrasts.`,
    `- Elements on board: ${ctx.whiteboard.elementCount}`,
    "- Never place light-gray or white strokes on a light board, or near-black strokes on a dark board.",
    "- Omit strokeColor on whiteboard_add_element to accept the readable default.",
  ];

  if (ctx.whiteboard.viewport) {
    const v = ctx.whiteboard.viewport;
    lines.push(
      `- Visible region (scene units): x ${Math.round(v.minX)}–${Math.round(v.maxX)}, y ${Math.round(v.minY)}–${Math.round(v.maxY)}`,
    );
  }

  if (ctx.whiteboard.elements && ctx.whiteboard.elements.length > 0) {
    lines.push("- On-canvas elements (most recent last):");
    for (const el of ctx.whiteboard.elements) {
      const label = el.text ? ` "${el.text}"` : "";
      lines.push(
        `  · ${el.type} @(${el.x},${el.y}) ${el.width}×${el.height}${label}`,
      );
    }
  }

  if (ctx.visionCaptureFailed) {
    lines.push(
      "",
      "Vision: capture failed this turn — you do not have a screenshot despite the eye being on.",
    );
  }

  if (ctx.voice) {
    lines.push(
      "",
      "Voice:",
      `- Mode: ${ctx.voice.mode}${ctx.voice.muted ? " (muted)" : ""}`,
    );
  }

  if (ctx.map) {
    const [lat, lng] = ctx.map.center;
    lines.push(
      "",
      "Map:",
      `- View: center [${lat.toFixed(4)}, ${lng.toFixed(4)}], zoom ${ctx.map.zoom}, layer ${ctx.map.layer}`,
      `- Overlays: ${ctx.map.pinCount} pin(s), ${ctx.map.shapeCount} shape(s)`,
    );
    if (ctx.map.pins && ctx.map.pins.length > 0) {
      for (const p of ctx.map.pins) {
        const label = p.label ? ` "${p.label}"` : "";
        lines.push(`  · pin [${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}]${label}`);
      }
    }
  }

  if (ctx.documents) {
    const active =
      ctx.documents.activeDocumentName && ctx.documents.activePage != null
        ? `"${ctx.documents.activeDocumentName}" page ${ctx.documents.activePage}${ctx.documents.pageCount != null ? ` of ${ctx.documents.pageCount}` : ""}`
        : "none in front";
    const names =
      ctx.documents.loadedDocumentNames.length > 0
        ? ctx.documents.loadedDocumentNames.map((n) => `"${n}"`).join(", ")
        : "none loaded";
    lines.push("", "Documents:", `- In front: ${active}`, `- Loaded: ${names}`);
    if (ctx.documents.documents && ctx.documents.documents.length > 0) {
      for (const d of ctx.documents.documents) {
        const flags = [
          d.textStatus ? `text:${d.textStatus}` : null,
          d.indexStatus ? `index:${d.indexStatus}` : null,
          d.origin === "ai-created" ? "ai-authored" : null,
        ]
          .filter(Boolean)
          .join(", ");
        lines.push(
          `  · ${d.name} (id ${d.id})${flags ? ` [${flags}]` : ""}`,
        );
      }
    }
  }

  if (ctx.web) {
    lines.push(
      "",
      "Web:",
      ctx.web.searchOverlayOpen
        ? "- Search results overlay is open (no page loaded in the iframe)."
        : ctx.web.url
          ? `- Current URL: ${ctx.web.url}`
          : "- No page loaded (empty tab).",
    );
  }

  if (ctx.diagrams) {
    lines.push(
      "",
      "Diagrams:",
      `- Cells: ${ctx.diagrams.cellCount} (has user content: ${ctx.diagrams.hasContent ? "yes" : "no"})`,
    );
    if (ctx.diagrams.vertexCount != null) {
      lines.push(
        `- Vertices: ${ctx.diagrams.vertexCount}, edges: ${ctx.diagrams.edgeCount ?? 0}`,
      );
    }
    if (ctx.diagrams.bounds) {
      const b = ctx.diagrams.bounds;
      lines.push(
        `- Bounds: x=${Math.round(b.x)} y=${Math.round(b.y)} w=${Math.round(b.w)} h=${Math.round(b.h)}`,
      );
    }
    if (ctx.diagrams.vertices && ctx.diagrams.vertices.length > 0) {
      const vLines = ctx.diagrams.vertices
        .slice(0, 12)
        .map(
          (v) =>
            `  • [${v.id}] ${v.label || "(unlabeled)"}${v.shape ? ` (${v.shape})` : ""}`,
        );
      lines.push("- Vertices:", ...vLines);
    }
    if (ctx.diagrams.edges && ctx.diagrams.edges.length > 0) {
      const eLines = ctx.diagrams.edges
        .slice(0, 12)
        .map(
          (e) =>
            `  • ${e.from} → ${e.to}${e.label ? ` (“${e.label}”)` : ""}`,
        );
      lines.push("- Edges:", ...eLines);
    }
    if (ctx.diagrams.labelDigest.length > 0) {
      lines.push(
        `- Labels: ${ctx.diagrams.labelDigest.map((l) => `"${l}"`).join(", ")}`,
      );
    }
  }

  lines.push("</workspace_context>");
  return lines.join("\n");
}
