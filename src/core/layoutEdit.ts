/**
 * The layout editor's model. Wide screens show panels where Grafana does: at their gridPos,
 * floated up (see compactGrid in layout.ts). So editing the grid is placing and sizing panels,
 * and after every change gridPos is rewritten to the floated-up layout, so the file (and
 * Grafana) say what the app shows. Phones show panels in reading order, packed into lines;
 * moving a panel there moves it in that order, which is still a place on the grid.
 *
 * Panels are identified by their index in `dashboard.panels`, which edits keep stable (apart
 * from removing some), so the JSON text can be patched in place.
 */
import { diffJson, type JsonEdit } from './jsonEdit';
import { compactGrid, GRID_COLUMNS, gridOffsetPx, gridUnitsToPx, isRow, panelSpan, type GridBox, type LayoutMode } from './layout';
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
 * Rewrites gridPos x/y so that sorting by position gives `order`, packing each line by width.
 * Sizes are kept. Returns new panels; untouched ones are the same objects.
 *
 * @deprecated Wide screens now show panels where their gridPos puts them, so packing into
 * lines throws placement away. Use `settleLayout` to tidy a layout, `placePanel` to move one.
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

/**
 * One panel shown as it's being changed: a size while it's resized, in the units of the current
 * mode, or (on the grid) a place while it's dragged. The other panels make way as they will.
 */
export interface SizeOverride {
  index: number;
  span?: number;
  h?: number;
  /** Grid only: column and line of the top left. */
  x?: number;
  y?: number;
}

/** Sizes in the current mode: grid uses gridPos; phone uses `mobile`, falling back like the app does. */
export function panelSize(panel: Panel, mode: LayoutMode): { span: number; h: number } {
  const p = pos(panel);
  if (mode === 'grid') return { span: clampW(p.w), h: clampH(p.h) };
  return { span: panelSpan(panel, 'phone'), h: clampH(panel.mobile?.h ?? p.h) };
}

/** Pixel rectangles for every panel and row, laid out as the app would at `width`. */
export function layoutCanvas(panels: Panel[], order: number[], mode: LayoutMode, width: number, override?: SizeOverride): Canvas {
  return mode === 'grid' ? layoutGridCanvas(panels, width, override) : layoutPhoneCanvas(panels, order, width, override);
}

/** The grid as wide screens show it: every panel at its gridPos, floated up, rows across the full width. */
function layoutGridCanvas(panels: Panel[], width: number, override?: SizeOverride): Canvas {
  const colW = (width + CANVAS_GAP) / GRID_COLUMNS;
  let boxes = gridBoxes(panels);
  if (override && boxes[override.index]) {
    const b = { ...boxes[override.index] };
    if (!isRow(panels[override.index])) {
      if (override.span !== undefined) b.w = clampW(override.span);
      if (override.h !== undefined) b.h = clampH(override.h);
    }
    if (override.x !== undefined) b.x = isRow(panels[override.index]) ? 0 : Math.min(GRID_COLUMNS - b.w, Math.max(0, Math.round(override.x)));
    if (override.y !== undefined) b.y = Math.max(0, Math.round(override.y));
    b.x = Math.min(b.x, GRID_COLUMNS - b.w);
    boxes = [...boxes];
    boxes[override.index] = b;
  }
  const settled = settleBoxes(boxes, override?.index);
  const items: CanvasItem[] = settled.map((b, index) => {
    const row = isRow(panels[index]);
    return { index, row, x: b.x * colW, y: gridOffsetPx(b.y), width: b.w * colW - CANVAS_GAP, height: row ? gridUnitsToPx(1) : gridUnitsToPx(b.h), span: b.w, h: b.h };
  });
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  return { items, height: Math.max(0, ...items.map((c) => c.y + c.height)), hidden: [] };
}

/** Phones: reading order packed into lines, part-filled lines stretched across. */
function layoutPhoneCanvas(panels: Panel[], order: number[], width: number, override?: SizeOverride): Canvas {
  const mode: LayoutMode = 'phone';
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
    const natural = panelSize(panel, mode);
    const size = override?.index === index ? { span: clampW(override.span ?? natural.span), h: clampH(override.h ?? natural.h) } : natural;
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

/**
 * Moves `index` to just before `before` in reading order (or to the end), for phones, where
 * order is all there is: it takes `before`'s place on the grid, which moves down to make way.
 * The grid stays the source of truth, so panels beside the moved one can float up past
 * `before` too; the moved panel always lands right before it.
 */
export function movePanel(panels: Panel[], index: number, before: number | null): Panel[] {
  if (before === index) return panels;
  const others = panels.filter((_, i) => i !== index);
  const at = before === null || !panels[before] ? { x: 0, y: bottom(others) } : pos(panels[before]);
  return placePanel(panels, index, at.x, at.y);
}

/** Resizes in the units of `mode`: gridPos w/h on the grid (panels in the way move down), mobile span/h on phones. */
export function resizePanel(panels: Panel[], index: number, mode: LayoutMode, span: number, h: number): Panel[] {
  const out = [...panels];
  const p = panels[index];
  if (mode === 'phone') {
    out[index] = { ...p, mobile: { ...p.mobile, span: clampW(span), h: clampH(h) } };
    return out;
  }
  const w = clampW(span);
  out[index] = { ...p, gridPos: { ...pos(p), x: Math.min(pos(p).x, GRID_COLUMNS - w), w, h: clampH(h) } };
  return settleLayout(out, index);
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

/**
 * Adds a panel with a fresh id: beside `after` if it fits on the same line, else under it, or
 * at the bottom without one. Panels in the way move down. Returns the panels and the new one's index.
 */
export function insertPanel(panels: Panel[], panel: Panel, after: number | null): { panels: Panel[]; index: number } {
  const index = panels.length;
  const p = { ...DEFAULT_POS, ...panel.gridPos };
  const w = isRow(panel) ? GRID_COLUMNS : clampW(p.w);
  let at: { x: number; y: number };
  if (after === null || !panels[after]) at = { x: 0, y: bottom(panels) };
  else {
    const a = pos(panels[after]);
    at = !isRow(panel) && !isRow(panels[after]) && a.x + a.w + w <= GRID_COLUMNS ? { x: a.x + a.w, y: a.y } : { x: isRow(panel) ? 0 : Math.min(a.x, GRID_COLUMNS - w), y: a.y + a.h };
  }
  const out = [...panels, { ...panel, id: nextPanelId(panels), gridPos: { ...p, ...at, w } }];
  return { panels: settleLayout(out, index), index };
}

/** A copy of a panel beside or under it. */
export function duplicatePanel(panels: Panel[], index: number): { panels: Panel[]; index: number } {
  return insertPanel(panels, structuredClone(panels[index]), index);
}

/** Removes a panel; the panels below float up. A collapsed row takes the panels inside it along. */
export function removePanel(panels: Panel[], index: number): Panel[] {
  return settleLayout(panels.filter((_, i) => i !== index));
}

/**
 * Expands a collapsed row: its panels move out to the top level, under it, as they were laid
 * out inside it, and everything below moves down to make room. They're added at the end of
 * the panels array so the rest of the file stays as it is.
 */
export function expandRow(panels: Panel[], index: number): Panel[] {
  const row = panels[index];
  const children = row.panels ?? [];
  const top = pos(row).y + 1;
  const first = Math.min(...children.map((c) => pos(c).y));
  const height = Math.max(0, ...children.map((c) => pos(c).y - first + pos(c).h));
  const out = panels.map((p, i) => (i !== index && pos(p).y > pos(row).y ? { ...p, gridPos: { ...pos(p), y: pos(p).y + height } } : p));
  out[index] = { ...row, collapsed: false, panels: [] };
  out.push(...children.map((c) => ({ ...c, gridPos: { ...pos(c), y: top + pos(c).y - first } })));
  return settleLayout(out);
}

/**
 * Collapses a row: the panels under it, down to the next row, move inside it, and the panels
 * below float up. Returns the panels and the indices that left the top level, for panelEdits.
 */
export function collapseRow(panels: Panel[], index: number): { panels: Panel[]; removed: number[] } {
  const order = readingOrder(panels);
  const at = order.indexOf(index);
  const next = order.findIndex((i, n) => n > at && isRow(panels[i]));
  const removed = order.slice(at + 1, next === -1 ? order.length : next).sort((a, b) => a - b);
  const out = panels.filter((_, i) => !removed.includes(i));
  const rowAt = index - removed.filter((i) => i < index).length;
  out[rowAt] = { ...panels[index], collapsed: true, panels: removed.map((i) => panels[i]) };
  return { panels: settleLayout(out), removed };
}

/** The first free line under every panel. */
const bottom = (panels: Panel[]) => Math.max(0, ...panels.map((p) => pos(p).y + pos(p).h));

/** Top-level panels as boxes on the grid; rows always span it, one unit high. */
const gridBoxes = (panels: Panel[]): GridBox[] => panels.map((p) => (isRow(p) ? { ...pos(p), x: 0, w: GRID_COLUMNS, h: 1 } : pos(p)));

/** Boxes floated up the way the app shows them, with `fixed` placed first so the rest make way for it. */
function settleBoxes(boxes: GridBox[], fixed?: number): GridBox[] {
  const made = fixed === undefined ? boxes : compactGrid(boxes, new Set([fixed]));
  return compactGrid(made);
}

/** Writes boxes back into gridPos, leaving panels whose box didn't change as they were. */
function writeBoxes(panels: Panel[], boxes: GridBox[]): Panel[] {
  return panels.map((p, i) => {
    const before = p.gridPos;
    const b = boxes[i];
    return before && before.x === b.x && before.y === b.y && before.w === b.w && before.h === b.h ? p : { ...p, gridPos: { ...pos(p), ...b } };
  });
}

/**
 * Floats every panel up the way the app shows them, so the file says what the app shows. With
 * `fixed`, that panel keeps its place (just moved or resized) and any it now covers move down
 * first. Panels already in place are left as the same objects.
 */
export function settleLayout(panels: Panel[], fixed?: number): Panel[] {
  return writeBoxes(panels, settleBoxes(gridBoxes(panels), fixed));
}

/** Puts a panel with its top left at column x, line y; panels in the way move down, then everything floats up. */
export function placePanel(panels: Panel[], index: number, x: number, y: number): Panel[] {
  const out = [...panels];
  const p = pos(panels[index]);
  const w = isRow(panels[index]) ? GRID_COLUMNS : clampW(p.w);
  out[index] = { ...panels[index], gridPos: { ...p, x: Math.min(GRID_COLUMNS - w, Math.max(0, Math.round(x))), y: Math.max(0, Math.round(y)) } };
  return settleLayout(out, index);
}

/** The grid cell a panel `w` columns wide would take with its top left at pixel (x, y) on a canvas `width` wide. */
export function snapToGrid(width: number, x: number, y: number, w: number): { x: number; y: number } {
  const colW = (width + CANVAS_GAP) / GRID_COLUMNS;
  return { x: Math.min(GRID_COLUMNS - w, Math.max(0, Math.round(x / colW))), y: Math.max(0, Math.round(y / gridOffsetPx(1))) };
}

/**
 * JSON edits that turn `before` into `after` (panel arrays from the ops above), with
 * `panels` patched element by element so the file keeps its formatting.
 */
export function panelEdits(before: Panel[], after: Panel[], removed?: number | number[]): JsonEdit[] {
  const edits: JsonEdit[] = [];
  let base = before;
  // From the end, so each removal leaves the indices of the ones still to come alone.
  const gone = [...new Set(removed === undefined ? [] : [removed].flat())].sort((a, b) => b - a);
  for (const i of gone) edits.push({ path: ['panels', i], remove: true });
  if (gone.length) base = before.filter((_, i) => !gone.includes(i));
  base.forEach((p, i) => edits.push(...diffJson(p, after[i], ['panels', i])));
  for (let i = base.length; i < after.length; i++) edits.push({ path: ['panels', i], value: after[i], insert: true });
  return edits;
}
