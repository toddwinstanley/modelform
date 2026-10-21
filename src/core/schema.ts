/**
 * The subset of the Grafana dashboard JSON model that dashkit understands.
 * Unknown keys are tolerated and ignored, so dashboards exported from Grafana
 * load as-is. See https://grafana.com/docs/grafana/latest/dashboards/build-dashboards/view-dashboard-json-model/
 *
 * dashkit adds two extensions, both of which Grafana ignores:
 *  - `panel.mobile` to tune phone layout per panel
 *  - `input-*` panel types for data entry forms (see inputs.ts)
 */

export interface Dashboard {
  uid?: string;
  title: string;
  description?: string;
  tags?: string[];
  panels: Panel[];
  templating?: { list: TemplateVariable[] };
  time?: { from: string; to: string };
  /** "browser" (the default), "utc", or an IANA zone such as "Europe/London". */
  timezone?: string;
  refresh?: string | false;
  /** Present on dashboards exported "for sharing externally". */
  __inputs?: Array<{ name: string; type: string; pluginId?: string }>;
}

export interface GridPos {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DataSourceRef {
  type?: string;
  uid?: string;
}

/** A panel query. Everything besides refId/datasource is datasource-specific and passed through untouched. */
export interface Target {
  refId: string;
  datasource?: DataSourceRef | string | null;
  hide?: boolean;
  [key: string]: unknown;
}

export interface ThresholdStep {
  value: number | null;
  color: string;
}

export interface FieldConfig {
  unit?: string;
  min?: number;
  max?: number;
  decimals?: number;
  displayName?: string;
  color?: { mode?: string; fixedColor?: string };
  thresholds?: { mode?: 'absolute' | 'percentage'; steps: ThresholdStep[] };
  mappings?: ValueMapping[];
  custom?: {
    drawStyle?: 'line' | 'bars' | 'points';
    lineWidth?: number;
    fillOpacity?: number;
    showPoints?: 'auto' | 'always' | 'never';
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Grafana value mappings: display text (and optionally a color) in place of a value. */
export type ValueMapping =
  | { type: 'value'; options: Record<string, MappingResult> }
  | { type: 'range'; options: { from?: number | null; to?: number | null; result: MappingResult } }
  | { type: 'regex'; options: { pattern: string; result: MappingResult } }
  | { type: 'special'; options: { match: 'null' | 'nan' | 'null+nan' | 'true' | 'false' | 'empty'; result: MappingResult } }
  | { type: string; options?: unknown };

export interface MappingResult {
  text?: string;
  color?: string;
  index?: number;
}

export interface FieldOverride {
  matcher: { id: string; options?: unknown };
  properties: Array<{ id: string; value: unknown }>;
}

/** dashkit extension: how a panel behaves on a narrow screen. */
export interface MobileOptions {
  /** Columns out of 24 on a phone. Defaults: w <= 6 → 12 (two-up), otherwise 24. */
  span?: number;
  /** Height in grid units (Grafana units are 30px). Defaults to gridPos.h. */
  h?: number;
  hidden?: boolean;
}

export interface Panel {
  id?: number;
  type: string;
  title?: string;
  description?: string;
  gridPos: GridPos;
  datasource?: DataSourceRef | string | null;
  targets?: Target[];
  fieldConfig?: { defaults?: FieldConfig; overrides?: FieldOverride[] };
  options?: Record<string, any>;
  /** Applied in order to the query results. See transform.ts for the ones dashkit implements. */
  transformations?: Array<{ id: string; options?: Record<string, any>; disabled?: boolean }>;
  /** Rows only. */
  collapsed?: boolean;
  /** Rows only: children of a collapsed row live here instead of at the top level. */
  panels?: Panel[];
  /** Repeat this row (or panel) once per selected value of the named variable. */
  repeat?: string;
  /** Panel repeats: side by side (`h`, wrapping at maxPerRow) or stacked (`v`). */
  repeatDirection?: 'h' | 'v';
  maxPerRow?: number;
  /** Set on each copy of a repeated row or panel: the single value it was repeated for. */
  scopedVars?: Record<string, { text: string; value: string }>;
  mobile?: MobileOptions;
  [key: string]: unknown;
}

export interface VariableOption {
  text: string | string[];
  value: string | string[];
  selected?: boolean;
}

export interface TemplateVariable {
  name: string;
  type: 'query' | 'custom' | 'constant' | 'textbox' | 'interval' | 'datasource' | 'adhoc' | string;
  label?: string;
  hide?: number;
  query?: unknown;
  current?: Partial<VariableOption>;
  options?: VariableOption[];
  multi?: boolean;
  includeAll?: boolean;
  allValue?: string | null;
  /** Query variables: where the options come from. */
  datasource?: DataSourceRef | string | null;
  /** Query variables: 0/missing = never, 1 = on dashboard load, 2 = on time range change. */
  refresh?: number;
  /** Query variables: `/pattern/flags` applied to each option's text. */
  regex?: string;
  /** Query variables: 0 = query order, 1/2 = alpha, 3/4 = numeric, 5/6 = alpha ignoring case, 7/8 = natural. Odd ascending. */
  sort?: number;
}
