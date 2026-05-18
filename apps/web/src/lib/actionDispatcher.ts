/**
 * Receives tool calls from the SSE stream and applies them to the right tab.
 * Always returns a ToolResult so the caller can queue feedback for Seneca's
 * next turn.
 */

import type { ToolCall, ToolResult } from "@seneca/shared";
import { useSenecaStore } from "../store/seneca";
import { getWhiteboardApi } from "./whiteboardBridge";
import { applyWhiteboardAdd, applyWhiteboardClear } from "./whiteboardActions";
import {
  applyMapDrawShape,
  applyMapDropPin,
  applyMapFlyTo,
  applyMapSetLayer,
  coerceDrawShapeInput,
  coerceDropPinInput,
  coerceFlyToInput,
  coerceSetLayerInput,
} from "./mapActions";
import {
  applyWebNavigate,
  applyWebSearch,
  coerceNavigateInput,
  coerceSearchInput,
} from "./webActions";
import {
  applyDocumentGoToPage,
  coerceGoToPageInput,
} from "./documentActions";

export async function dispatchToolCall(call: ToolCall): Promise<ToolResult> {
  try {
    switch (call.name) {
      case "whiteboard_add_element": {
        useSenecaStore.getState().setActiveTab("whiteboard", { pulse: true });
        const api = getWhiteboardApi();
        if (!api) throw new Error("Whiteboard is not mounted.");
        applyWhiteboardAdd(api, call.input);
        return { toolUseId: call.id, ok: true };
      }
      case "whiteboard_clear": {
        useSenecaStore.getState().setActiveTab("whiteboard", { pulse: true });
        const api = getWhiteboardApi();
        if (!api) throw new Error("Whiteboard is not mounted.");
        applyWhiteboardClear(api);
        return { toolUseId: call.id, ok: true };
      }
      case "map_fly_to": {
        useSenecaStore.getState().setActiveTab("map", { pulse: true });
        applyMapFlyTo(coerceFlyToInput(call.input));
        return { toolUseId: call.id, ok: true };
      }
      case "map_drop_pin": {
        useSenecaStore.getState().setActiveTab("map", { pulse: true });
        applyMapDropPin(coerceDropPinInput(call.input));
        return { toolUseId: call.id, ok: true };
      }
      case "map_draw_shape": {
        useSenecaStore.getState().setActiveTab("map", { pulse: true });
        applyMapDrawShape(coerceDrawShapeInput(call.input));
        return { toolUseId: call.id, ok: true };
      }
      case "map_set_layer": {
        useSenecaStore.getState().setActiveTab("map", { pulse: true });
        applyMapSetLayer(coerceSetLayerInput(call.input));
        return { toolUseId: call.id, ok: true };
      }
      case "web_navigate": {
        useSenecaStore.getState().setActiveTab("web", { pulse: true });
        await applyWebNavigate(coerceNavigateInput(call.input));
        return { toolUseId: call.id, ok: true };
      }
      case "web_search": {
        useSenecaStore.getState().setActiveTab("web", { pulse: true });
        await applyWebSearch(coerceSearchInput(call.input));
        return { toolUseId: call.id, ok: true };
      }
      case "web_read_page": {
        // Server-fulfilled: the agent loop in apps/api/src/routes/chat.ts
        // resolves this against its own webProxy + extractTextFromHtml
        // and feeds the page text directly into the next iteration's
        // tool_result. The client only needs to acknowledge the call so
        // the chip turns green; we deliberately don't re-fetch here.
        useSenecaStore.getState().setActiveTab("web", { pulse: true });
        return { toolUseId: call.id, ok: true };
      }
      case "document_go_to_page": {
        useSenecaStore.getState().setActiveTab("documents", { pulse: true });
        applyDocumentGoToPage(coerceGoToPageInput(call.input));
        return { toolUseId: call.id, ok: true };
      }
      case "document_read_page": {
        // Server-fulfilled: the agent loop in apps/api/src/routes/chat.ts
        // resolves this against the documentTextStore (and falls back to
        // server-side page rendering for scanned PDFs). The client only
        // needs to acknowledge the call so the chip turns green; we
        // deliberately don't try to read the PDF in the browser.
        useSenecaStore.getState().setActiveTab("documents", { pulse: true });
        return { toolUseId: call.id, ok: true };
      }
      case "document_list": {
        // Server-fulfilled: the agent loop projects the session's
        // DocumentsState into the tool_result so Seneca knows what is
        // loaded. The client just pulses the tab so the user sees Seneca
        // is checking the document state.
        useSenecaStore.getState().setActiveTab("documents", { pulse: true });
        return { toolUseId: call.id, ok: true };
      }
      case "document_search": {
        // Server-fulfilled: the agent loop runs a substring search over
        // every extracted page in the session and returns ranked hits.
        // Client just acknowledges the chip.
        useSenecaStore.getState().setActiveTab("documents", { pulse: true });
        return { toolUseId: call.id, ok: true };
      }
      case "document_create": {
        // Server-fulfilled (Phase 6 / Priority 1d): the agent loop
        // persists the AI-authored markdown inline (no Storage blob)
        // and pushes the updated DocumentsState back on the next turn's
        // session row. The client pulses the tab so the user sees the
        // new entry land in the sidebar. The session reload on the next
        // turn boundary refreshes the in-memory `DocumentsState`.
        useSenecaStore.getState().setActiveTab("documents", { pulse: true });
        return { toolUseId: call.id, ok: true };
      }
      default:
        return {
          toolUseId: call.id,
          ok: false,
          error: `Unknown tool: ${call.name}`,
        };
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { toolUseId: call.id, ok: false, error };
  }
}
