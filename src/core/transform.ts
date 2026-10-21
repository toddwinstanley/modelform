import { fieldDisplayName, toMillis, type DataFrame, type Field, type FieldType } from './frame';

/** A panel's `transformations` entry. */
export interface Transformation {
  id: string;
  options?: Record<string, any>;
  disabled?: boolean;
}

type Transformer = (frames: DataFrame[], options: Record<string, any>) => DataFrame[];

const mapFields = (frames: DataFrame[], fn: (fields: Field[]) => Field[]) => frames.map((f) => ({ ...f, fields: fn(f.fields) }));

/** `/pattern/flags` or a bare pattern, as Grafana's regex options accept. */
function toRegExp(pattern: string): RegExp | undefined {
  const m = /^\/(.*)\/([a-z]*)$/.exec(pattern);
  try {
    return m ? new RegExp(m[1], m[2]) : new RegExp(pattern);
  } catch {
    return undefined;
  }
}

function nameMatcher(spec: { names?: string[]; pattern?: string } | undefined): ((name: string) => boolean) | undefined {
  if (!spec || (!spec.names?.length && !spec.pattern)) return undefined;
  const re = spec.pattern ? toRegExp(spec.pattern) : undefined;
  return (name) => !!spec.names?.includes(name) || !!re?.test(name);
}

/** What groupingToMatrix puts where a row has no value for a column. Grafana's default is "empty". */
const EMPTY: Record<string, unknown> = { null: null, empty: '', zero: 0, true: true, false: false };

function convert(field: Field, to: string, opts: { dateFormat?: string; joinWith?: string }): Field {
  const map = (fn: (v: unknown) => unknown, type: FieldType): Field => ({ ...field, type, values: field.values.map((v) => (v == null ? null : fn(v))) });
  switch (to) {
    case 'number':
      return map((v) => {
        if (typeof v === 'string' && !v.trim()) return null;
        const n = typeof v === 'boolean' ? Number(v) : field.type === 'time' ? toMillis(v) : Number(v);
        return Number.isFinite(n) ? n : null;
      }, 'number');
    case 'string':
      return map((v) => {
        if (field.type === 'time') return formatDate(toMillis(v), opts.dateFormat);
        if (Array.isArray(v)) return v.join(opts.joinWith ?? ',');
        return typeof v === 'object' ? JSON.stringify(v) : String(v);
      }, 'string');
    case 'time':
      return map((v) => {
        const n = typeof v === 'string' && !/^-?\d+(\.\d+)?$/.test(v.trim()) ? Date.parse(v) : Number(v);
        return Number.isFinite(n) ? n : null;
      }, 'time');
    case 'boolean':
      return map((v) => v === true || v === 1 || (typeof v === 'string' && ['true', '1', 'yes', 'on'].includes(v.trim().toLowerCase())), 'boolean');
    case 'other':
      return { ...field, type: 'other' };
    default:
      return field;
  }
}

/** Grafana's default "YYYY-MM-DD HH:mm:ss", plus the other moment tokens in common use, in local time. */
function formatDate(ms: number, format = 'YYYY-MM-DD HH:mm:ss'): string {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const tokens: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    YY: pad(d.getFullYear() % 100),
    MM: pad(d.getMonth() + 1),
    DD: pad(d.getDate()),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
    SSS: pad(d.getMilliseconds(), 3),
  };
  return format.replace(/YYYY|YY|MM|DD|HH|mm|ss|SSS/g, (t) => tokens[t]);
}

const TRANSFORMERS: Record<string, Transformer> = {
  convertFieldType: (frames, { conversions = [] }) =>
    frames.map((frame) => ({
      ...frame,
      fields: frame.fields.map((f) => {
        const name = fieldDisplayName(f, frame, frames.length > 1);
        const c = (conversions as Array<{ targetField?: string; destinationType?: string; dateFormat?: string; joinWith?: string }>).find(
          (c) => c.targetField === f.name || c.targetField === name,
        );
        return c?.destinationType ? convert(f, c.destinationType, c) : f;
      }),
    })),
  // Long rows (row, column, value) to a table with one row per row value and one column per column value, each
  // in the order first seen. The first column is named "row\\column", as Grafana names it.
  groupingToMatrix: (frames, { columnField = 'Time', rowField = 'Time', valueField = 'Value', emptyValue = 'empty' }) =>
    frames.map((frame) => {
      const byName = (n: string) => frame.fields.find((f) => f.name === n || fieldDisplayName(f, frame, frames.length > 1) === n);
      const [col, row, val] = [byName(columnField), byName(rowField), byName(valueField)];
      if (!col || !row || !val) return frame;
      const rows: unknown[] = [];
      const cols: unknown[] = [];
      const cells = new Map<unknown, Map<unknown, unknown>>();
      row.values.forEach((r, i) => {
        const c = col.values[i];
        if (!cells.has(r)) cells.set(r, new Map()), rows.push(r);
        if (!cols.includes(c)) cols.push(c);
        cells.get(r)!.set(c, val.values[i]);
      });
      const empty = emptyValue in EMPTY ? EMPTY[emptyValue] : '';
      return {
        ...frame,
        fields: [
          { name: `${rowField}\\${columnField}`, type: row.type, values: rows },
          ...cols.map((c) => ({
            name: String(c),
            type: val.type,
            config: val.config,
            values: rows.map((r) => {
              const line = cells.get(r)!;
              return line.has(c) ? line.get(c) : empty;
            }),
          })),
        ],
      };
    }),
  // Outer join of every frame on one field (default: each frame's time field), sorted by it, so
  // series recorded at different times share one table. Rows a frame has no value for are null.
  joinByField: (frames, { byField }: { byField?: string }) => {
    const keyOf = (frame: DataFrame) =>
      byField ? frame.fields.find((f) => f.name === byField || fieldDisplayName(f, frame, frames.length > 1) === byField) : frame.fields.find((f) => f.type === 'time');
    const keyed = frames.map((frame) => ({ frame, key: keyOf(frame) })).filter((x): x is { frame: DataFrame; key: Field } => !!x.key);
    if (keyed.length < 2) return frames;
    const norm = (v: unknown, key: Field) => (key.type === 'time' ? toMillis(v) : v);
    const keys = [...new Set(keyed.flatMap(({ key }) => key.values.map((v) => norm(v, key))))].sort((a: any, b: any) => (a < b ? -1 : a > b ? 1 : 0));
    const first = keyed[0].key;
    return [
      {
        fields: [
          { ...first, values: keys },
          ...keyed.flatMap(({ frame, key }) => {
            const at = new Map(key.values.map((v, i) => [norm(v, key), i]));
            return frame.fields
              .filter((f) => f !== key)
              .map((f) => ({ ...f, config: { displayName: fieldDisplayName(f, frame, frames.length > 1), ...f.config }, values: keys.map((k) => (at.has(k) ? f.values[at.get(k)!] : null)) }));
          }),
        ],
      },
    ];
  },
  filterFieldsByName: (frames, { include, exclude }) => {
    const inc = nameMatcher(include);
    const exc = nameMatcher(exclude);
    return mapFields(frames, (fields) => fields.filter((f) => (!inc || inc(f.name)) && !exc?.(f.name)));
  },
  organize: (frames, { excludeByName = {}, indexByName = {}, renameByName = {} }) =>
    mapFields(frames, (fields) =>
      fields
        .filter((f) => !excludeByName[f.name])
        .map((f, i) => ({ f, i, at: indexByName[f.name] ?? Infinity }))
        .sort((a, b) => a.at - b.at || a.i - b.i)
        // Grafana renames through displayName and keeps the name, so byName overrides still match.
        .map(({ f }) => (renameByName[f.name] ? { ...f, config: { ...f.config, displayName: renameByName[f.name] } } : f)),
    ),
};

/**
 * Applies a panel's transformations in order. Ones dashkit doesn't implement are skipped,
 * so their panels render the untransformed data as they did before transformations were supported.
 */
export function applyTransformations(frames: DataFrame[], transformations: Transformation[] | undefined): DataFrame[] {
  let out = frames;
  for (const t of transformations ?? []) {
    const fn = !t.disabled && TRANSFORMERS[t.id];
    if (fn) out = fn(out, t.options ?? {});
  }
  return out;
}
