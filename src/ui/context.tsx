import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DataSourceResolver } from '../core/datasource';
import type { DataFrame } from '../core/frame';
import { queryPanel } from '../core/datasource';
import type { Dashboard, Panel } from '../core/schema';
import { parseDuration, parseRange, type TimeRange } from '../core/time';
import { refreshedVariables, resolveVariables, variableDependents } from '../core/resolveVariables';
import { initialVariableValues, variableInfo, type VariableInfo, type VariableValues, type VarOption } from '../core/variables';

interface DashboardState {
  dashboard: Dashboard;
  resolve?: DataSourceResolver;
  rawRange: { from: string; to: string };
  setRawRange(r: { from: string; to: string }): void;
  /** Re-evaluated on every refresh so "now" moves forward. */
  range: TimeRange;
  variables: VariableValues;
  /** Options and multi/All settings per variable, with query variables' options as last resolved. */
  variableInfo: Record<string, VariableInfo>;
  /** Query variables whose last refresh failed, by name. */
  variableErrors: Record<string, string>;
  /** False while query variables are being re-run; panels wait for it so they never query with stale values. */
  variablesReady: boolean;
  setVariable(name: string, value: string | string[]): void;
  refresh(): void;
  refreshKey: number;
  /** Results that `-- Dashboard --` panels reuse; a new map whenever the range or variables change. */
  shared: Map<string, Promise<DataFrame[]>>;
}

const Ctx = createContext<DashboardState | null>(null);

export interface DashboardProviderProps {
  dashboard: Dashboard;
  /** Required to render data panels; input-only forms can omit it. */
  resolve?: DataSourceResolver;
  /** Bump to force all panels to re-query (e.g. after the local store changes). */
  refreshKey?: number;
  children: ReactNode;
}

export function DashboardProvider({ dashboard, resolve, refreshKey: externalKey = 0, children }: DashboardProviderProps) {
  const [rawRange, setRawRange] = useState(dashboard.time ?? { from: 'now-6h', to: 'now' });
  const [tick, setTick] = useState(0);
  const vars = useDashboardVariables(dashboard, resolve, rawRange);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!dashboard.refresh) return;
    let ms: number;
    try {
      ms = parseDuration(dashboard.refresh);
    } catch {
      return;
    }
    const id = setInterval(refresh, Math.max(ms, 5000));
    return () => clearInterval(id);
  }, [dashboard.refresh, refresh]);

  // Both counters only ever increase, so their sum changes whenever either does.
  const refreshKey = tick + externalKey;
  const range = useMemo(() => parseRange(rawRange), [rawRange, refreshKey]);
  const shared = useMemo(() => new Map<string, Promise<DataFrame[]>>(), [range, vars.variables, vars.variableInfo]);

  const value = useMemo<DashboardState>(
    () => ({
      dashboard,
      resolve,
      rawRange,
      setRawRange,
      range,
      ...vars,
      refresh,
      refreshKey,
      shared,
    }),
    [dashboard, resolve, rawRange, range, vars, refresh, refreshKey, shared],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

interface VariableState {
  values: VariableValues;
  options: Record<string, VarOption[]>;
  errors: Record<string, string>;
}

/**
 * Variable values plus Grafana's refresh behaviour for query variables: run on load (and on
 * hot reload), again on time range change for `refresh: 2`, and for every variable that depends
 * on one the user changes. Requests that arrive mid-run abort it and are merged into the next.
 */
function useDashboardVariables(dashboard: Dashboard, resolve: DataSourceResolver | undefined, rawRange: { from: string; to: string }) {
  const [state, setState] = useState<VariableState>(() => ({ values: initialVariableValues(dashboard), options: {}, errors: {} }));
  const [resolving, setResolving] = useState(() => !!resolve && refreshedVariables(dashboard, 'load').length > 0);
  const [runKey, setRunKey] = useState(0);
  const pending = useRef(new Set<string>());
  const stateRef = useRef(state);
  stateRef.current = state;
  // Callers often pass a fresh resolver each render; it shouldn't restart a run.
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;

  const schedule = useCallback((names: Iterable<string>) => {
    const before = pending.current.size;
    for (const n of names) pending.current.add(n);
    if (pending.current.size === before) return;
    setResolving(true);
    setRunKey((k) => k + 1);
  }, []);

  // Declared before the effects that schedule work, so a run starts once per runKey rather than
  // once for the commit that scheduled it and again for the runKey bump.
  useEffect(() => {
    if (!pending.current.size) return;
    const resolve = resolveRef.current;
    if (!resolve) {
      pending.current.clear();
      setResolving(false);
      return;
    }
    const names = new Set(pending.current);
    const controller = new AbortController();
    const { values, options } = stateRef.current;
    const finish = (update: (s: VariableState) => VariableState) => {
      if (controller.signal.aborted) return;
      names.forEach((n) => pending.current.delete(n));
      setState(update);
      setResolving(false);
    };
    resolveVariables(dashboard, { values, options, names, resolve, range: parseRange(rawRange), signal: controller.signal }).then(
      (res) =>
        finish((s) => ({
          // Only the re-run variables change, so a pick made while this ran isn't overwritten.
          values: { ...s.values, ...Object.fromEntries([...names].filter((n) => n in res.values).map((n) => [n, res.values[n]])) },
          options: { ...s.options, ...res.options },
          errors: { ...Object.fromEntries(Object.entries(s.errors).filter(([n]) => !names.has(n))), ...res.errors },
        })),
      (e) => finish((s) => ({ ...s, errors: { ...s.errors, ...Object.fromEntries([...names].map((n) => [n, String(e?.message ?? e)])) } })),
    );
    return () => controller.abort();
  }, [runKey, dashboard]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load, and hot reload: keep the user's selections, re-run what Grafana runs on load.
  useEffect(() => {
    setState((s) => ({ ...s, values: { ...initialVariableValues(dashboard), ...s.values } }));
    const roots = refreshedVariables(dashboard, 'load');
    schedule([...roots, ...variableDependents(dashboard, roots)]);
  }, [dashboard, schedule]);

  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const roots = refreshedVariables(dashboard, 'range');
    schedule([...roots, ...variableDependents(dashboard, roots)]);
  }, [rawRange]); // eslint-disable-line react-hooks/exhaustive-deps

  const setVariable = useCallback(
    (name: string, value: string | string[]) => {
      setState((s) => ({ ...s, values: { ...s.values, [name]: value } }));
      schedule(variableDependents(dashboard, [name]));
    },
    [dashboard, schedule],
  );

  const info = useMemo(() => variableInfo(dashboard, state.options), [dashboard, state.options]);

  return useMemo(
    () => ({
      variables: state.values,
      variableInfo: info,
      variableErrors: state.errors,
      variablesReady: !resolving,
      setVariable,
    }),
    [state.values, info, state.errors, resolving, setVariable],
  );
}

export function useDashboard(): DashboardState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDashboard must be used inside <DashboardProvider>');
  return v;
}

export interface PanelData {
  frames: DataFrame[];
  loading: boolean;
  error?: string;
}

export function usePanelData(panel: Panel, widthPx: number, enabled = true): PanelData {
  const { dashboard, resolve, range, variables, variableInfo, variablesReady, shared } = useDashboard();
  const [state, setState] = useState<PanelData>({ frames: [], loading: enabled });
  // Width only matters coarsely (it sets maxDataPoints); avoid re-querying on every pixel of resize.
  const widthBucket = Math.ceil(widthPx / 100) * 100;

  useEffect(() => {
    if (!enabled) return;
    if (!resolve) {
      setState({ frames: [], loading: false, error: 'No datasource configured' });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    if (!variablesReady) return;
    const controller = new AbortController();
    queryPanel(panel, { resolve, range, variables, variableInfo, widthPx: widthBucket, dashboard, shared }, controller.signal)
      .then((frames) => !controller.signal.aborted && setState({ frames, loading: false }))
      .catch((e) => !controller.signal.aborted && setState({ frames: [], loading: false, error: String(e?.message ?? e) }));
    return () => controller.abort();
  }, [enabled, panel, resolve, range, variables, variableInfo, variablesReady, widthBucket, dashboard, shared]);

  return state;
}
