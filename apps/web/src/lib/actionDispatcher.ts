/**
 * Receives tool calls from the SSE stream and applies them to the right tab.
 * Always returns a ToolResult so the caller can queue feedback for Seneca's
 * next turn.
 */

import type { ToolCall, ToolResult } from "@seneca/shared";
import { useSenecaStore } from "../store/seneca";
import { getWhiteboardApi } from "./whiteboardBridge";
import { applyWhiteboardAdd, applyWhiteboardClear } from "./whiteboardActions";

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
