import type { DataSource, QueryRequest } from './datasource';
import type { DataFrame } from './frame';
import type { Entry, NewEntry } from './inputs';
import type { Target } from './schema';
import { addTime, parseDuration, startOf, type TimeUnit } from './time';

/**
 * A datasource over entries recorded by input forms. Reference it from a panel with
 * `"datasource": {"type": "dashkit-local"}` and targets like:
 *
 *   { "refId": "A", "metric": "weight" }                                   raw points
 *   { "refId": "A", "metric": "water", "aggregate": "sum", "bucket": "1d" } daily totals
 *   { "refId": "A", "metric": "mood", "aggregate": "count", "groupBy": "text" }  one series per choice
 */

export const LOCAL_DATASOURCE_TYPE = 'dashkit-local';

export interface EntryStore {
  add(entries: NewEntry[]): Promise<Entry[]>;
  list(query: { metrics: string[]; from?: number; to?: number }): Promise<Entry[]>;
  latest(metric: string): Promise<Entry | undefined>;
  remove(id: string): Promise<void>;
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
  /** Display name for the series. */
  alias?: string;
}

export class LocalDataSource implements DataSource {
  constructor(private readonly store: EntryStore) {}

  async query(request: QueryRequest): Promise<DataFrame[]> {
    const targets = request.targets as LocalTarget[];
    const entries = await this.store.list({
      metrics: [...new Set(targets.map((t) => t.metric).filter(Boolean))],
      from: request.range.from,
      to: request.range.to,
    });
    return targets.flatMap((t) => buildFrames(t, entries.filter((e) => e.metric === t.metric), request));
  }
}

export function buildFrames(target: LocalTarget, entries: Entry[], request: Pick<QueryRequest, 'range' | 'intervalMs'>): DataFrame[] {
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
    let values: Array<number | null>;
    if (aggregate === 'none') {
      times = rows.map((e) => e.ts);
      values = rows.map((e) => e.value);
    } else {
      const bucket = !target.bucket || target.bucket === 'auto' ? request.intervalMs : target.bucket;
      const fill = target.fillZero ?? (aggregate === 'sum' || aggregate === 'count');
      ({ times, values } = bucketize(rows, aggregate, bucket, request.range, fill));
    }
    return {
      name,
      refId: target.refId,
      fields: [
        { name: 'Time', type: 'time', values: times },
        {
          name: group ?? name,
          type: 'number',
          values,
          labels: group != null ? { [target.metric]: group } : undefined,
          config: { displayName: group ?? name },
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

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }
}
