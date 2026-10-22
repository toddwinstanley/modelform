import { resolveFieldConfig } from '../core/fieldconfig';
import { fieldDisplayName, toMillis, type DataFrame, type Field } from '../core/frame';
import { formatValue, mappedResult, resolveColor, thresholdStep, valueColor } from '../core/format';
import { isReducer, reduce, REDUCER_LABELS } from '../core/reduce';
import type { FieldConfig, Panel } from '../core/schema';

export type CellType = 'auto' | 'color-text' | 'color-background' | 'gauge';

export interface TableColumn {
  key: string;
  field: Field;
  name: string;
  config: FieldConfig;
  width: number;
  align: 'left' | 'center' | 'right';
  cellType: CellType;
  /** color-background only: the whole row takes this column's color. */
  applyToRow: boolean;
  wrap: boolean;
  /** Numeric range of the column, for gauges and continuous colors without min/max. */
  extent?: [number, number];
  /** Footer calculations for this column (`custom.footer.reducers`, or the older `options.footer`). */
  reducers: string[];
}

export interface CellDisplay {
  text: string;
  /** Text color, for color-text cells. */
  color?: string;
  /** Cell (or row) background, for color-background cells. */
  background?: string;
  /** 0..1 fill, for gauge cells. */
  gauge?: number;
  gaugeColor?: string;
}

const DEFAULT_WIDTH = 120;

/** Grafana's cell types, including the pre-Grafana 10 `custom.displayMode` names. */
function cellType(config: FieldConfig): CellType {
  const custom = config.custom ?? {};
  const type = ((custom.cellOptions as { type?: string } | undefined)?.type ?? custom.displayMode) as string | undefined;
  if (type === 'color-text' || type === 'color-background' || type === 'gauge') return type;
  if (type === 'color-background-solid') return 'color-background';
  if (type === 'gradient-gauge' || type === 'lcd-gauge' || type === 'basic') return 'gauge';
  return 'auto';
}

/** The visible columns of a table frame, with each field's effective config. */
export function tableColumns(panel: Panel, frame: DataFrame, multipleFrames = false): TableColumn[] {
  return frame.fields.flatMap((field, i) => {
    const raw = fieldDisplayName(field, frame, multipleFrames);
    const config = resolveFieldConfig(panel, field, frame, raw);
    const custom = config.custom ?? {};
    // Grafana 13 renamed custom.hidden to custom.hideFrom.viz; dashboards may have either.
    if (custom.hidden || (custom.hideFrom as { viz?: boolean } | undefined)?.viz) return [];
    const numeric = field.type === 'number';
    const align = custom.align === 'left' || custom.align === 'center' || custom.align === 'right' ? custom.align : numeric ? 'right' : 'left';
    const type = cellType(config);
    return [
      {
        key: `${i}/${field.name}`,
        field,
        name: config.displayName ?? raw,
        config,
        width: Math.max(Number(custom.width) || DEFAULT_WIDTH, Number(custom.minWidth) || 0),
        align,
        cellType: type,
        applyToRow: type === 'color-background' && !!(custom.cellOptions as { applyToRow?: boolean } | undefined)?.applyToRow,
        wrap: !!(custom.cellOptions as { wrapText?: boolean } | undefined)?.wrapText,
        extent: numeric ? extentOf(field.values) : undefined,
        reducers: footerReducers(panel, config, [field.name, config.displayName ?? raw]),
      },
    ];
  });
}

/**
 * A column's footer calculations. Grafana 13 keeps them per field in `custom.footer.reducers`; older dashboards
 * have one panel-wide `options.footer`, which Grafana converts the same way: `countRows` becomes "countAll",
 * and `fields` limits the calculation to those columns.
 */
function footerReducers(panel: Panel, config: FieldConfig, names: string[]): string[] {
  const own = (config.custom?.footer as { reducers?: string[] } | undefined)?.reducers;
  if (own?.length) return own;
  const legacy = panel.options?.footer as { show?: boolean; reducer?: string[]; countRows?: boolean; fields?: string | string[] } | undefined;
  if (!legacy?.show) return [];
  const reducer = legacy.reducer?.length ? legacy.reducer : ['sum'];
  if (legacy.countRows && reducer[0] === 'count') return ['countAll'];
  const fields = Array.isArray(legacy.fields) ? legacy.fields : legacy.fields ? [legacy.fields] : [];
  return !fields.length || names.some((n) => fields.includes(n)) ? reducer : [];
}

export interface FooterLine {
  /** The calculation's name, shown when a column has more than one. */
  label?: string;
  text: string;
}

/**
 * Footer text per column, or null when no column has a footer. "countAll" (the total row count) is shown once,
 * in the first column that asks for it. Calculations that need numbers are left blank on text columns.
 */
export function tableFooter(columns: TableColumn[]): FooterLine[][] | null {
  if (!columns.some((c) => c.reducers.length)) return null;
  let counted = false;
  return columns.map((c) => {
    const reducers = c.reducers.filter((r) => r !== 'countAll' || !counted);
    const lines = reducers.flatMap((r): FooterLine[] => {
      if (r === 'countAll') {
        counted = true;
        return [{ label: 'Count', text: String(c.field.values.length) }];
      }
      if (!isReducer(r)) return [];
      const label = REDUCER_LABELS[r];
      if (r === 'count') return [{ label, text: String(c.field.values.length) }];
      if (c.field.type !== 'number') {
        if (r === 'distinctCount') return [{ label, text: String(new Set(c.field.values.filter((v) => v != null)).size) }];
        return [];
      }
      const value = reduce(c.field.values.map((v) => (v == null ? null : Number(v))), r);
      const counts = r === 'distinctCount' || r === 'changeCount';
      return [{ label, text: counts ? String(value ?? 0) : formatValue(value, c.config) }];
    });
    // A single calculation reads on its own, except a row count, which needs saying what it is.
    return lines.length === 1 && lines[0].label !== 'Count' ? [{ text: lines[0].text }] : lines;
  });
}

function extentOf(values: unknown[]): [number, number] | undefined {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v == null) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    lo = Math.min(lo, n);
    hi = Math.max(hi, n);
  }
  return lo === Infinity ? undefined : [lo, hi];
}

/**
 * How one cell reads: mapped text, else the value formatted with the field's unit and decimals, else `noValue`
 * for a null. Colored cell types take the mapping's color, else the thresholds' (or color scheme's).
 */
export function cellDisplay(col: TableColumn, raw: unknown, fallbackColor: string): CellDisplay {
  const { config, field } = col;
  const mapped = mappedResult(raw, config);
  const num = field.type === 'number' && raw != null && Number.isFinite(Number(raw)) ? Number(raw) : null;
  const text =
    mapped?.text ??
    (raw == null
      ? ((config.noValue as string | undefined) ?? '')
      : field.type === 'number'
        ? formatValue(num, config)
        : field.type === 'time'
          ? new Date(toMillis(raw)).toLocaleString()
          : String(raw));
  if (col.cellType === 'auto') return { text };

  // "text" is Grafana's name for the theme's text color: leave the cell uncolored rather than a fixed grey.
  const mode = config.color?.mode;
  const named = mapped?.color ?? (mode === 'fixed' ? config.color?.fixedColor : (!mode || mode === 'thresholds') && num != null ? thresholdStep(num, config)?.color : undefined);
  const color =
    named === 'text'
      ? undefined
      : mapped?.color
        ? resolveColor(mapped.color, fallbackColor)
        : num == null
          ? undefined
          : valueColor(num, config, fallbackColor, col.extent);
  if (col.cellType === 'color-text') return { text, color };
  if (col.cellType === 'color-background') return { text, background: color };
  const min = config.min ?? Math.min(0, col.extent?.[0] ?? 0);
  const max = config.max ?? col.extent?.[1] ?? 1;
  const gauge = num == null ? undefined : Math.min(1, Math.max(0, (num - min) / (max - min || 1)));
  return { text, gauge, gaugeColor: color };
}

/** Black or white, whichever reads better on a background color. */
export function contrastText(background: string, fallback: string): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(background);
  if (!m) return fallback;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.55 ? '#111111' : '#ffffff';
}

export interface TableSort {
  /** TableColumn.key */
  key: string;
  desc: boolean;
}

/** The panel's starting sort, from `options.sortBy` (matched by display name, as Grafana saves it). */
export function initialSort(panel: Panel, columns: TableColumn[]): TableSort | null {
  const first = (panel.options?.sortBy as { displayName?: string; desc?: boolean }[] | undefined)?.[0];
  const col = first?.displayName != null ? columns.find((c) => c.name === first.displayName || c.field.name === first.displayName) : undefined;
  return col ? { key: col.key, desc: !!first!.desc } : null;
}

/** Tapping a header: ascending, then descending, then back to the query's order. */
export function nextSort(current: TableSort | null, key: string): TableSort | null {
  if (current?.key !== key) return { key, desc: false };
  return current.desc ? null : { key, desc: true };
}

/**
 * Row indexes in display order. Numbers and times sort numerically, text naturally ("L9" before "L10"), and
 * empty cells go last either way. Ties keep the query's order.
 */
export function sortedRows(columns: TableColumn[], length: number, sort: TableSort | null): number[] {
  const rows = Array.from({ length }, (_, i) => i);
  const col = sort && columns.find((c) => c.key === sort.key);
  if (!col) return rows;
  const { field } = col;
  const dir = sort.desc ? -1 : 1;
  const key = (v: unknown) => (field.type === 'time' ? toMillis(v) : field.type === 'number' || field.type === 'boolean' ? Number(v) : v);
  const empty = (v: unknown) => v == null || v === '' || (typeof v === 'number' && Number.isNaN(v));
  return rows.sort((a, b) => {
    const va = field.values[a];
    const vb = field.values[b];
    if (empty(va) || empty(vb)) return empty(va) === empty(vb) ? a - b : empty(va) ? 1 : -1;
    const ka = key(va);
    const kb = key(vb);
    const cmp = typeof ka === 'number' && typeof kb === 'number' ? ka - kb : compareText(String(ka), String(kb));
    return cmp * dir || a - b;
  });
}

// Natural order where the runtime has Intl.Collator, plain string order where it doesn't.
const compareText: (a: string, b: string) => number =
  typeof Intl !== 'undefined' && typeof Intl.Collator === 'function'
    ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare
    : (a, b) => (a < b ? -1 : a > b ? 1 : 0);
