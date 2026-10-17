import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DataSourceResolver } from '../core/datasource';
import type { DataFrame } from '../core/frame';
import { queryPanel } from '../core/datasource';
import type { Dashboard, Panel } from '../core/schema';
import { parseDuration, parseRange, type TimeRange } from '../core/time';
import { initialVariableValues, type VariableValues } from '../core/variables';

interface DashboardState {
  dashboard: Dashboard;
  resolve?: DataSourceResolver;
  rawRange: { from: string; to: string };
  setRawRange(r: { from: string; to: string }): void;
  /** Re-evaluated on every refresh so "now" moves forward. */
  range: TimeRange;
  variables: VariableValues;
  setVariable(name: string, value: string | string[]): void;
  refresh(): void;
  refreshKey: number;
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
  const [variables, setVariables] = useState(() => initialVariableValues(dashboard));
  const [tick, setTick] = useState(0);

  // Pick up edits to the JSON (hot reload) without losing the user's range selection.
  useEffect(() => setVariables((v) => ({ ...initialVariableValues(dashboard), ...v })), [dashboard]);

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

  const value = useMemo<DashboardState>(
    () => ({
      dashboard,
      resolve,
      rawRange,
      setRawRange,
      range,
      variables,
      setVariable: (name, v) => setVariables((cur) => ({ ...cur, [name]: v })),
      refresh,
      refreshKey,
    }),
    [dashboard, resolve, rawRange, range, variables, refresh, refreshKey],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
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
  const { resolve, range, variables } = useDashboard();
  const [state, setState] = useState<PanelData>({ frames: [], loading: enabled });
  // Width only matters coarsely (it sets maxDataPoints); avoid re-querying on every pixel of resize.
  const widthBucket = Math.ceil(widthPx / 100) * 100;

  useEffect(() => {
    if (!enabled) return;
    if (!resolve) {
      setState({ frames: [], loading: false, error: 'No datasource configured' });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    queryPanel(panel, { resolve, range, variables, widthPx: widthBucket }, controller.signal)
      .then((frames) => !controller.signal.aborted && setState({ frames, loading: false }))
      .catch((e) => !controller.signal.aborted && setState({ frames: [], loading: false, error: String(e?.message ?? e) }));
    return () => controller.abort();
  }, [enabled, panel, resolve, range, variables, widthBucket]);

  return state;
}
