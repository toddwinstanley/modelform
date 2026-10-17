import type { Dashboard, Panel } from './schema';

/**
 * Converts Grafana's 24-column absolute grid into rows that reflow on a phone.
 *
 * Grafana positions panels absolutely (gridPos x/y/w/h). A phone can't show that
 * faithfully, so panels are taken in reading order (y, then x) and packed into
 * rows. In "phone" mode small panels (w <= 6, e.g. stat tiles) go two-up and
 * everything else is full width; `panel.mobile` overrides either. In "grid"
 * mode (tablets) the original widths are kept.
 */

export const GRID_COLUMNS = 24;
const CELL_HEIGHT = 30;
const CELL_MARGIN = 8;

export type LayoutMode = 'phone' | 'grid';

export interface LayoutCell {
  panel: Panel;
  /** Columns out of 24. */
  span: number;
}

export interface LayoutRow {
  cells: LayoutCell[];
  /** Height in grid units. */
  h: number;
}

export interface LayoutSection {
  key: string;
  /** The Grafana "row" panel heading this section, if any. */
  row?: Panel;
  collapsed: boolean;
  rows: LayoutRow[];
}

/** Grafana's pixel height for h grid units. */
export const gridUnitsToPx = (h: number) => h * CELL_HEIGHT + (h - 1) * CELL_MARGIN;

export const isRow = (p: Panel) => p.type === 'row';

const byPosition = (a: Panel, b: Panel) => a.gridPos.y - b.gridPos.y || a.gridPos.x - b.gridPos.x;

export function layoutDashboard(dashboard: Dashboard, mode: LayoutMode = 'phone'): LayoutSection[] {
  const sections: Array<{ row?: Panel; children: Panel[] }> = [{ children: [] }];

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
    .map((s, i) => ({
      key: s.row ? `row-${s.row.id ?? i}` : `section-${i}`,
      row: s.row,
      collapsed: !!s.row?.collapsed,
      rows: packRows(s.children.sort(byPosition), mode),
    }));
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
    current.push({ panel, span });
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
