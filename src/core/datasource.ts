import type { DataFrame } from './frame';
import type { Dashboard, DataSourceRef, Panel, Target } from './schema';
import type { TimeRange } from './time';
import { calculateInterval, parseDuration } from './time';
import { panelKey } from './layout';
import { applyTransformations } from './transform';
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
  /**
   * A JSON file the Grafana behind this datasource serves, by path such as `public/gazetteer/countries.json`.
   * Geomap lookup layers load gazetteers with it.
   */
  publicFile?(path: string, signal?: AbortSignal): Promise<unknown>;
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
  /** Where `-- Dashboard --` queries find the panel they reuse. Its `timezone` also sets `$__timezone`. */
  dashboard?: Dashboard;
  /** Overrides the dashboard's `timezone` for `$__timezone`. */
  timezone?: string;
  /**
   * Results shared between a panel and the `-- Dashboard --` panels that reuse it, by panelKey, so
   * the query runs once. Replace the map whenever the range or variables change.
   */
  shared?: Map<string, Promise<DataFrame[]>>;
}

const MIXED = '-- Mixed --';
/** Grafana's datasource that reuses another panel's results instead of querying. */
export const DASHBOARD_DS = '-- Dashboard --';

const isDashboardRef = (ref: DataSourceRef | undefined) => ref?.uid === DASHBOARD_DS;

/** Ids of the panels whose results a `-- Dashboard --` query reuses. */
export function dashboardSourceIds(dashboard: Dashboard): Set<number> {
  const ids = new Set<number>();
  for (const p of allPanels(dashboard.panels))
    for (const t of p.targets ?? []) if (typeof t.panelId === 'number' && isDashboardRef(normalizeRef(t.datasource) ?? normalizeRef(p.datasource))) ids.add(t.panelId);
  return ids;
}

function* allPanels(panels: Panel[]): Generator<Panel> {
  for (const p of panels) {
    yield p;
    yield* allPanels(p.panels ?? []);
  }
}

export const panelHasQueries = (panel: Panel) =>
  !!panel.targets?.some((t) => !t.hide) && panel.type !== 'text' && panel.type !== 'row';

/** Runs a panel's queries and applies its transformations. */
export async function queryPanel(panel: Panel, ctx: PanelQueryContext, signal?: AbortSignal): Promise<DataFrame[]> {
  return applyTransformations(await sharedQuery(panel, ctx, signal), panel.transformations);
}

/**
 * The panel's untransformed results, run once per `ctx.shared` map when other panels reuse them.
 * A shared run ignores the caller's signal, because another panel may still be waiting on it.
 */
function sharedQuery(panel: Panel, ctx: PanelQueryContext, signal?: AbortSignal, seen = new Set<string>()): Promise<DataFrame[]> {
  const key = panelKey(panel);
  if (!ctx.shared || !ctx.dashboard || panel.id == null || !dashboardSourceIds(ctx.dashboard).has(panel.id)) return rawQuery(panel, ctx, signal, seen);
  const shared = ctx.shared;
  let result = shared.get(key);
  if (!result) {
    const run = rawQuery(panel, ctx, undefined, seen);
    shared.set(key, run);
    // A failed run shouldn't stick: the next panel to ask tries again.
    run.catch(() => shared.get(key) === run && shared.delete(key));
    result = run;
  }
  return result;
}

async function rawQuery(panel: Panel, ctx: PanelQueryContext, signal: AbortSignal | undefined, seen: Set<string>): Promise<DataFrame[]> {
  if (!panelHasQueries(panel)) return [];

  const maxDataPoints = (panel.maxDataPoints as number | undefined) ?? Math.max(100, Math.round(ctx.widthPx));
  const minInterval = typeof panel.interval === 'string' && panel.interval ? safeDuration(panel.interval) : undefined;
  const intervalMs = calculateInterval(ctx.range, maxDataPoints, minInterval);
  const interp = { values: ctx.variables, info: ctx.variableInfo, scoped: panel.scopedVars, range: ctx.range, intervalMs, timezone: ctx.timezone ?? ctx.dashboard?.timezone };

  const panelRef = normalizeRef(panel.datasource);
  const groups = new Map<DataSource, QueryRequest['targets']>();

  const reused: Array<Promise<DataFrame[]>> = [];

  for (const target of panel.targets ?? []) {
    if (target.hide) continue;
    const fallback = panelRef?.uid === MIXED ? undefined : panelRef;
    const ref = interpolateDeep(normalizeRef(target.datasource) ?? fallback, interp);
    if (isDashboardRef(ref)) {
      reused.push(reusePanel(panel, target, ctx, signal, seen));
      continue;
    }
    const ds = ctx.resolve(ref);
    const resolved = { ...interpolateDeep(target, { ...interp, datasourceType: ref?.type }), datasource: ref };
    groups.set(ds, [...(groups.get(ds) ?? []), resolved]);
  }

  const results = await Promise.all([
    ...reused,
    ...[...groups].map(([ds, targets]) => ds.query({ targets, range: ctx.range, intervalMs, maxDataPoints }, signal)),
  ]);
  return results.flat();
}

/** A `-- Dashboard --` target: the results of panel `target.panelId`, with its transformations if `withTransforms`. */
async function reusePanel(panel: Panel, target: Target, ctx: PanelQueryContext, signal: AbortSignal | undefined, seen: Set<string>): Promise<DataFrame[]> {
  const source = ctx.dashboard && [...allPanels(ctx.dashboard.panels)].find((p) => p.id === target.panelId);
  if (!source) throw new Error(`Panel ${target.panelId ?? '?'} not found for the Dashboard datasource`);
  // Inside a repeat, the source sees the same repeated values as the panel reusing it.
  const scoped = source.scopedVars || !panel.scopedVars ? source : { ...source, scopedVars: panel.scopedVars };
  const key = panelKey(scoped);
  if (seen.has(key)) throw new Error(`Panels reuse each other's results in a loop (panel ${target.panelId})`);
  const frames = await sharedQuery(scoped, ctx, signal, new Set([...seen, panelKey(panel), key]));
  return target.withTransforms ? applyTransformations(frames, source.transformations) : frames;
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
