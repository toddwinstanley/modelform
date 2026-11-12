import type { Dashboard, Panel } from './schema';
import { ALL, type VariableInfo, type VariableValues, type VarOption } from './variables';

/**
 * Converts Grafana's 24-column absolute grid into rows that reflow on a phone.
 *
 * Grafana positions panels absolutely (gridPos x/y/w/h). A phone can't show that
 * faithfully, so panels are taken in reading order (y, then x) and packed into
 * rows. In "phone" mode small panels (w <= 6, e.g. stat tiles) go two-up and
 * everything else is full width; `panel.mobile` overrides either. In "grid"
 * mode (tablets) the original widths are kept.
 *
 * Repeated rows and panels are expanded here, one copy per selected value of
 * their `repeat` variable, each carrying that value in `scopedVars`.
 */

export const GRID_COLUMNS = 24;
const CELL_HEIGHT = 30;
const CELL_MARGIN = 8;

export type LayoutMode = 'phone' | 'grid';

export interface LayoutCell {
  /** Unique across the layout, including copies of a repeated panel. */
  key: string;
  panel: Panel;
  /** Columns out of 24. */
  span: number;
}

export interface LayoutRow {
  cells: LayoutCell[];
  /** Height in grid units. */
  h: number;
}

/** A panel placed on Grafana's grid, relative to the top of its section. */
export interface GridCell extends LayoutCell {
  /** Column of the left edge, 0 to 23. */
  x: number;
  /** In grid units from the top of the section. */
  y: number;
  /** Columns wide; the same as `span`. */
  w: number;
  /** Height in grid units. */
  h: number;
}

export interface LayoutSection {
  key: string;
  /** The Grafana "row" panel heading this section, if any. */
  row?: Panel;
  collapsed: boolean;
  /** Panels packed into lines in reading order: how phones show the section. */
  rows: LayoutRow[];
  /** Panels where Grafana puts them, floated up: how wide screens show the section. */
  grid: { cells: GridCell[]; h: number };
}

/** Grafana's pixel height for h grid units. */
export const gridUnitsToPx = (h: number) => h * CELL_HEIGHT + (h - 1) * CELL_MARGIN;

/** How far down y grid units starts, in pixels: each unit is a cell plus the gap under it. */
export const gridOffsetPx = (y: number) => y * (CELL_HEIGHT + CELL_MARGIN);

/** A rectangle on Grafana's grid, in columns and height units. */
export interface GridBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: GridBox, b: GridBox) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Grafana's vertical compaction. Boxes are taken top to bottom, then left to right; each floats
 * up as far as it can, and one that overlaps a box already placed drops below it. Boxes listed
 * in `fixed` are placed first, where they are, so the rest make way for them. Columns are
 * snapped to whole units and kept on the grid. Returns new boxes, in the same order.
 */
export function compactGrid(boxes: GridBox[], fixed: ReadonlySet<number> = new Set()): GridBox[] {
  const snapped = boxes.map((b) => {
    // Rounding both edges keeps fractional widths (e.g. 24 / 5 repeats) tiling without overlaps.
    // A box past the right edge keeps its width and moves left, as in Grafana.
    const w = Math.min(GRID_COLUMNS, Math.max(1, Math.round(b.x + b.w) - Math.round(b.x)));
    const x = Math.min(GRID_COLUMNS - w, Math.max(0, Math.round(b.x)));
    return { x, y: Math.max(0, b.y), w, h: Math.max(1, Math.round(b.h)) };
  });
  const out: GridBox[] = new Array(boxes.length);
  const placed: GridBox[] = [];
  for (const i of fixed) {
    if (!snapped[i]) continue;
    out[i] = { ...snapped[i], y: Math.round(snapped[i].y) };
    placed.push(out[i]);
  }
  const order = snapped
    .map((_, i) => i)
    .filter((i) => !fixed.has(i))
    .sort((a, b) => snapped[a].y - snapped[b].y || snapped[a].x - snapped[b].x || a - b);
  for (const i of order) {
    const box = { ...snapped[i], y: Math.floor(snapped[i].y) };
    box.y = Math.min(box.y, Math.max(0, ...placed.map((p) => p.y + p.h)));
    while (box.y > 0 && !placed.some((p) => overlaps({ ...box, y: box.y - 1 }, p))) box.y--;
    for (let hit = placed.find((p) => overlaps(box, p)); hit; hit = placed.find((p) => overlaps(box, p))) box.y = hit.y + hit.h;
    out[i] = box;
    placed.push(box);
  }
  return out;
}

export const isRow = (p: Panel) => p.type === 'row';

const byPosition = (a: Panel, b: Panel) => a.gridPos.y - b.gridPos.y || a.gridPos.x - b.gridPos.x;

/** Current variable values and options; without them repeated rows and panels render once, unrepeated. */
export interface RepeatContext {
  values: VariableValues;
  info: Record<string, VariableInfo>;
}

export function layoutDashboard(dashboard: Dashboard, mode: LayoutMode = 'phone', repeat?: RepeatContext): LayoutSection[] {
  const sections: { row?: Panel; children: Panel[] }[] = [{ children: [] }];

  for (const panel of [...(dashboard.panels ?? [])].sort(byPosition)) {
    if (isRow(panel)) {
      // A collapsed row carries its children in row.panels; an expanded row owns the panels that follow it.
      sections.push({ row: panel, children: panel.collapsed ? [...(panel.panels ?? [])] : [] });
    } else {
      sections[sections.length - 1].children.push(panel);
    }
  }

  return sections
    .filter((s) => s.row || s.children.length)
    .flatMap((s, i) => {
      const key = s.row ? `row-${s.row.id ?? i}` : `section-${i}`;
      const copies = s.row?.repeat && repeat ? repeatOptions(s.row.repeat, repeat) : null;
      if (!copies) return [{ key, row: s.row, children: s.children }];
      return copies.map((o) => {
        const scoped = { [s.row!.repeat!]: o };
        return {
          key: `${key}:${o.value}`,
          row: { ...s.row!, scopedVars: { ...s.row!.scopedVars, ...scoped } },
          children: s.children.map((c) => ({ ...c, scopedVars: { ...c.scopedVars, ...scoped } })),
        };
      });
    })
    .map((s) => {
      const panels = expandPanelRepeats(s.children, repeat).sort(byPosition);
      return { key: s.key, row: s.row, collapsed: !!s.row?.collapsed, rows: packRows(panels, mode), grid: placeOnGrid(panels) };
    });
}

/** A section's panels at their gridPos, floated up to the top of the section. */
function placeOnGrid(panels: Panel[]): LayoutSection['grid'] {
  const boxes = compactGrid(panels.map((p) => p.gridPos));
  const cells = panels.map((panel, i): GridCell => ({ key: panelKey(panel), panel, span: boxes[i].w, ...boxes[i] }));
  return { cells, h: Math.max(0, ...boxes.map((b) => b.y + b.h)) };
}

/** One option per selected value of `name`; every option when All is selected. */
export function repeatOptions(name: string, ctx: RepeatContext): VarOption[] {
  const value = ctx.values[name];
  const info = ctx.info[name];
  const selected = value == null ? [] : Array.isArray(value) ? value : [value];
  if (selected.length === 1 && selected[0] === ALL) return info?.options ?? [];
  return selected.filter((v) => v !== '').map((v) => info?.options.find((o) => o.value === v) ?? { text: v, value: v });
}

/**
 * Copies of each repeated panel, laid out as Grafana does: side by side up to maxPerRow
 * (default 4) and wrapping, or stacked. Copies keep the original's y plus a fraction per
 * line, so they sort together ahead of the panels below rather than pushing them down.
 */
function expandPanelRepeats(panels: Panel[], ctx: RepeatContext | undefined): Panel[] {
  if (!ctx) return panels;
  return panels.flatMap((panel) => {
    if (!panel.repeat || isRow(panel)) return [panel];
    const copies = repeatOptions(panel.repeat, ctx);
    const vertical = panel.repeatDirection === 'v';
    const perRow = vertical ? 1 : Math.max(1, panel.maxPerRow ?? 4);
    const w = vertical ? panel.gridPos.w : Math.max(GRID_COLUMNS / copies.length, GRID_COLUMNS / perRow);
    return copies.map((o, i) => ({
      ...panel,
      gridPos: { ...panel.gridPos, w, x: (i % perRow) * w, y: panel.gridPos.y + Math.floor(i / perRow) / 1000 },
      scopedVars: { ...panel.scopedVars, [panel.repeat!]: o },
    }));
  });
}

/** Stable key for a panel or row copy: its id plus the values it was repeated for. */
export function panelKey(panel: Panel): string {
  const base = String(panel.id ?? panel.title ?? panel.type);
  const scoped = Object.entries(panel.scopedVars ?? {});
  return scoped.length ? `${base}:${scoped.map(([k, o]) => `${k}=${o.value}`).join('&')}` : base;
}

export function panelSpan(panel: Panel, mode: LayoutMode): number {
  if (mode === 'grid') return clampSpan(panel.gridPos.w);
  if (panel.mobile?.span) return clampSpan(panel.mobile.span);
  return panel.gridPos.w <= 6 ? GRID_COLUMNS / 2 : GRID_COLUMNS;
}

function packRows(panels: Panel[], mode: LayoutMode): LayoutRow[] {
  const rows: LayoutRow[] = [];
  let current: LayoutCell[] = [];
  let used = 0;

  const flush = () => {
    if (!current.length) return;
    if (mode === 'phone' && used < GRID_COLUMNS) stretch(current, GRID_COLUMNS - used);
    rows.push({ cells: current, h: Math.max(...current.map((c) => panelHeight(c.panel, mode))) });
    current = [];
    used = 0;
  };

  for (const panel of panels) {
    if (mode === 'phone' && panel.mobile?.hidden) continue;
    const span = panelSpan(panel, mode);
    if (used + span > GRID_COLUMNS) flush();
    current.push({ key: panelKey(panel), panel, span });
    used += span;
  }
  flush();
  return rows;
}

function panelHeight(panel: Panel, mode: LayoutMode): number {
  return Math.max(1, (mode === 'phone' ? panel.mobile?.h : undefined) ?? panel.gridPos.h);
}

/** Distribute leftover columns so a partially-filled phone row still spans the screen. */
function stretch(cells: LayoutCell[], extra: number) {
  const each = Math.floor(extra / cells.length);
  cells.forEach((c, i) => (c.span += each + (i < extra % cells.length ? 1 : 0)));
}

const clampSpan = (n: number) => Math.min(GRID_COLUMNS, Math.max(1, Math.round(n)));
