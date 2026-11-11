import type { DataSource, QueryRequest } from './datasource';
import type { DataFrame } from './frame';
import type { Entry, NewEntry } from './inputs';
import type { DataSourceRef, Target } from './schema';
import { addTime, parseDuration, startOf, type TimeUnit } from './time';

/**
 * A datasource over entries recorded by input forms. Reference it from a panel with
 * `"datasource": {"type": "modelform-local"}` and targets like:
 *
 *   { "refId": "A", "metric": "weight" }                                   raw points
 *   { "refId": "A", "metric": "water", "aggregate": "sum", "bucket": "1d" } daily totals
 *   { "refId": "A", "metric": "mood", "aggregate": "count", "groupBy": "text" }  one series per choice
 */

export const LOCAL_DATASOURCE_TYPE = 'modelform-local';

/** The type this datasource had before the library was named modelform. Still read, never written. */
const LEGACY_LOCAL_DATASOURCE_TYPE = 'dashkit-local';

/** Whether a panel or target's datasource is the local one, under its current name or its old one. */
export function isLocalDatasource(ref: DataSourceRef | string | null | undefined): boolean {
  return typeof ref === 'object' && ref != null && (ref.type === LOCAL_DATASOURCE_TYPE || ref.type === LEGACY_LOCAL_DATASOURCE_TYPE);
}

export interface EntryStore {
  add(entries: NewEntry[]): Promise<Entry[]>;
  list(query: { metrics: string[]; from?: number; to?: number }): Promise<Entry[]>;
  latest(metric: string): Promise<Entry | undefined>;
  remove(id: string): Promise<void>;
  /**
   * Remove `ids` and add `entries` as one change, so an edited record is never left half
   * saved. Stores without it get a remove of each id followed by an add.
   */
  replace?(ids: string[], entries: NewEntry[]): Promise<Entry[]>;
  /** Subscribe to changes so panels can refresh after a save. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

export type Aggregate = 'none' | 'sum' | 'avg' | 'min' | 'max' | 'count' | 'last';

export interface LocalTarget extends Target {
  metric: string;
  aggregate?: Aggregate;
  /** Bucket size such as "1h", "1d", "1w", "1M", or "auto" to follow the panel's interval. */
  bucket?: string;
  /** "text" splits into one series per distinct text value (e.g. select choices). */
  groupBy?: 'text';
  /** Fill empty buckets with 0. Defaults to true for sum/count. */
  fillZero?: boolean;
  /**
   * Raw points only: "previous" treats each value as holding until the next one, for settings
   * recorded only when they change. The series starts at the range start with the value in
   * effect then and ends at the range end (or now) with the latest value.
   */
  fill?: 'previous';
  /** Display name for the series. */
  alias?: string;
}

export interface LocalDataSourceOptions {
  /**
   * Display name for a `groupBy: "text"` series, for text that's an id into app data
   * (e.g. a tire set id → its name). Return undefined to keep the text.
   */
  label?(metric: string, text: string): string | undefined;
}

export class LocalDataSource implements DataSource {
  constructor(
    private readonly store: EntryStore,
    private readonly options: LocalDataSourceOptions = {},
  ) {}

  async query(request: QueryRequest): Promise<DataFrame[]> {
    // A target without a metric has nothing to read (a half-written config, say).
    const targets = (request.targets as LocalTarget[]).filter((t) => typeof t.metric === 'string' && t.metric);
    const entries = await this.store.list({
      metrics: [...new Set(targets.map((t) => t.metric).filter(Boolean))],
      from: request.range.from,
      to: request.range.to,
    });
    // fill: previous also needs the value in effect when the range starts.
    const carried = targets.filter((t) => t.fill === 'previous' && (t.aggregate ?? 'none') === 'none' && !t.groupBy).map((t) => t.metric);
    const before = carried.length ? await this.store.list({ metrics: [...new Set(carried)], to: request.range.from - 1 }) : [];
    return targets.flatMap((t) => {
      const own = entries.filter((e) => e.metric === t.metric);
      const prior = carried.includes(t.metric) ? before.filter((e) => e.metric === t.metric && e.value != null).at(-1) : undefined;
      return buildFrames(t, prior ? [prior, ...own] : own, request, this.options.label);
    });
  }
}

export function buildFrames(
  target: LocalTarget,
  entries: Entry[],
  request: Pick<QueryRequest, 'range' | 'intervalMs'>,
  label?: LocalDataSourceOptions['label'],
): DataFrame[] {
  const sorted = [...entries].sort((a, b) => a.ts - b.ts);
  const groups = new Map<string | undefined, Entry[]>();
  for (const e of sorted) {
    const key = target.groupBy === 'text' ? e.text ?? String(e.value) : undefined;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  if (!groups.size && target.groupBy !== 'text') groups.set(undefined, []);

  const aggregate = target.aggregate ?? (target.groupBy === 'text' ? 'count' : 'none');
  const name = target.alias ?? target.metric;

  return [...groups].map(([group, rows]) => {
    let times: number[];
    let values: (number | null)[];
    if (aggregate === 'none') {
      const points = rows.filter((e) => target.fill !== 'previous' || e.value != null);
      times = points.map((e) => e.ts);
      values = points.map((e) => e.value);
      if (target.fill === 'previous' && group == null && values.length) {
        const { from, to } = request.range;
        if (times[0] < from) times[0] = from;
        const end = Math.min(to, Date.now());
        if (times[times.length - 1] < end) {
          times.push(end);
          values.push(values[values.length - 1]);
        }
      }
    } else {
      const bucket = !target.bucket || target.bucket === 'auto' ? request.intervalMs : target.bucket;
      const fill = target.fillZero ?? (aggregate === 'sum' || aggregate === 'count');
      ({ times, values } = bucketize(rows, aggregate, bucket, request.range, fill));
    }
    const display = group == null ? name : label?.(target.metric, group) ?? group;
    return {
      name,
      refId: target.refId,
      fields: [
        { name: 'Time', type: 'time', values: times },
        {
          name: display,
          type: 'number',
          values,
          labels: group != null ? { [target.metric]: group } : undefined,
          config: { displayName: display },
        },
      ],
    } satisfies DataFrame;
  });
}

function bucketize(
  rows: Entry[],
  aggregate: Exclude<Aggregate, 'none'>,
  bucket: string | number,
  range: { from: number; to: number },
  fillZero: boolean,
) {
  const step = bucketStepper(bucket);
  const sums = new Map<number, number[]>();
  for (const e of rows) {
    const key = step.floor(e.ts);
    const v = aggregate === 'count' ? 1 : e.value;
    if (v == null) continue;
    sums.set(key, [...(sums.get(key) ?? []), v]);
  }

  const keys = fillZero ? step.range(range.from, range.to) : [...sums.keys()].sort((a, b) => a - b);
  const values = keys.map((k) => {
    const vs = sums.get(k);
    if (!vs?.length) return fillZero ? 0 : null;
    switch (aggregate) {
      case 'sum':
      case 'count':
        return vs.reduce((a, b) => a + b, 0);
      case 'avg':
        return vs.reduce((a, b) => a + b, 0) / vs.length;
      case 'min':
        return Math.min(...vs);
      case 'max':
        return Math.max(...vs);
      case 'last':
        return vs[vs.length - 1];
    }
  });
  return { times: keys, values };
}

/** Calendar-aware buckets for 1d/1w/1M/1y (respecting local midnight and DST); fixed-width otherwise. */
function bucketStepper(bucket: string | number) {
  const m = typeof bucket === 'string' ? /^1([dwMy])$/.exec(bucket) : null;
  if (m) {
    const unit = m[1] as TimeUnit;
    const floor = (t: number) => startOf(new Date(t), unit).getTime();
    return {
      floor,
      range(from: number, to: number) {
        const out: number[] = [];
        for (let t = floor(from); t <= to; t = addTime(new Date(t), 1, unit).getTime()) out.push(t);
        return out;
      },
    };
  }
  const size = typeof bucket === 'number' ? bucket : parseDuration(bucket);
  const offset = new Date().getTimezoneOffset() * 60_000;
  const floor = (t: number) => Math.floor((t - offset) / size) * size + offset;
  return {
    floor,
    range(from: number, to: number) {
      const out: number[] = [];
      for (let t = floor(from); t <= to && out.length < 5000; t += size) out.push(t);
      return out;
    },
  };
}

/** In-memory EntryStore for tests, previews and web. */
export class MemoryEntryStore implements EntryStore {
  private entries: Entry[] = [];
  private listeners = new Set<() => void>();
  private nextId = 1;

  constructor(seed: NewEntry[] = []) {
    this.entries = seed.map((e) => ({ ...e, id: String(this.nextId++) }));
  }

  async add(entries: NewEntry[]) {
    const added = entries.map((e) => ({ ...e, id: String(this.nextId++) }));
    this.entries.push(...added);
    this.emit();
    return added;
  }

  async list({ metrics, from = -Infinity, to = Infinity }: { metrics: string[]; from?: number; to?: number }) {
    return this.entries.filter((e) => metrics.includes(e.metric) && e.ts >= from && e.ts <= to).sort((a, b) => a.ts - b.ts);
  }

  async latest(metric: string) {
    return this.entries.filter((e) => e.metric === metric).sort((a, b) => b.ts - a.ts)[0];
  }

  async remove(id: string) {
    this.entries = this.entries.filter((e) => e.id !== id);
    this.emit();
  }

  async replace(ids: string[], entries: NewEntry[]) {
    const added = entries.map((e) => ({ ...e, id: String(this.nextId++) }));
    this.entries = [...this.entries.filter((e) => !ids.includes(e.id)), ...added];
    this.emit();
    return added;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }
}
