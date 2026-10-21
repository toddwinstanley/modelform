import type { DataFrame } from '../core/frame';
import { fieldDisplayName, numberFields, toMillis, toSeries, toXYSeries, uniqueNames, type Field, type Series } from '../core/frame';
import { resolveFieldConfig } from '../core/fieldconfig';
import { seriesColor, thresholdStep, resolveColor } from '../core/format';
import { reduce } from '../core/reduce';
import type { FieldConfig, Panel } from '../core/schema';

/** Clean tick values spanning [min, max]: 0 / 250 / 500 rather than 0 / 233 / 466. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const rough = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) ?? rough;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  // Keep stepping until the data max is covered, so the top tick never clips the tallest mark.
  for (let t = start; ticks.length === 0 || ticks[ticks.length - 1] < max; t += step) ticks.push(Number(t.toFixed(10)));
  return ticks;
}

/** Decimals needed so adjacent tick labels never collide (step 0.05 → 2). */
export function tickDecimals(ticks: number[]): number {
  return Math.max(0, ...ticks.map((t) => (String(t).split('.')[1] ?? '').length));
}

export function linearScale(d0: number, d1: number, r0: number, r1: number) {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v: number) => r0 + (v - d0) * k;
}

export function formatTimeTick(t: number, spanMs: number): string {
  const d = new Date(t);
  if (spanMs <= 2 * 86_400_000) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (spanMs <= 180 * 86_400_000) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
}

/** The field a bar chart groups by: `options.xField`, else the first string field, else the first time field. */
export function barCategory(panel: Panel, frame: DataFrame): Field | undefined {
  const xField: string | undefined = panel.options?.xField;
  if (xField) return frame.fields.find((f) => f.name === xField);
  return frame.fields.find((f) => f.type === 'string') ?? frame.fields.find((f) => f.type === 'time');
}

/** Bar chart category labels. Times are dates, or times of day when the bars are less than a day apart. */
export function categoryLabels(field: Field): string[] {
  if (field.type !== 'time') return field.values.map((v) => (v == null ? '' : String(v)));
  const times = field.values.map((v) => (v == null ? null : toMillis(v)));
  let step = Infinity;
  times.forEach((t, i) => {
    const prev = times[i - 1];
    if (t != null && prev != null && t !== prev) step = Math.min(step, Math.abs(t - prev));
  });
  return times.map((t) => {
    if (t == null) return '';
    const d = new Date(t);
    if (step < 86_400_000) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    if (step < 28 * 86_400_000) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  });
}

export function formatTooltipTime(t: number): string {
  return new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export interface StyledSeries extends Series {
  color: string;
  config: FieldConfig;
}

/** Time series with resolved config and colors in fixed palette order. */
export function styledSeries(panel: Panel, frames: DataFrame[], scheme: 'light' | 'dark'): StyledSeries[] {
  return styleSeries(panel, toSeries(frames), frames, scheme);
}

/** Series against the panel's numeric x field (`options.xField`), with that field's resolved config for axis labels. */
export function styledXYSeries(panel: Panel, frames: DataFrame[], scheme: 'light' | 'dark'): { series: StyledSeries[]; xConfig: FieldConfig } {
  const { series, x } = toXYSeries(frames, panel.options?.xField || undefined);
  const xConfig = x ? resolveFieldConfig(panel, x.field, x.frame, x.field.name) : {};
  return { series: styleSeries(panel, series, frames, scheme), xConfig };
}

function styleSeries(panel: Panel, series: Series[], frames: DataFrame[], scheme: 'light' | 'dark'): StyledSeries[] {
  const frameOf = new Map<Series['field'], DataFrame>();
  frames.forEach((f) => f.fields.forEach((field) => frameOf.set(field, f)));
  return series.map((s, i) => {
    const config = resolveFieldConfig(panel, s.field, frameOf.get(s.field)!, s.name);
    return { ...s, name: config.displayName ?? s.name, config, color: seriesColor(i, scheme, config) };
  });
}

export interface ReducedValue {
  key: string;
  name: string;
  value: number | null;
  config: FieldConfig;
  /** Series color (palette or fixed). */
  color: string;
  /** Threshold color when thresholds are configured, else the series color. */
  stateColor: string;
  sparkline: Array<number | null>;
}

/** One value per numeric field, reduced with the panel's reduceOptions.calcs. Used by stat/gauge/bargauge/pie. */
export function reducedValues(panel: Panel, frames: DataFrame[], scheme: 'light' | 'dark'): ReducedValue[] {
  const calc = panel.options?.reduceOptions?.calcs?.[0] ?? 'lastNotNull';
  const out: Array<ReducedValue & { field: Field }> = [];
  const multiple = frames.length > 1;
  frames.forEach((frame, fi) =>
    numberFields(frame).forEach((field) => {
      const raw = fieldDisplayName(field, frame, multiple);
      const config = resolveFieldConfig(panel, field, frame, raw);
      const values = field.values.map((v) => (v == null ? null : Number(v)));
      const value = reduce(values, calc);
      const color = seriesColor(out.length, scheme, config);
      const step = thresholdStep(value, config);
      out.push({
        key: `${fi}/${field.name}/${JSON.stringify(field.labels ?? {})}`,
        name: config.displayName ?? raw,
        value,
        config,
        color,
        stateColor: step ? resolveColor(step.color, color) : color,
        sparkline: values,
        field,
      });
    }),
  );
  return uniqueNames(out, (v) => v.field, frames);
}

/** y-domain from config min/max, falling back to the data (including 0 for bars). */
export function yDomain(series: StyledSeries[], includeZero: boolean): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const s of series) {
    for (const v of s.values) {
      if (v == null) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (min === Infinity) return [0, 1];
  if (includeZero) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  const cfgMin = series.find((s) => s.config.min != null)?.config.min;
  const cfgMax = series.find((s) => s.config.max != null)?.config.max;
  return [cfgMin ?? min, cfgMax ?? max];
}
