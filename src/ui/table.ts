import { resolveFieldConfig } from '../core/fieldconfig';
import { fieldDisplayName, toMillis, type DataFrame, type Field } from '../core/frame';
import { formatValue, mappedResult, resolveColor, thresholdStep, valueColor } from '../core/format';
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
    if (custom.hidden) return [];
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
      },
    ];
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
