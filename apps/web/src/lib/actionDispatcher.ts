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
import {
  applyDiagramAddNodes,
  applyDiagramClear,
  applyDiagramLayout,
  applyDiagramLoad,
  applyDiagramMerge,
  applyDiagramRemoveCells,
  applyDiagramSetLabel,
  coerceDiagramAddNodesInput,
  coerceDiagramLayoutInput,
  coerceDiagramLoadInput,
  coerceDiagramMergeInput,
  coerceDiagramRemoveCellsInput,
  coerceDiagramSetLabelInput,
} from "./diagramActions";
import {
  documentGoToPageOutput,
  mapStateOutput,
  webNavigateOutput,
  webSearchOutput,
} from "./toolResultOutputs";

export async function dispatchToolCall(call: ToolCall): Promise<ToolResult> {
  try {
    switch (call.name) {
      case "whiteboard_add_element": {
        useSenecaStore.getState().setActiveTab("whiteboard", { pulse: true });
        const api = getWhiteboardApi();
        if (!api) throw new Error("Whiteboard is not mounted.");
        const placement = await applyWhiteboardAdd(api, call.input);
        return { toolUseId: call.id, ok: true, output: placement };
      }
      case "whiteboard_clear": {
        useSenecaStore.getState().setActiveTab("whiteboard", { pulse: true });
        const api = getWhiteboardApi();
        if (!api) throw new Error("Whiteboard is not mounted.");
        applyWhiteboardClear(api);
        return { toolUseId: call.id, ok: true, output: { cleared: true } };
      }
      case "diagram_load": {
        useSenecaStore.getState().setActiveTab("diagrams", { pulse: true });
        const output = await applyDiagramLoad(coerceDiagramLoadInput(call.input));
        return { toolUseId: call.id, ok: true, output };
      }
      case "diagram_merge": {
        useSenecaStore.getState().setActiveTab("diagrams", { pulse: true });
        const output = await applyDiagramMerge(
          coerceDiagramMergeInput(call.input),
        );
        return { toolUseId: call.id, ok: true, output };
      }
      case "diagram_clear": {
        useSenecaStore.getState().setActiveTab("diagrams", { pulse: true });
        const output = await applyDiagramClear();
        return { toolUseId: call.id, ok: true, output };
      }
      case "diagram_read": {
        useSenecaStore.getState().setActiveTab("diagrams", { pulse: true });
        return { toolUseId: call.id, ok: true };
      }
      case "diagram_set_label": {
        useSenecaStore.getState().setActiveTab("diagrams", { pulse: true });
        const output = await applyDiagramSetLabel(
          coerceDiagramSetLabelInput(call.input),
        );
        return { toolUseId: call.id, ok: true, output };
      }
      case "diagram_remove_cells": {
        useSenecaStore.getState().setActiveTab("diagrams", { pulse: true });
        const output = await applyDiagramRemoveCells(
          coerceDiagramRemoveCellsInput(call.input),
        );
        return { toolUseId: call.id, ok: true, output };
      }
      case "diagram_add_nodes": {
        useSenecaStore.getState().setActiveTab("diagrams", { pulse: true });
        const output = await applyDiagramAddNodes(
          coerceDiagramAddNodesInput(call.input),
        );
        return { toolUseId: call.id, ok: true, output };
      }
      case "diagram_layout": {
        useSenecaStore.getState().setActiveTab("diagrams", { pulse: true });
        const output = await applyDiagramLayout(
          coerceDiagramLayoutInput(call.input),
        );
        return { toolUseId: call.id, ok: true, output };
      }
      case "map_fly_to": {
        useSenecaStore.getState().setActiveTab("map", { pulse: true });
        applyMapFlyTo(coerceFlyToInput(call.input));
        return { toolUseId: call.id, ok: true, output: mapStateOutput() };
      }
      case "map_drop_pin": {
        useSenecaStore.getState().setActiveTab("map", { pulse: true });
        applyMapDropPin(coerceDropPinInput(call.input));
        return { toolUseId: call.id, ok: true, output: mapStateOutput() };
      }
      case "map_draw_shape": {
        useSenecaStore.getState().setActiveTab("map", { pulse: true });
        applyMapDrawShape(coerceDrawShapeInput(call.input));
        return { toolUseId: call.id, ok: true, output: mapStateOutput() };
      }
      case "map_set_layer": {
        useSenecaStore.getState().setActiveTab("map", { pulse: true });
        applyMapSetLayer(coerceSetLayerInput(call.input));
        return { toolUseId: call.id, ok: true, output: mapStateOutput() };
      }
      case "web_navigate": {
        useSenecaStore.getState().setActiveTab("web", { pulse: true });
        const input = coerceNavigateInput(call.input);
        await applyWebNavigate(input);
        useSenecaStore.getState().setWebSearchOverlayOpen(false);
        return {
          toolUseId: call.id,
          ok: true,
          output: webNavigateOutput(input.url),
        };
      }
      case "web_search": {
        useSenecaStore.getState().setActiveTab("web", { pulse: true });
        const input = coerceSearchInput(call.input);
        const results = await applyWebSearch(input);
        useSenecaStore.getState().setWebSearchOverlayOpen(true);
        return {
          toolUseId: call.id,
          ok: true,
          output: webSearchOutput(input.query, results),
        };
      }
      case "web_read_page": {
        useSenecaStore.getState().setActiveTab("web", { pulse: true });
        return { toolUseId: call.id, ok: true };
      }
      case "document_go_to_page": {
        useSenecaStore.getState().setActiveTab("documents", { pulse: true });
        const input = coerceGoToPageInput(call.input);
        applyDocumentGoToPage(input);
        return {
          toolUseId: call.id,
          ok: true,
          output: documentGoToPageOutput(input.page, input.document_id),
        };
      }
      case "document_read_page": {
        useSenecaStore.getState().setActiveTab("documents", { pulse: true });
        return { toolUseId: call.id, ok: true };
      }
      case "document_list": {
        useSenecaStore.getState().setActiveTab("documents", { pulse: true });
        return { toolUseId: call.id, ok: true };
      }
      case "document_search": {
        useSenecaStore.getState().setActiveTab("documents", { pulse: true });
        return { toolUseId: call.id, ok: true };
      }
      case "document_create": {
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
