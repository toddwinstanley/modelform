import type { FieldConfig } from './schema';

/** Column-oriented data, matching Grafana's data frame model so Grafana query results map 1:1. */
export type FieldType = 'time' | 'number' | 'string' | 'boolean' | 'other';

export interface Field {
  name: string;
  type: FieldType;
  values: unknown[];
  labels?: Record<string, string>;
  config?: FieldConfig;
}

export interface DataFrame {
  name?: string;
  refId?: string;
  fields: Field[];
}

export const frameLength = (frame: DataFrame) => frame.fields[0]?.values.length ?? 0;

export const timeField = (frame: DataFrame) => frame.fields.find((f) => f.type === 'time');

export const numberFields = (frame: DataFrame) => frame.fields.filter((f) => f.type === 'number');

/** One plottable line: a numeric field paired with its frame's time field (or, for toXYSeries, its x field). */
export interface Series {
  key: string;
  name: string;
  /** x positions: epoch ms for time series, the x field's values for toXYSeries. */
  times: number[];
  values: Array<number | null>;
  field: Field;
}

/** Display name the way Grafana derives it: config.displayName, then labels, then frame/field names. */
export function fieldDisplayName(field: Field, frame: DataFrame, multipleFrames: boolean): string {
  if (field.config?.displayName) return field.config.displayName;
  // Set by Grafana's backend from e.g. Prometheus legendFormat.
  if (typeof field.config?.displayNameFromDS === 'string') return field.config.displayNameFromDS;
  const labels = field.labels && Object.entries(field.labels);
  if (labels && labels.length) {
    if (labels.length === 1) return labels[0][1];
    return `{${labels.map(([k, v]) => `${k}="${v}"`).join(', ')}}`;
  }
  if (frame.name && multipleFrames) return frame.name;
  if (field.name && field.name !== 'Value' && field.name !== 'value') return field.name;
  return frame.name ?? frame.refId ?? field.name;
}

/** Flatten frames into time series (one per numeric field). Frames without a time field are skipped. */
export function toSeries(frames: DataFrame[]): Series[] {
  const out: Series[] = [];
  const multiple = frames.length > 1;
  frames.forEach((frame, fi) => {
    const time = timeField(frame);
    if (!time) return;
    const times = time.values.map(toMillis);
    for (const field of numberFields(frame)) {
      out.push({
        key: `${frame.refId ?? fi}/${field.name}/${JSON.stringify(field.labels ?? {})}`,
        name: fieldDisplayName(field, frame, multiple),
        times,
        values: field.values.map((v) => (v == null || Number.isNaN(Number(v)) ? null : Number(v))),
        field,
      });
    }
  });
  return uniqueNames(out, (s) => s.field, frames);
}

/**
 * Series against a numeric x field, as Grafana's "trend" panel plots them: x is the field named
 * `xField` (in frames that have it), else each frame's first number field; every other number
 * field is a series. Points are put in x order, since the line is drawn left to right.
 */
export function toXYSeries(frames: DataFrame[], xField?: string): { series: Series[]; x?: { field: Field; frame: DataFrame } } {
  const out: Series[] = [];
  let x: { field: Field; frame: DataFrame } | undefined;
  const multiple = frames.length > 1;
  frames.forEach((frame, fi) => {
    const nums = numberFields(frame);
    const xf = xField ? frame.fields.find((f) => f.name === xField) : nums[0];
    if (!xf) return;
    x ??= { field: xf, frame };
    const xs = xf.values.map((v) => (v == null ? NaN : Number(v)));
    const order = xs.map((_, i) => i).filter((i) => !Number.isNaN(xs[i]));
    if (order.some((i, k) => k > 0 && xs[i] < xs[order[k - 1]])) order.sort((a, b) => xs[a] - xs[b]);
    for (const field of nums) {
      if (field === xf) continue;
      out.push({
        key: `${frame.refId ?? fi}/${field.name}/${JSON.stringify(field.labels ?? {})}`,
        name: fieldDisplayName(field, frame, multiple),
        times: order.map((i) => xs[i]),
        values: order.map((i) => {
          const v = field.values[i];
          return v == null || Number.isNaN(Number(v)) ? null : Number(v);
        }),
        field,
      });
    }
  });
  return { series: uniqueNames(out, (s) => s.field, frames), x };
}

/**
 * When display names collide (e.g. two frames with the same single label), qualify them with
 * the frame name, then fall back to numbering, so the legend never shows the same name twice.
 */
export function uniqueNames<T extends { name: string }>(items: T[], fieldOf: (item: T) => Field, frames: DataFrame[]): T[] {
  const counts = new Map<string, number>();
  items.forEach((i) => counts.set(i.name, (counts.get(i.name) ?? 0) + 1));
  if ([...counts.values()].every((c) => c === 1)) return items;
  const frameOf = (field: Field) => frames.find((f) => f.fields.includes(field));
  const seen = new Map<string, number>();
  return items.map((item) => {
    if (counts.get(item.name) === 1 || fieldOf(item).config?.displayName) return item;
    const frameName = frameOf(fieldOf(item))?.name;
    let name = frameName && frameName !== item.name ? `${frameName} ${item.name}` : item.name;
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    if (n > 1) name = `${name} (${n})`;
    return { ...item, name };
  });
}

export function toMillis(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  return new Date(String(v)).getTime();
}
