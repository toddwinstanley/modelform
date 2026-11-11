/**
 * The layout editor's model. modelform lays panels out in reading order, packed into lines by
 * width (see layout.ts), so editing a layout is editing an order plus sizes: moving a panel
 * changes where it falls in the order, and every gridPos x/y is then rewritten from that
 * order so the file (and Grafana) agree with what the app shows.
 *
 * Panels are identified by their index in `dashboard.panels`, which edits keep stable (apart
 * from removing one), so the JSON text can be patched in place.
 */
import { diffJson, type JsonEdit } from './jsonEdit';
import { GRID_COLUMNS, gridUnitsToPx, isRow, panelSpan, type LayoutMode } from './layout';
import type { GridPos, Panel } from './schema';

const DEFAULT_POS: GridPos = { x: 0, y: 0, w: GRID_COLUMNS, h: 4 };
const pos = (p: Panel): GridPos => ({ ...DEFAULT_POS, ...p.gridPos });
const clampW = (w: number) => Math.min(GRID_COLUMNS, Math.max(1, Math.round(w)));
const clampH = (h: number) => Math.max(1, Math.round(h));

/** Top-level panel indices (rows included) in the order the app shows them; ties keep file order. */
export function readingOrder(panels: Panel[]): number[] {
  return panels.map((_, i) => i).sort((a, b) => pos(panels[a]).y - pos(panels[b]).y || pos(panels[a]).x - pos(panels[b]).x || a - b);
}

/**
 * Rewrites gridPos x/y so that sorting by position gives `order`, packing each line by width
 * the way the app does. Sizes are kept. Returns new panels; untouched ones are the same objects.
 */
export function repack(panels: Panel[], order: number[]): Panel[] {
  const out = [...panels];
  let y = 0;
  let x = 0;
  let lineH = 0;
  const newLine = () => {
    y += lineH;
    x = 0;
    lineH = 0;
  };
  for (const i of order) {
    const p = pos(panels[i]);
    let next: GridPos;
    if (isRow(panels[i])) {
      if (x > 0) newLine();
      next = { ...p, x: 0, y, w: GRID_COLUMNS, h: 1 };
      y += 1;
    } else {
      const w = clampW(p.w);
      if (x + w > GRID_COLUMNS) newLine();
      next = { ...p, x, y, w, h: clampH(p.h) };
      x += w;
      lineH = Math.max(lineH, next.h);
    }
    if (next.x !== p.x || next.y !== p.y || next.w !== p.w || next.h !== p.h || !panels[i].gridPos) out[i] = { ...panels[i], gridPos: next };
  }
  return out;
}

export interface CanvasItem {
  /** Index in dashboard.panels. */
  index: number;
  row: boolean;
  /** Pixels from the canvas's top left. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Columns out of 24 as laid out in this mode. */
  span: number;
  /** Height in grid units as laid out in this mode. */
  h: number;
}

export interface Canvas {
  items: CanvasItem[];
  height: number;
  /** Phone mode: panels hidden on phones, in order. They aren't in `items`. */
  hidden: number[];
}

export const CANVAS_GAP = 8;
export const CANVAS_ROW_HEADER = 32;

/** A size to show for one panel while it's being resized, in the units of the current mode. */
export interface SizeOverride {
  index: number;
  span: number;
  h: number;
}

/** Sizes in the current mode: grid uses gridPos; phone uses `mobile`, falling back like the app does. */
export function panelSize(panel: Panel, mode: LayoutMode): { span: number; h: number } {
  const p = pos(panel);
  if (mode === 'grid') return { span: clampW(p.w), h: clampH(p.h) };
  return { span: panelSpan(panel, 'phone'), h: clampH(panel.mobile?.h ?? p.h) };
}

/** Pixel rectangles for every panel and row, laid out as the app would at `width`. */
export function layoutCanvas(panels: Panel[], order: number[], mode: LayoutMode, width: number, override?: SizeOverride): Canvas {
  const colW = (width + CANVAS_GAP) / GRID_COLUMNS;
  const items: CanvasItem[] = [];
  const hidden: number[] = [];
  let y = 0;
  let line: CanvasItem[] = [];
  let used = 0;
  const flush = () => {
    if (!line.length) return;
    // Phones stretch a part-filled line across the screen.
    if (mode === 'phone' && used < GRID_COLUMNS) {
      const extra = GRID_COLUMNS - used;
      line.forEach((c, i) => (c.span += Math.floor(extra / line.length) + (i < extra % line.length ? 1 : 0)));
    }
    let x = 0;
    const h = Math.max(...line.map((c) => c.h));
    for (const c of line) {
      c.x = x * colW;
      c.width = c.span * colW - CANVAS_GAP;
      c.y = y;
      c.height = gridUnitsToPx(c.h);
      x += c.span;
    }
    items.push(...line);
    y += gridUnitsToPx(h) + CANVAS_GAP;
    line = [];
    used = 0;
  };
  for (const index of order) {
    const panel = panels[index];
    if (isRow(panel)) {
      flush();
      items.push({ index, row: true, x: 0, y, width, height: CANVAS_ROW_HEADER, span: GRID_COLUMNS, h: 1 });
      y += CANVAS_ROW_HEADER + CANVAS_GAP;
      continue;
    }
    if (mode === 'phone' && panel.mobile?.hidden) {
      hidden.push(index);
      continue;
    }
    const size = override?.index === index ? { span: clampW(override.span), h: clampH(override.h) } : panelSize(panel, mode);
    if (used + size.span > GRID_COLUMNS) flush();
    line.push({ index, row: false, x: 0, y: 0, width: 0, height: 0, ...size });
    used += size.span;
  }
  flush();
  return { items, height: Math.max(0, y - CANVAS_GAP), hidden };
}

/**
 * Where a dragged panel would land with the pointer at (x, y): before the panel or row
 * returned, or at the end (null). Uses the nearest item, before or after it by which half
 * the pointer is over (left/right for panels, top/bottom for rows).
 */
export function dropTarget(canvas: Canvas, x: number, y: number, dragging: number): number | null {
  const items = canvas.items.filter((c) => c.index !== dragging);
  if (!items.length || y > Math.max(...items.map((c) => c.y + c.height))) return null;
  // Prefer the line the pointer is level with; otherwise whatever's closest.
  const level = items.filter((c) => y >= c.y && y <= c.y + c.height);
  const pool = level.length ? level : items;
  const distance = (c: CanvasItem) => Math.hypot(Math.max(c.x - x, 0, x - (c.x + c.width)), Math.max(c.y - y, 0, y - (c.y + c.height)));
  let best = pool[0];
  for (const c of pool) if (distance(c) < distance(best)) best = c;
  const after = best.row ? y > best.y + best.height / 2 : x > best.x + best.width / 2;
  if (!after) return best.index;
  return items[items.indexOf(best) + 1]?.index ?? null;
}

/** Moves `index` to just before `before` (or to the end) and repacks. */
export function movePanel(panels: Panel[], index: number, before: number | null): Panel[] {
  const order = readingOrder(panels).filter((i) => i !== index);
  const at = before === null ? order.length : order.indexOf(before);
  order.splice(at === -1 ? order.length : at, 0, index);
  return repack(panels, order);
}

/** Resizes in the units of `mode`: gridPos w/h on the grid, mobile span/h on phones. */
export function resizePanel(panels: Panel[], index: number, mode: LayoutMode, span: number, h: number): Panel[] {
  const out = [...panels];
  const p = panels[index];
  out[index] =
    mode === 'grid'
      ? { ...p, gridPos: { ...pos(p), w: clampW(span), h: clampH(h) } }
      : { ...p, mobile: { ...p.mobile, span: clampW(span), h: clampH(h) } };
  return repack(out, readingOrder(out));
}

/** Shows or hides a panel on phones. */
export function setHiddenOnPhones(panels: Panel[], index: number, hidden: boolean): Panel[] {
  const out = [...panels];
  const { hidden: _, ...mobile } = panels[index].mobile ?? {};
  out[index] = { ...panels[index], mobile: hidden ? { ...mobile, hidden: true } : mobile };
  if (!hidden && !Object.keys(mobile).length) delete out[index].mobile;
  return out;
}

/** One more than the largest panel id anywhere, collapsed rows included. */
export function nextPanelId(panels: Panel[]): number {
  const ids = panels.flatMap((p) => [p.id, ...(p.panels ?? []).map((c) => c.id)]).filter((id): id is number => typeof id === 'number');
  return Math.max(0, ...ids) + 1;
}

/** Adds a panel after `after` (or at the end), with a fresh id. Returns the panels and the new one's index. */
export function insertPanel(panels: Panel[], panel: Panel, after: number | null): { panels: Panel[]; index: number } {
  const index = panels.length;
  const out = [...panels, { ...panel, id: nextPanelId(panels), gridPos: { ...DEFAULT_POS, ...panel.gridPos } }];
  const order = readingOrder(panels);
  order.splice(after === null ? order.length : order.indexOf(after) + 1, 0, index);
  return { panels: repack(out, order), index };
}

/** A copy of a panel right after it. */
export function duplicatePanel(panels: Panel[], index: number): { panels: Panel[]; index: number } {
  return insertPanel(panels, structuredClone(panels[index]), index);
}

/** Removes a panel. A collapsed row takes the panels inside it along. */
export function removePanel(panels: Panel[], index: number): Panel[] {
  const out = panels.filter((_, i) => i !== index);
  return repack(out, readingOrder(out));
}

/** Expands a collapsed row: its panels move out to the top level, right after it. */
export function expandRow(panels: Panel[], index: number): Panel[] {
  const row = panels[index];
  const children = row.panels ?? [];
  const out = [...panels, ...children];
  out[index] = { ...row, collapsed: false, panels: [] };
  const order = readingOrder(panels);
  order.splice(order.indexOf(index) + 1, 0, ...children.map((_, i) => panels.length + i));
  return repack(out, order);
}

/**
 * JSON edits that turn `before` into `after` (panel arrays from the ops above), with
 * `panels` patched element by element so the file keeps its formatting.
 */
export function panelEdits(before: Panel[], after: Panel[], removed?: number): JsonEdit[] {
  const edits: JsonEdit[] = [];
  let base = before;
  if (removed !== undefined) {
    edits.push({ path: ['panels', removed], remove: true });
    base = before.filter((_, i) => i !== removed);
  }
  base.forEach((p, i) => edits.push(...diffJson(p, after[i], ['panels', i])));
  for (let i = base.length; i < after.length; i++) edits.push({ path: ['panels', i], value: after[i], insert: true });
  return edits;
}
