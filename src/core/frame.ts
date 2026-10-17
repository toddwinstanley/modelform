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

/** One plottable line: a numeric field paired with its frame's time field. */
export interface Series {
  key: string;
  name: string;
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
