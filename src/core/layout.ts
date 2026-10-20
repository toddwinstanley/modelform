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

/** Current variable values and options; without them repeated rows and panels render once, unrepeated. */
export interface RepeatContext {
  values: VariableValues;
  info: Record<string, VariableInfo>;
}

export function layoutDashboard(dashboard: Dashboard, mode: LayoutMode = 'phone', repeat?: RepeatContext): LayoutSection[] {
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
    .map((s) => ({
      key: s.key,
      row: s.row,
      collapsed: !!s.row?.collapsed,
      rows: packRows(expandPanelRepeats(s.children, repeat).sort(byPosition), mode),
    }));
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
