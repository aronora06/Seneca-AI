/**
 * WCAG 2.1 contrast helpers for palette QA.
 */

function parseTriple(triple: string): [number, number, number] {
  const [r, g, b] = triple.split(/\s+/).map((v) => Number(v) / 255);
  return [r, g, b];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(fgTriple: string, bgTriple: string): number {
  const l1 = relativeLuminance(parseTriple(fgTriple));
  const l2 = relativeLuminance(parseTriple(bgTriple));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA normal text — 4.5:1 */
export function meetsTextContrast(fg: string, bg: string): boolean {
  return contrastRatio(fg, bg) >= 4.5;
}

export function meetsLargeTextContrast(fg: string, bg: string): boolean {
  return contrastRatio(fg, bg) >= 3;
}
