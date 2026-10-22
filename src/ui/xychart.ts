import { fieldMatches, resolveFieldConfig } from '../core/fieldconfig';
import { fieldDisplayName, toMillis, type DataFrame, type Field } from '../core/frame';
import { seriesColor, valueColor } from '../core/format';
import type { FieldConfig, Panel } from '../core/schema';

type Matcher = { id: string; options?: unknown };
type Pick = { matcher: Matcher } | undefined;

/** One xychart series in Grafana's current (v2) options shape. */
interface SeriesMapping {
  frame?: Pick;
  x?: Pick;
  y?: Pick;
  color?: Pick;
  size?: Pick;
  name?: { fixed?: string };
  /** Pre-Grafana 11 dashboards keep the size range on the series rather than in custom.pointSize. */
  sizeRange?: { fixed?: number; min?: number; max?: number };
}

export type XYShow = 'points' | 'lines' | 'points+lines';

export interface XYSeries {
  key: string;
  name: string;
  /** Legend and line color. */
  color: string;
  frame: DataFrame;
  xField: Field;
  yField: Field;
  xConfig: FieldConfig;
  yConfig: FieldConfig;
  /** Row indexes with both x and y set, in data order. */
  rows: number[];
  xs: number[];
  ys: number[];
  /** Per point, parallel to rows. */
  colors: string[];
  /** Point diameters in px, parallel to rows. */
  sizes: number[];
  show: XYShow;
  lineWidth: number;
}

const byName = (name: unknown): Pick => (name ? { matcher: { id: 'byName', options: name } } : undefined);

/**
 * The panel's series mappings in the v2 shape. Dashboards saved before Grafana 11 use `seriesMapping`,
 * `dims` and per-series `x`/`y` names instead; those are converted.
 */
function mappings(panel: Panel): { manual: boolean; series: SeriesMapping[]; exclude: string[] } {
  const o = panel.options ?? {};
  if (o.seriesMapping != null || o.dims != null) {
    const frame = (i: unknown): Pick => (typeof i === 'number' ? { matcher: { id: 'byIndex', options: i } } : undefined);
    if (o.seriesMapping === 'manual') {
      const series = (o.series ?? []).map((s: any) => ({
        frame: frame(s.frame),
        x: byName(s.x),
        y: byName(s.y),
        color: byName(s.pointColor?.field),
        size: byName(s.pointSize?.field),
        sizeRange: s.pointSize,
        name: { fixed: s.name },
      }));
      return { manual: true, series, exclude: [] };
    }
    return { manual: false, series: [{ frame: frame(o.dims?.frame), x: byName(o.dims?.x) }], exclude: o.dims?.exclude ?? [] };
  }
  return { manual: o.mapping === 'manual', series: o.series ?? [], exclude: [] };
}

const isNumeric = (f: Field) => f.type === 'number' || f.type === 'time';

export function xySeries(panel: Panel, frames: DataFrame[], scheme: 'light' | 'dark'): XYSeries[] {
  const { manual, series: maps, exclude } = mappings(panel);
  const multiple = frames.length > 1;
  const out: XYSeries[] = [];
  const config = (field: Field, frame: DataFrame) => resolveFieldConfig(panel, field, frame, fieldDisplayName(field, frame, multiple));
  const find = (pick: Pick, frame: DataFrame, fields = frame.fields) =>
    pick ? fields.filter((f) => fieldMatches(pick.matcher, f, frame, fieldDisplayName(f, frame, multiple))) : [];

  for (const [mi, m] of (maps.length ? maps : [{}]).entries()) {
    const matcher = m.frame?.matcher;
    const chosen = matcher?.id === 'byIndex' ? frames.filter((_, i) => i === matcher.options) : frames;
    for (const frame of chosen) {
      const numeric = frame.fields.filter(isNumeric);
      const xField = find(m.x, frame, numeric)[0] ?? numeric[0];
      if (!xField) continue;
      const colorField = find(m.color, frame, numeric)[0];
      const sizeField = find(m.size, frame, numeric)[0];
      const used = new Set([xField, colorField, sizeField]);
      // A series plots the y fields its matcher picks; auto mode without one plots every other numeric field.
      const yFields = m.y
        ? find(m.y, frame, numeric).filter((f) => f !== xField)
        : manual
          ? []
          : numeric.filter((f) => !used.has(f) && !exclude.includes(f.name));

      for (const yField of yFields) {
        const yConfig = config(yField, frame);
        if ((yConfig.custom?.hideFrom as { viz?: boolean } | undefined)?.viz && !manual) continue;
        const xConfig = config(xField, frame);
        const color = seriesColor(out.length, scheme, yConfig);
        const base = yConfig.color?.mode === 'thresholds' ? valueColor(null, yConfig, color) : color;
        const rows: number[] = [];
        const xs: number[] = [];
        const ys: number[] = [];
        yField.values.forEach((yv, i) => {
          const xv = xField.values[i];
          if (xv == null || yv == null) return;
          const xn = xField.type === 'time' ? toMillis(xv) : Number(xv);
          const yn = yField.type === 'time' ? toMillis(yv) : Number(yv);
          if (!Number.isFinite(xn) || !Number.isFinite(yn)) return;
          rows.push(i);
          xs.push(xn);
          ys.push(yn);
        });

        const pointSize = yConfig.custom?.pointSize as { fixed?: number; min?: number; max?: number } | undefined;
        const fixedSize = m.sizeRange?.fixed ?? pointSize?.fixed ?? 5;
        let colors = rows.map(() => base);
        if (colorField) {
          const cConfig = config(colorField, frame);
          const values = rows.map((i) => num(colorField.values[i]));
          const extent = range(values);
          colors = values.map((v) => valueColor(v, cConfig, base, extent));
        }
        let sizes = rows.map(() => fixedSize);
        if (sizeField) {
          const values = rows.map((i) => num(sizeField.values[i]));
          const [lo, hi] = range(values) ?? [0, 1];
          const [min, max] = [m.sizeRange?.min ?? pointSize?.min ?? 5, m.sizeRange?.max ?? pointSize?.max ?? 20];
          sizes = values.map((v) => (v == null ? min : min + ((v - lo) / (hi - lo || 1)) * (max - min)));
        }

        const fixedName = m.name?.fixed;
        const yName = yConfig.displayName ?? fieldDisplayName(yField, frame, multiple);
        out.push({
          key: `${mi}/${frames.indexOf(frame)}/${yField.name}`,
          name: fixedName ? (yFields.length > 1 ? `${fixedName} ${yName}` : fixedName) : yName,
          color: base,
          frame,
          xField,
          yField,
          xConfig,
          yConfig,
          rows,
          xs,
          ys,
          colors,
          sizes,
          show: (yConfig.custom?.show as XYShow | undefined) ?? 'points',
          lineWidth: (yConfig.custom?.lineWidth as number | undefined) ?? 1,
        });
      }
    }
  }
  return out;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function range(values: (number | null)[]): [number, number] | undefined {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v == null) continue;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return lo === Infinity ? undefined : [lo, hi];
}

/** [min, max] of an axis: the field config's min/max where set, else the data's, padded so no point sits on the edge. */
export function xyDomain(values: number[][], config: FieldConfig): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const vs of values) {
    for (const v of vs) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  if (lo === Infinity) return [config.min ?? 0, config.max ?? 1];
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.05;
  return [config.min ?? lo - pad, config.max ?? hi + pad];
}
