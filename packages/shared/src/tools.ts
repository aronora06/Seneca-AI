/**
 * Tool definitions sent to Anthropic. These are JSON Schema for the
 * `tools` parameter of the messages API. The shape here is the wire shape;
 * the dispatcher on the client matches against `name` and validates `input`.
 *
 * Phase 2 ships whiteboard tools only. Add map/document/web/tab tools when
 * those tabs land in Phase 3.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export const WHITEBOARD_ADD_ELEMENT: ToolDefinition = {
  name: "whiteboard_add_element",
  description:
    "Add a single element to the shared whiteboard. Use this to sketch text labels, simple shapes, lines, arrows, or freehand paths. Place a few well-spaced elements rather than densely overlapping ones; the user is sharing this canvas with you.",
  input_schema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["text", "rectangle", "ellipse", "line", "arrow", "freedraw"],
        description: "Which kind of element to create.",
      },
      x: {
        type: "number",
        description:
          "X coordinate in scene units. Top-left of the canvas is roughly (100, 100); spread outward from there.",
      },
      y: {
        type: "number",
        description: "Y coordinate in scene units.",
      },
      text: {
        type: "string",
        description: "Text content. Required when type is 'text'.",
      },
      width: {
        type: "number",
        description:
          "Width in pixels for rectangle and ellipse. Defaults to 120 when omitted.",
      },
      height: {
        type: "number",
        description:
          "Height in pixels for rectangle and ellipse. Defaults to 80 when omitted.",
      },
      points: {
        type: "array",
        description:
          "Points for line, arrow, or freedraw, given as [dx, dy] offsets relative to (x, y). The first point should be [0, 0].",
        items: {
          type: "array",
          items: { type: "number" },
          minItems: 2,
          maxItems: 2,
        },
      },
      strokeColor: {
        type: "string",
        description: "Optional stroke color, e.g. '#1e1e1e' or '#c92a2a'.",
      },
      fontSize: {
        type: "number",
        description: "Optional font size for text elements (default 20).",
      },
    },
    required: ["type", "x", "y"],
    additionalProperties: false,
  },
};

export const WHITEBOARD_CLEAR: ToolDefinition = {
  name: "whiteboard_clear",
  description:
    "Clear every element from the whiteboard. Use this only when the existing marks would actively confuse the next phase of the conversation; otherwise add to what is there.",
  input_schema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
};

export const ALL_TOOLS: ToolDefinition[] = [
  WHITEBOARD_ADD_ELEMENT,
  WHITEBOARD_CLEAR,
];

/**
 * Strongly-typed inputs the dispatcher will accept after validation.
 * These mirror the schemas above; keep them in sync.
 */
export type WhiteboardElementType =
  | "text"
  | "rectangle"
  | "ellipse"
  | "line"
  | "arrow"
  | "freedraw";

export interface WhiteboardAddElementInput {
  type: WhiteboardElementType;
  x: number;
  y: number;
  text?: string;
  width?: number;
  height?: number;
  points?: [number, number][];
  strokeColor?: string;
  fontSize?: number;
}

export interface WhiteboardClearInput {
  // intentionally empty
}

export type ToolName = "whiteboard_add_element" | "whiteboard_clear";
