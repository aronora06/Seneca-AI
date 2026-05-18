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

export const MAP_FLY_TO: ToolDefinition = {
  name: "map_fly_to",
  description:
    "Animate the map to the given coordinates. Use this to anchor the conversation to a specific place. If you also give a label, a pin will be dropped at the destination so the user can see where you went.",
  input_schema: {
    type: "object",
    properties: {
      lat: {
        type: "number",
        description: "Latitude in degrees, between -90 and 90.",
      },
      lng: {
        type: "number",
        description: "Longitude in degrees, between -180 and 180.",
      },
      zoom: {
        type: "number",
        description:
          "Optional zoom level (Leaflet uses ~0–18). 5 sees a country, 10 sees a metro area, 15 sees neighbourhood streets.",
      },
      label: {
        type: "string",
        description:
          "Optional short label. If present, a pin is dropped at (lat, lng) with this label.",
      },
    },
    required: ["lat", "lng"],
    additionalProperties: false,
  },
};

export const MAP_DROP_PIN: ToolDefinition = {
  name: "map_drop_pin",
  description:
    "Drop a labelled pin on the map at the given coordinates. Use sparingly — a few well-chosen markers, not a flood. Pins survive across turns until cleared by the user.",
  input_schema: {
    type: "object",
    properties: {
      lat: { type: "number", description: "Latitude in degrees." },
      lng: { type: "number", description: "Longitude in degrees." },
      label: {
        type: "string",
        description: "Short label shown next to the pin.",
      },
    },
    required: ["lat", "lng", "label"],
    additionalProperties: false,
  },
};

export const MAP_DRAW_SHAPE: ToolDefinition = {
  name: "map_draw_shape",
  description:
    "Draw a polyline (route) or polygon (region) on the map. Points are [lat, lng] pairs in order. Keep shapes meaningful — a pipeline route, a contested border — not a sketch on top of the world.",
  input_schema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["polyline", "polygon"],
        description:
          "polyline for a path / route; polygon for an enclosed region.",
      },
      points: {
        type: "array",
        description:
          "Ordered list of [lat, lng] pairs. Polylines need at least 2 points; polygons at least 3.",
        items: {
          type: "array",
          items: { type: "number" },
          minItems: 2,
          maxItems: 2,
        },
      },
      label: {
        type: "string",
        description: "Optional label shown when the user hovers the shape.",
      },
      color: {
        type: "string",
        description: "Optional CSS colour for the stroke, e.g. '#c92a2a'.",
      },
    },
    required: ["type", "points"],
    additionalProperties: false,
  },
};

export const MAP_SET_LAYER: ToolDefinition = {
  name: "map_set_layer",
  description:
    "Switch the base tile layer between standard (OpenStreetMap) and satellite (Esri World Imagery). Use satellite when terrain or built environment matters; standard for general orientation.",
  input_schema: {
    type: "object",
    properties: {
      layer: {
        type: "string",
        enum: ["standard", "satellite"],
        description: "Which tile layer to show.",
      },
    },
    required: ["layer"],
    additionalProperties: false,
  },
};

export const WEB_NAVIGATE: ToolDefinition = {
  name: "web_navigate",
  description:
    "Load a URL in the shared web tab via the sanitised proxy. Use this when you already know the URL of a primary source the user should see — a Wikipedia page, a news article, an essay. Scripts are stripped, so dynamic apps will look bare.",
  input_schema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "Absolute URL beginning with http:// or https://. Other schemes are rejected.",
      },
    },
    required: ["url"],
    additionalProperties: false,
  },
};

export const WEB_SEARCH: ToolDefinition = {
  name: "web_search",
  description:
    "Search the web for sources. Returns a clickable list of results in the web tab; the user (or you, in a follow-up turn) can navigate to any of them. Use this when you need to surface a primary source you don't already have a URL for.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "What to search for. Keep it short and specific.",
      },
      max_results: {
        type: "number",
        description: "Number of results to return. Defaults to 5; capped at 10.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

export const WEB_READ_PAGE: ToolDefinition = {
  name: "web_read_page",
  description:
    "Read the textual content of a web page so you can answer questions about it directly, without asking the user to toggle the eye icon. Returns the page text already stripped of scripts, navigation, and styling. Use this for any question about *what a page says*; reserve the vision toggle for questions about *what a page looks like* (portraits, charts, layout). If `url` is omitted, reads whatever page is currently loaded in the web tab.",
  input_schema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "Optional. http(s) URL to read. Defaults to the page currently loaded in the web tab.",
      },
      max_chars: {
        type: "number",
        description:
          "Optional cap on the number of characters returned. Defaults to 12000; the server clamps this between 500 and 30000.",
      },
    },
    required: [],
    additionalProperties: false,
  },
};

export const DOCUMENT_GO_TO_PAGE: ToolDefinition = {
  name: "document_go_to_page",
  description:
    "Navigate the document viewer to a specific page. Use this when the conversation refers to a particular passage and the user should see it. Pages are 1-indexed; passing a page beyond the document length will clamp to the last page. If the user has uploaded multiple documents, pass `document_id` to switch to a specific one; otherwise the currently active document is used.",
  input_schema: {
    type: "object",
    properties: {
      page: {
        type: "number",
        description:
          "1-indexed page number. Values beyond the document length are clamped; values below 1 are clamped to 1.",
      },
      document_id: {
        type: "string",
        description:
          "Optional document id. When omitted, the currently active document is used. The user can see all uploaded documents in the sidebar.",
      },
    },
    required: ["page"],
    additionalProperties: false,
  },
};

export const DOCUMENT_LIST: ToolDefinition = {
  name: "document_list",
  description:
    "List every PDF document loaded in the shared documents tab. Call this whenever the user asks about *what they've uploaded* or you're not sure which documents are available. Returns an array of records — each with `id`, `name`, `filename`, `pageCount`, `currentPage`, `textStatus` (extracted / scanned / pending / failed), and an `active` flag marking the document the user is viewing. The user already sees this list in their sidebar; you should use this tool to bring yourself onto the same page rather than apologising that you can't see it.",
  input_schema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
};

export const DOCUMENT_SEARCH: ToolDefinition = {
  name: "document_search",
  description:
    "Search across the text of every uploaded document for a query phrase and return the matching pages with snippets. Use this for questions of the form \"where does it say X?\" or \"does any of my documents mention Y?\". Returns ranked hits — each with `documentId`, `documentName`, `page`, `snippet`, and `score`. The current implementation is keyword-level (case-insensitive substring); for conceptual / semantic questions ask the user to point you at a specific page so you can read it with `document_read_page`. Documents whose text has not yet been extracted are skipped and reported under `skipped`; the user can re-upload them or you can read one page from each to trigger lazy extraction.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "What to search for. Keep it specific — \"TS/SCI clearance\" beats \"clearance\". Case-insensitive.",
      },
      top_k: {
        type: "number",
        description:
          "Maximum number of hits to return. Defaults to 5; the server clamps between 1 and 20.",
      },
      document_id: {
        type: "string",
        description:
          "Optional. Restrict the search to a single document by id. When omitted, every loaded document is searched.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

export const DOCUMENT_CREATE: ToolDefinition = {
  name: "document_create",
  description:
    "Create a new markdown document and place it in the user's documents sidebar. Use this when you want to draft something durable for the user — a one-page summary of the conversation, an outline, a study guide, a comparison table, a take-home worksheet. The doc is persisted alongside their uploads, can be re-read later with `document_read_page` / `document_search`, and renders with full markdown formatting (headings, lists, tables, blockquotes, code blocks). Use markdown liberally; the user will see it rendered, not as raw text. Keep titles short and specific; keep content focused — multi-section drafts are fine, multi-page essays usually aren't. Returns the new document id so you can chain a `document_go_to_page` to surface it.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description:
          "Short title shown in the sidebar. 1–80 characters. No filesystem-illegal characters needed — Seneca handles sanitisation.",
      },
      content: {
        type: "string",
        description:
          "Markdown body of the document. Headings (`#`), lists, tables, blockquotes, and inline code all render. Keep it focused and under ~20K characters.",
      },
      format: {
        type: "string",
        enum: ["markdown"],
        description:
          "Document format. Only 'markdown' is supported at the moment.",
      },
    },
    required: ["title", "content"],
    additionalProperties: false,
  },
};

export const DOCUMENT_READ_PAGE: ToolDefinition = {
  name: "document_read_page",
  description:
    "Read the text of a specific page in an uploaded PDF so you can answer questions about its content directly — far cheaper than asking the user to enable vision capture. Born-digital PDFs return clean text; scanned PDFs (where the page is really an image) transparently return the rendered page as an image so you can read it visually anyway. You do not need the user's permission for this; the document is already loaded because they uploaded it. Pair this with `document_go_to_page` so the user can see the page you are reading. If `document_id` is omitted, the currently active document is read.",
  input_schema: {
    type: "object",
    properties: {
      page: {
        type: "number",
        description:
          "1-indexed page number to read. Values beyond the document length are clamped to the last page; values below 1 are clamped to 1.",
      },
      document_id: {
        type: "string",
        description:
          "Optional document id. When omitted, the currently active document is read.",
      },
      max_chars: {
        type: "number",
        description:
          "Optional cap on the number of characters returned. Defaults to 12000; the server clamps this between 500 and 30000.",
      },
    },
    required: ["page"],
    additionalProperties: false,
  },
};

export const ALL_TOOLS: ToolDefinition[] = [
  WHITEBOARD_ADD_ELEMENT,
  WHITEBOARD_CLEAR,
  MAP_FLY_TO,
  MAP_DROP_PIN,
  MAP_DRAW_SHAPE,
  MAP_SET_LAYER,
  WEB_NAVIGATE,
  WEB_SEARCH,
  WEB_READ_PAGE,
  DOCUMENT_GO_TO_PAGE,
  DOCUMENT_READ_PAGE,
  DOCUMENT_LIST,
  DOCUMENT_SEARCH,
  DOCUMENT_CREATE,
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

export interface MapFlyToInput {
  lat: number;
  lng: number;
  zoom?: number;
  label?: string;
}

export interface MapDropPinInput {
  lat: number;
  lng: number;
  label: string;
}

export type MapShapeKind = "polyline" | "polygon";

export interface MapDrawShapeInput {
  type: MapShapeKind;
  points: [number, number][];
  label?: string;
  color?: string;
}

export interface MapSetLayerInput {
  layer: "standard" | "satellite";
}

export interface WebNavigateInput {
  url: string;
}

export interface WebSearchInput {
  query: string;
  max_results?: number;
}

export interface WebReadPageInput {
  url?: string;
  max_chars?: number;
}

export interface DocumentGoToPageInput {
  page: number;
  document_id?: string;
}

export interface DocumentReadPageInput {
  page: number;
  document_id?: string;
  max_chars?: number;
}

export interface DocumentListInput {
  // intentionally empty
}

export interface DocumentSearchInput {
  query: string;
  top_k?: number;
  document_id?: string;
}

export interface DocumentCreateInput {
  title: string;
  content: string;
  format?: "markdown";
}

/**
 * One row in a `document_search` tool_result.
 *
 * `score` semantics depend on which engine produced the hit:
 *   - **Vector path (primary):** normalised cosine similarity in `[0, 1]`,
 *     produced by embedding the query with Voyage AI and comparing against
 *     persisted chunk embeddings. Higher = more semantically relevant.
 *   - **Substring fallback:** raw hit-count of the literal query on the
 *     page (always an integer ≥ 1). Used when the embeddings provider or
 *     `pgvector` is unavailable, or when a document has no extracted text.
 *
 * The wire shape is intentionally the same in both cases so callers (and
 * Seneca) don't have to branch on which engine ran. The `engine` field on
 * the enclosing tool_result envelope tells you which one produced the
 * results overall.
 */
export interface DocumentSearchHit {
  documentId: string;
  documentName: string;
  page: number;
  snippet: string;
  score: number;
}

export type ToolName =
  | "whiteboard_add_element"
  | "whiteboard_clear"
  | "map_fly_to"
  | "map_drop_pin"
  | "map_draw_shape"
  | "map_set_layer"
  | "web_navigate"
  | "web_search"
  | "web_read_page"
  | "document_go_to_page"
  | "document_read_page"
  | "document_list"
  | "document_search"
  | "document_create";
