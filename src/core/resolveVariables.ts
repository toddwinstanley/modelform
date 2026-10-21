import { normalizeRef, type DataSourceResolver } from './datasource';
import type { Dashboard, TemplateVariable } from './schema';
import type { TimeRange } from './time';
import {
  interpolateDeep,
  refineOptions,
  selectValue,
  variableInfo,
  variableReferences,
  type VariableValues,
  type VarOption,
} from './variables';

/**
 * Re-runs query variables against their datasource, the way Grafana does when a dashboard loads,
 * its time range changes, or a variable that others depend on changes.
 */

export interface ResolvedVariables {
  values: VariableValues;
  /** Resolved options for every query variable that has been run. */
  options: Record<string, VarOption[]>;
  /** Per-variable failures; those variables keep their previous options. */
  errors: Record<string, string>;
}

export interface ResolveOptions {
  /** Current values and previously resolved options; neither is mutated. */
  values: VariableValues;
  options?: Record<string, VarOption[]>;
  /** The variables to re-run. Others are left as they are. */
  names: Iterable<string>;
  resolve: DataSourceResolver;
  range: TimeRange;
  signal?: AbortSignal;
}

/** Query variables that Grafana runs on load (`refresh` 1 or 2), or only those run on time range change (`refresh` 2). */
export function refreshedVariables(dashboard: Dashboard, on: 'load' | 'range'): string[] {
  return (dashboard.templating?.list ?? [])
    .filter((v) => v.type === 'query' && (on === 'load' ? (v.refresh ?? 0) >= 1 : v.refresh === 2))
    .map((v) => v.name);
}

/** Every variable whose query refers to one of `names`, directly or through another variable. */
export function variableDependents(dashboard: Dashboard, names: Iterable<string>): Set<string> {
  const list = dashboard.templating?.list ?? [];
  const all = list.map((v) => v.name);
  const refs = new Map(list.map((v) => [v.name, variableReferences(v, all)]));
  const out = new Set<string>();
  const queue = [...names];
  while (queue.length) {
    const changed = queue.shift()!;
    for (const [name, deps] of refs) {
      if (deps.includes(changed) && !out.has(name)) {
        out.add(name);
        queue.push(name);
      }
    }
  }
  return out;
}

/**
 * Variables ordered so each comes after the ones its query refers to, keeping
 * `templating.list` order otherwise. Variables in a reference cycle are returned separately.
 */
export function variableOrder(dashboard: Dashboard): { order: TemplateVariable[]; cyclic: TemplateVariable[] } {
  const list = dashboard.templating?.list ?? [];
  const all = list.map((v) => v.name);
  const deps = new Map(list.map((v) => [v.name, variableReferences(v, all)]));
  const order: TemplateVariable[] = [];
  const placed = new Set<string>();
  let remaining = [...list];
  for (;;) {
    const next = remaining.find((v) => deps.get(v.name)!.every((d) => placed.has(d)));
    if (!next) break;
    order.push(next);
    placed.add(next.name);
    remaining = remaining.filter((v) => v !== next);
  }
  return { order, cyclic: remaining };
}

export async function resolveVariables(dashboard: Dashboard, opts: ResolveOptions): Promise<ResolvedVariables> {
  const values = { ...opts.values };
  const options = { ...opts.options };
  const errors: Record<string, string> = {};
  const names = new Set(opts.names);
  const { order, cyclic } = variableOrder(dashboard);

  for (const v of cyclic) {
    if (names.has(v.name)) errors[v.name] = 'Variable is part of a circular reference';
  }

  for (const v of order) {
    if (!names.has(v.name) || v.type !== 'query') continue;
    const info = variableInfo(dashboard, options);
    const ref = interpolateDeep(normalizeRef(v.datasource), { values, info });
    const ds = opts.resolve(ref);
    if (!ds.variableOptions) continue;

    const query = interpolateDeep(v.query, { values, info, range: opts.range, datasourceType: ref?.type, timezone: dashboard.timezone });
    let raw: VarOption[] | null;
    try {
      raw = await ds.variableOptions({ query, datasource: ref, range: opts.range }, opts.signal);
    } catch (e: any) {
      if (opts.signal?.aborted) throw e;
      errors[v.name] = String(e?.message ?? e);
      continue;
    }
    if (!raw) continue;

    options[v.name] = refineOptions(v, raw);
    values[v.name] = selectValue(v, values[v.name], options[v.name]);
  }

  return { values, options, errors };
}
