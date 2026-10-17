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
  custom?: {
    drawStyle?: 'line' | 'bars' | 'points';
    lineWidth?: number;
    fillOpacity?: number;
    showPoints?: 'auto' | 'always' | 'never';
    [key: string]: unknown;
  };
  [key: string]: unknown;
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
  /** Rows only. */
  collapsed?: boolean;
  /** Rows only: children of a collapsed row live here instead of at the top level. */
  panels?: Panel[];
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
}
