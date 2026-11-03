import { fieldDisplayName, numberFields, toMillis, toSeries, toXYSeries, uniqueNames, type DataFrame, type Field, type Series } from '../core/frame';
import { resolveFieldConfig } from '../core/fieldconfig';
import { formatValue, mappedResult, resolveColor, seriesColor, thresholdStep } from '../core/format';
import { reduce } from '../core/reduce';
import type { FieldConfig, MappingResult, Panel } from '../core/schema';

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

export interface BarAxis {
  side: 'left' | 'right';
  /** Indexes of the fields scaled against this axis. */
  fields: number[];
  ticks: number[];
  /** The value at the top of the plot. */
  top: number;
  /** The value at the bottom of the plot: 0 unless a value or `min` is negative, or `min` raises it. */
  bottom: number;
  /** Config of the axis's first field, for tick formatting. */
  config: FieldConfig;
  /** `custom.axisLabel` of the axis's first field that has one. */
  label?: string;
  /** False when every field on the axis has `custom.axisPlacement: "hidden"`. */
  show: boolean;
}

/**
 * Bar chart y axes. Fields with `custom.axisPlacement: "right"` share a right axis with its own scale; every other
 * field shares the left one. Each axis runs from 0 (or min) to a round number above its tallest bar (or max).
 */
export function barAxes(configs: FieldConfig[], values: (number | null)[][], tickCount: number): BarAxis[] {
  const placement = (c: FieldConfig) => c.custom?.axisPlacement as string | undefined;
  const sides: ('left' | 'right')[] = ['left', 'right'];
  return sides.flatMap((side) => {
    const fields = configs.map((_, i) => i).filter((i) => (placement(configs[i]) === 'right') === (side === 'right'));
    if (!fields.length) return [];
    const config = configs[fields[0]];
    const all = fields.flatMap((i) => values[i].map((v) => v ?? 0));
    const max = Math.max(0, ...all);
    // Bars grow from 0, so the axis includes it unless `min` sets a floor above it.
    const min = config.min ?? Math.min(0, ...all);
    // An empty or all-zero axis still gets a 0..1 scale rather than ticks around zero.
    const ticks = niceTicks(min, config.max ?? Math.max(max, min + 1), tickCount);
    const top = config.max ?? ticks[ticks.length - 1];
    const bottom = config.min ?? ticks[0];
    return [
      {
        side,
        fields,
        // A max that isn't a round number cuts the top tick off rather than drawing it above the plot.
        ticks: ticks.filter((t) => t <= top && t >= bottom),
        top,
        bottom,
        config,
        label: fields.map((i) => configs[i].custom?.axisLabel as string | undefined).find((l) => !!l),
        show: fields.some((i) => placement(configs[i]) !== 'hidden'),
      },
    ];
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
  /** The value as shown: its value mapping's text, else formatted with the field's unit. */
  text: string;
  /** The value mapping that matched, if any. */
  mapped?: MappingResult;
  /** A matching value mapping's color, else the threshold color when thresholds are configured, else the series color. */
  stateColor: string;
  sparkline: (number | null)[];
  /** Where the value came from, for data links. */
  field: Field;
  frame: DataFrame;
}

/** One value per numeric field, reduced with the panel's reduceOptions.calcs. Used by stat/gauge/bargauge/pie. */
export function reducedValues(panel: Panel, frames: DataFrame[], scheme: 'light' | 'dark'): ReducedValue[] {
  const calc = panel.options?.reduceOptions?.calcs?.[0] ?? 'lastNotNull';
  const out: ReducedValue[] = [];
  const multiple = frames.length > 1;
  frames.forEach((frame, fi) =>
    numberFields(frame).forEach((field) => {
      const raw = fieldDisplayName(field, frame, multiple);
      const config = resolveFieldConfig(panel, field, frame, raw);
      const values = field.values.map((v) => (v == null ? null : Number(v)));
      const value = reduce(values, calc);
      const color = seriesColor(out.length, scheme, config);
      const step = thresholdStep(value, config);
      const mapped = mappedResult(value, config);
      out.push({
        key: `${fi}/${field.name}/${JSON.stringify(field.labels ?? {})}`,
        name: config.displayName ?? raw,
        value,
        text: mapped?.text || formatValue(value, config),
        mapped,
        config,
        color,
        stateColor: mapped?.color ? resolveColor(mapped.color, color) : step ? resolveColor(step.color, color) : color,
        sparkline: values,
        field,
        frame,
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

/** Where a value sits on a bar axis, from 0 (bottom of the plot) to 1 (top). */
export function barFraction(axis: Pick<BarAxis, 'top' | 'bottom'>, v: number): number {
  return Math.min(1, Math.max(0, (v - axis.bottom) / (axis.top - axis.bottom || 1)));
}
