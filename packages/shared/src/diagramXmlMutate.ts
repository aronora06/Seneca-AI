/**
 * String-level mutations on draw.io mxGraphModel XML (no iframe).
 */

const STRUCTURAL_IDS = new Set(["0", "1"]);

function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const MX_CELL_BLOCK_RE =
  /<mxCell\b[^>]*?\bid="([^"]*)"[^>]*?\s*(?:\/>|>[\s\S]*?<\/mxCell>)/g;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Set the `value` attribute on a cell by id. Returns null if cell not found.
 */
export function setCellLabel(
  xml: string,
  cellId: string,
  text: string,
): string | null {
  if (STRUCTURAL_IDS.has(cellId)) {
    return null;
  }
  const escaped = escapeXmlAttr(text);
  const blockRe = new RegExp(
    `<mxCell\\b[^>]*?\\bid="${escapeRegex(cellId)}"[^>]*?\\s*(?:\\/>|>[\\s\\S]*?<\\/mxCell>)`,
  );
  const block = blockRe.exec(xml)?.[0];
  if (!block) return null;

  let newBlock: string;
  if (/\bvalue="/.test(block)) {
    newBlock = block.replace(/\bvalue="[^"]*"/, `value="${escaped}"`);
  } else {
    newBlock = block.replace(
      `id="${cellId}"`,
      `id="${cellId}" value="${escaped}"`,
    );
  }
  return xml.replace(block, newBlock);
}

/**
 * Remove mxCell blocks by id (never removes structural cells 0 and 1).
 */
export function removeCells(xml: string, cellIds: string[]): string {
  const toRemove = new Set(
    cellIds.filter((id) => id && !STRUCTURAL_IDS.has(id)),
  );
  if (toRemove.size === 0) return xml;

  return xml.replace(MX_CELL_BLOCK_RE, (block, id: string) => {
    if (toRemove.has(id)) return "";
    return block;
  });
}
