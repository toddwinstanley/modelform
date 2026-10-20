import type { DataFrame } from './frame';
import type { DataSourceRef, Panel, Target } from './schema';
import type { TimeRange } from './time';
import { calculateInterval, parseDuration } from './time';
import { interpolateDeep, type VariableInfo, type VariableValues, type VarOption } from './variables';

export interface QueryRequest {
  /** Already interpolated; `datasource` is filled in on every target. */
  targets: Array<Target & { datasource?: DataSourceRef }>;
  range: TimeRange;
  intervalMs: number;
  maxDataPoints: number;
}

export interface VariableQueryRequest {
  /** The variable's `query`, already interpolated. */
  query: unknown;
  datasource?: DataSourceRef;
  range: TimeRange;
}

export interface DataSource {
  query(request: QueryRequest, signal?: AbortSignal): Promise<DataFrame[]>;
  /**
   * Options for a `query` variable, or null when this datasource can't run that kind of variable
   * query (the variable then keeps the options saved in the dashboard JSON).
   */
  variableOptions?(request: VariableQueryRequest, signal?: AbortSignal): Promise<VarOption[] | null>;
}

/** Maps a panel/target datasource reference to the implementation that serves it. */
export type DataSourceResolver = (ref: DataSourceRef | undefined) => DataSource;

export interface PanelQueryContext {
  resolve: DataSourceResolver;
  range: TimeRange;
  variables: VariableValues;
  /** Options and multi/All settings per variable; needed to expand All. See variableInfo(). */
  variableInfo?: Record<string, VariableInfo>;
  /** Rendered width in px; Grafana uses this as the default maxDataPoints. */
  widthPx: number;
}

const MIXED = '-- Mixed --';

export const panelHasQueries = (panel: Panel) =>
  !!panel.targets?.some((t) => !t.hide) && panel.type !== 'text' && panel.type !== 'row';

export async function queryPanel(panel: Panel, ctx: PanelQueryContext, signal?: AbortSignal): Promise<DataFrame[]> {
  if (!panelHasQueries(panel)) return [];

  const maxDataPoints = (panel.maxDataPoints as number | undefined) ?? Math.max(100, Math.round(ctx.widthPx));
  const minInterval = typeof panel.interval === 'string' && panel.interval ? safeDuration(panel.interval) : undefined;
  const intervalMs = calculateInterval(ctx.range, maxDataPoints, minInterval);
  const interp = { values: ctx.variables, info: ctx.variableInfo, scoped: panel.scopedVars, range: ctx.range, intervalMs };

  const panelRef = normalizeRef(panel.datasource);
  const groups = new Map<DataSource, QueryRequest['targets']>();

  for (const target of panel.targets ?? []) {
    if (target.hide) continue;
    const fallback = panelRef?.uid === MIXED ? undefined : panelRef;
    const ref = interpolateDeep(normalizeRef(target.datasource) ?? fallback, interp);
    const ds = ctx.resolve(ref);
    const resolved = { ...interpolateDeep(target, { ...interp, datasourceType: ref?.type }), datasource: ref };
    groups.set(ds, [...(groups.get(ds) ?? []), resolved]);
  }

  const results = await Promise.all(
    [...groups].map(([ds, targets]) => ds.query({ targets, range: ctx.range, intervalMs, maxDataPoints }, signal)),
  );
  return results.flat();
}

/** Older dashboards reference datasources by name string; newer ones by {type, uid}. */
export function normalizeRef(ref: DataSourceRef | string | null | undefined): DataSourceRef | undefined {
  if (ref == null) return undefined;
  if (typeof ref === 'string') return { uid: ref };
  return ref;
}

function safeDuration(s: string): number | undefined {
  try {
    return parseDuration(s.replace(/^>/, ''));
  } catch {
    return undefined;
  }
}
