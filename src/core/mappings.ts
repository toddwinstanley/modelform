/**
 * Value mappings as an editor shows them: one row per condition, in the order they're tried.
 * Grafana keeps every value condition in one mapping keyed by value; rows keep each in its own,
 * so editing a value never reorders or merges rows. Both shapes render the same here.
 */
import type { MappingResult, ValueMapping } from './schema';

export type SpecialMatch = 'null' | 'nan' | 'null+nan' | 'true' | 'false' | 'empty';

export type MappingRow =
  | { type: 'value'; value: string; result: MappingResult }
  | { type: 'range'; from: number | null; to: number | null; result: MappingResult }
  | { type: 'regex'; pattern: string; result: MappingResult }
  | { type: 'special'; match: SpecialMatch; result: MappingResult }
  /** A mapping type modelform doesn't render, kept as it is. */
  | { type: 'other'; mapping: ValueMapping };

export const MAPPING_TYPES: { label: string; value: Exclude<MappingRow['type'], 'other'> }[] = [
  { label: 'Value', value: 'value' },
  { label: 'Range', value: 'range' },
  { label: 'Regex', value: 'regex' },
  { label: 'Special', value: 'special' },
];

export const SPECIAL_MATCHES: { label: string; value: SpecialMatch }[] = [
  { label: 'Null', value: 'null' },
  { label: 'NaN', value: 'nan' },
  { label: 'Null or NaN', value: 'null+nan' },
  { label: 'True', value: 'true' },
  { label: 'False', value: 'false' },
  { label: 'Empty', value: 'empty' },
];

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The rows of a list of mappings. A value mapping with several values becomes a row each, in Grafana's `index` order. */
export function mappingRows(mappings: ValueMapping[] | undefined): MappingRow[] {
  const rows: MappingRow[] = [];
  for (const m of mappings ?? []) {
    const o = m.options as Record<string, any>;
    switch (m.type) {
      case 'value':
        Object.entries(o as Record<string, MappingResult>)
          .map(([value, result], i) => ({ value, result, i }))
          .sort((a, b) => (a.result.index ?? a.i) - (b.result.index ?? b.i))
          .forEach(({ value, result }) => rows.push({ type: 'value', value, result }));
        break;
      case 'range':
        rows.push({ type: 'range', from: num(o.from), to: num(o.to), result: o.result });
        break;
      case 'regex':
        rows.push({ type: 'regex', pattern: o.pattern, result: o.result });
        break;
      case 'special':
        rows.push({ type: 'special', match: o.match, result: o.result });
        break;
      default:
        rows.push({ type: 'other', mapping: m });
    }
  }
  return rows;
}

/** Mappings for rows, one each. */
export function rowsToMappings(rows: MappingRow[]): ValueMapping[] {
  return rows.map((r) => {
    switch (r.type) {
      case 'value':
        return { type: 'value', options: { [r.value]: r.result } };
      case 'range':
        return { type: 'range', options: { from: r.from, to: r.to, result: r.result } };
      case 'regex':
        return { type: 'regex', options: { pattern: r.pattern, result: r.result } };
      case 'special':
        return { type: 'special', options: { match: r.match, result: r.result } };
      default:
        return r.mapping;
    }
  });
}

/** A new row of a type, keeping what it shows from the row it replaces. */
export function mappingRow(type: Exclude<MappingRow['type'], 'other'>, result: MappingResult = { text: '' }): MappingRow {
  switch (type) {
    case 'value':
      return { type, value: '', result };
    case 'range':
      return { type, from: null, to: null, result };
    case 'regex':
      return { type, pattern: '', result };
    case 'special':
      return { type, match: 'null', result };
  }
}

function resultProblem(r: unknown): string | undefined {
  if (!isObject(r)) return 'needs a result object';
  if (r.text !== undefined && typeof r.text !== 'string') return 'text must be a string';
  if (r.color !== undefined && typeof r.color !== 'string') return 'color must be a string';
  return undefined;
}

/** Why the renderer can't use a mapping, if it can't. Types it doesn't know are fine: it skips them. */
export function mappingProblem(m: unknown): string | undefined {
  if (!isObject(m) || typeof m.type !== 'string') return 'must be an object with a type';
  if (!['value', 'range', 'regex', 'special'].includes(m.type)) return undefined;
  const o = m.options;
  if (!isObject(o)) return 'needs options';
  if (m.type === 'value') {
    for (const [k, r] of Object.entries(o)) {
      const p = resultProblem(r);
      if (p) return `"${k}" ${p}`;
    }
    return undefined;
  }
  if (m.type === 'range' && ((o.from != null && typeof o.from !== 'number') || (o.to != null && typeof o.to !== 'number'))) return 'from and to must be numbers';
  if (m.type === 'regex' && typeof o.pattern !== 'string') return 'pattern must be a string';
  if (m.type === 'special' && !SPECIAL_MATCHES.some((s) => s.value === o.match)) return `match must be one of ${SPECIAL_MATCHES.map((s) => s.value).join(', ')}`;
  return resultProblem(o.result);
}
