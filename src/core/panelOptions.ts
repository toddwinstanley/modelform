/**
 * What each panel type can be configured with, as the renderer reads it: where the value lives
 * in the panel JSON, its type, and what the panel does when it's unset. The builder's options
 * pane is drawn from these, and the loader uses them to drop values of the wrong type, since
 * the schema types `options` and `custom` only loosely.
 */
import { mappingProblem } from './mappings';
import { REDUCER_LABELS } from './reduce';
import type { FieldType } from './frame';
import type { FieldOverride, Panel } from './schema';

export type OptionControl =
  | { kind: 'boolean' }
  | { kind: 'number'; min?: number; max?: number; integer?: boolean }
  | { kind: 'select'; choices: { label: string; value: string }[] }
  | { kind: 'text'; multiline?: boolean; placeholder?: string }
  /** A Grafana unit id; offered from UNIT_CHOICES. */
  | { kind: 'unit' }
  /** A Grafana color name or a CSS color. */
  | { kind: 'color' }
  /** fieldConfig.defaults.thresholds: a base color and steps. */
  | { kind: 'thresholds' }
  /** fieldConfig.defaults.mappings: display text and colors for values. */
  | { kind: 'mappings' }
  /** The name of a field the panel's queries return, of one of these types. */
  | { kind: 'field'; types: FieldType[] };

export interface PanelOption {
  /** Dotted path in the panel, e.g. "options.legend.showLegend" or "fieldConfig.defaults.custom.lineWidth". */
  path: string;
  label: string;
  category: string;
  help?: string;
  /** What the panel does while it's unset, in the control's terms. */
  default?: unknown;
  control: OptionControl;
  /** Shown only when this holds, e.g. a fixed color only in the fixed color mode. */
  showIf?(panel: Panel): boolean;
  /** For values not stored as the control shows them (e.g. one reducer kept as a one-item array). */
  get?(panel: Panel): unknown;
  set?(panel: Panel, value: unknown): Panel;
  /** The JSON type the stored value must have; defaults from the control. */
  stored?: 'boolean' | 'number' | 'string' | 'string[]' | 'object' | 'list';
}

/** Categories in the order the options pane lists them. */
export const OPTION_CATEGORIES = ['Panel', 'Value', 'Legend', 'Graph styles', 'Axis', 'Table', 'Text', 'Standard options', 'Value mappings', 'Thresholds', 'Map'] as const;

/** Units modelform formats specially; anything else formats as "short". `suffix:` and `prefix:` units take any text. */
export const UNIT_CHOICES: { label: string; value: string }[] = [
  { label: 'Short', value: 'short' },
  { label: 'None', value: 'none' },
  { label: 'Percent (0–100)', value: 'percent' },
  { label: 'Percent (0–1)', value: 'percentunit' },
  { label: 'Kilograms', value: 'masskg' },
  { label: 'Pounds', value: 'masslb' },
  { label: 'Celsius', value: 'celsius' },
  { label: 'Fahrenheit', value: 'fahrenheit' },
  { label: 'Milliseconds', value: 'ms' },
  { label: 'Seconds', value: 's' },
  { label: 'Duration (1h 5m)', value: 'dtdurations' },
  { label: 'Clock (01:05:00)', value: 'clocks' },
  { label: 'Dollars', value: 'currencyUSD' },
  { label: 'Euros', value: 'currencyEUR' },
  { label: 'Pounds sterling', value: 'currencyGBP' },
  { label: 'Bytes', value: 'bytes' },
  { label: 'Yes / No', value: 'bool_yes_no' },
  { label: 'On / Off', value: 'bool_on_off' },
  { label: 'Date', value: 'dateTimeAsIso' },
  { label: 'Time ago', value: 'dateTimeFromNow' },
];

const choices = (...values: string[]) => values.map((v) => ({ label: v.replace(/^./, (c) => c.toUpperCase()).replace(/([a-z])([A-Z])/g, '$1 $2'), value: v }));

const field = (key: string) => `fieldConfig.defaults.${key}`;

const STANDARD: PanelOption[] = [
  { path: field('unit'), label: 'Unit', category: 'Standard options', control: { kind: 'unit' }, default: 'short' },
  { path: field('min'), label: 'Min', category: 'Standard options', help: 'Leave empty to fit the data.', control: { kind: 'number' } },
  { path: field('max'), label: 'Max', category: 'Standard options', control: { kind: 'number' } },
  { path: field('decimals'), label: 'Decimals', category: 'Standard options', help: 'Leave empty for automatic.', control: { kind: 'number', min: 0, max: 20, integer: true } },
  { path: field('displayName'), label: 'Display name', category: 'Standard options', help: 'In place of the series name. Variables work, e.g. ${__field.name}.', control: { kind: 'text' } },
  {
    path: field('color.mode'),
    label: 'Color scheme',
    category: 'Standard options',
    control: {
      kind: 'select',
      choices: [
        { label: 'Classic palette', value: 'palette-classic' },
        { label: 'Single color', value: 'fixed' },
        { label: 'From thresholds', value: 'thresholds' },
      ],
    },
  },
  { path: field('color.fixedColor'), label: 'Color', category: 'Standard options', control: { kind: 'color' }, showIf: (p) => p.fieldConfig?.defaults?.color?.mode === 'fixed' },
];

const THRESHOLDS: PanelOption = {
  path: field('thresholds'),
  label: 'Thresholds',
  category: 'Thresholds',
  help: 'The color a value takes from the highest step at or below it.',
  control: { kind: 'thresholds' },
  stored: 'object',
};

const MAPPINGS: PanelOption = {
  path: field('mappings'),
  label: 'Value mappings',
  category: 'Value mappings',
  help: 'Text, and optionally a color, in place of a value. The first that matches is used.',
  control: { kind: 'mappings' },
  stored: 'list',
};

const CALC: PanelOption = {
  path: 'options.reduceOptions.calcs',
  label: 'Calculation',
  category: 'Value',
  help: 'How each series becomes one value.',
  default: 'lastNotNull',
  control: { kind: 'select', choices: Object.entries(REDUCER_LABELS).map(([value, label]) => ({ label, value })) },
  stored: 'string[]',
  get: (p) => p.options?.reduceOptions?.calcs?.[0],
  set: (p, v) => setOptionValue(p, 'options.reduceOptions.calcs', v === undefined ? undefined : [v]),
};

const LEGEND: PanelOption = {
  path: 'options.legend.showLegend',
  label: 'Show legend',
  category: 'Legend',
  help: 'When there are two or more series.',
  default: true,
  control: { kind: 'boolean' },
  get: (p) => p.options?.legend?.showLegend !== false && p.options?.legend?.displayMode !== 'hidden',
  // Grafana's older displayMode "hidden" would otherwise keep it hidden.
  set: (p, v) => setOptionValue(v ? setOptionValue(p, 'options.legend.displayMode', p.options?.legend?.displayMode === 'hidden' ? undefined : p.options?.legend?.displayMode) : p, 'options.legend.showLegend', v ? undefined : false),
};

const AXIS_LABEL: PanelOption = { path: field('custom.axisLabel'), label: 'Axis label', category: 'Axis', control: { kind: 'text' } };
const AXIS_PLACEMENT: PanelOption = {
  path: field('custom.axisPlacement'),
  label: 'Axis placement',
  category: 'Axis',
  default: 'auto',
  control: { kind: 'select', choices: choices('auto', 'left', 'right', 'hidden') },
};
const X_FIELD: PanelOption = {
  path: 'options.xField',
  label: 'X field',
  category: 'Axis',
  help: 'The number field to plot against. Auto uses the first one.',
  control: { kind: 'field', types: ['number'] },
};
const GROUP_FIELD: PanelOption = {
  path: 'options.xField',
  label: 'X field',
  category: 'Axis',
  help: 'The field whose values become the groups of bars. Auto uses the first text field, else the time.',
  control: { kind: 'field', types: ['string', 'time', 'number', 'boolean'] },
};

const GRAPH_STYLES: PanelOption[] = [
  { path: field('custom.drawStyle'), label: 'Style', category: 'Graph styles', default: 'line', control: { kind: 'select', choices: choices('line', 'bars', 'points') } },
  {
    path: field('custom.lineInterpolation'),
    label: 'Line interpolation',
    category: 'Graph styles',
    default: 'linear',
    control: { kind: 'select', choices: [{ label: 'Linear', value: 'linear' }, { label: 'Step after', value: 'stepAfter' }] },
  },
  { path: field('custom.lineWidth'), label: 'Line width', category: 'Graph styles', default: 2, control: { kind: 'number', min: 0, max: 10, integer: true } },
  { path: field('custom.fillOpacity'), label: 'Fill opacity', category: 'Graph styles', default: 0, control: { kind: 'number', min: 0, max: 100, integer: true } },
  { path: field('custom.showPoints'), label: 'Show points', category: 'Graph styles', default: 'auto', control: { kind: 'select', choices: choices('auto', 'always', 'never') } },
];

const BY_TYPE: Record<string, PanelOption[]> = {
  timeseries: [LEGEND, ...GRAPH_STYLES, AXIS_LABEL, ...STANDARD],
  trend: [LEGEND, ...GRAPH_STYLES, X_FIELD, AXIS_LABEL, ...STANDARD],
  barchart: [LEGEND, GROUP_FIELD, AXIS_LABEL, AXIS_PLACEMENT, ...STANDARD],
  xychart: [
    LEGEND,
    { path: field('custom.pointSize.fixed'), label: 'Point size', category: 'Graph styles', default: 5, control: { kind: 'number', min: 1, max: 40, integer: true } },
    AXIS_LABEL,
    AXIS_PLACEMENT,
    { path: field('custom.axisGridShow'), label: 'Show grid lines', category: 'Axis', default: true, control: { kind: 'boolean' } },
    ...STANDARD,
    MAPPINGS,
  ],
  stat: [
    CALC,
    { path: 'options.colorMode', label: 'Color mode', category: 'Value', default: 'value', control: { kind: 'select', choices: choices('value', 'background', 'none') } },
    { path: 'options.graphMode', label: 'Graph', category: 'Value', help: 'A sparkline behind the value.', default: 'area', control: { kind: 'select', choices: choices('area', 'none') } },
    { path: 'options.orientation', label: 'Orientation', category: 'Value', help: 'How several values are laid out.', default: 'auto', control: { kind: 'select', choices: choices('auto', 'horizontal', 'vertical') } },
    ...STANDARD,
    MAPPINGS,
    THRESHOLDS,
  ],
  gauge: [CALC, ...STANDARD, MAPPINGS, THRESHOLDS],
  bargauge: [CALC, ...STANDARD, MAPPINGS, THRESHOLDS],
  piechart: [CALC, { path: 'options.pieType', label: 'Pie type', category: 'Value', default: 'donut', control: { kind: 'select', choices: choices('donut', 'pie') } }, LEGEND, ...STANDARD, MAPPINGS],
  table: [
    {
      path: field('custom.cellOptions.type'),
      label: 'Cell type',
      category: 'Table',
      default: 'auto',
      control: {
        kind: 'select',
        choices: [
          { label: 'Auto', value: 'auto' },
          { label: 'Colored text', value: 'color-text' },
          { label: 'Colored background', value: 'color-background' },
          { label: 'Gauge', value: 'gauge' },
        ],
      },
    },
    { path: field('custom.align'), label: 'Alignment', category: 'Table', default: 'auto', control: { kind: 'select', choices: choices('auto', 'left', 'center', 'right') } },
    { path: field('custom.width'), label: 'Column width', category: 'Table', default: 120, control: { kind: 'number', min: 20, max: 1000, integer: true } },
    { path: field('custom.cellOptions.wrapText'), label: 'Wrap text', category: 'Table', default: false, control: { kind: 'boolean' } },
    ...STANDARD,
    { path: field('noValue'), label: 'No value', category: 'Standard options', help: 'Shown in empty cells.', control: { kind: 'text' } },
    MAPPINGS,
    THRESHOLDS,
  ],
  text: [
    { path: 'options.mode', label: 'Mode', category: 'Text', default: 'markdown', control: { kind: 'select', choices: [{ label: 'Markdown', value: 'markdown' }, { label: 'HTML', value: 'html' }] } },
    { path: 'options.content', label: 'Content', category: 'Text', control: { kind: 'text', multiline: true } },
  ],
  geomap: [
    { path: 'options.tooltip.mode', label: 'Tooltip', category: 'Map', default: 'details', control: { kind: 'select', choices: [{ label: 'Details', value: 'details' }, { label: 'None', value: 'none' }] } },
    { path: 'options.controls.showZoom', label: 'Show zoom buttons', category: 'Map', default: true, control: { kind: 'boolean' } },
    ...STANDARD,
    MAPPINGS,
  ],
};
BY_TYPE.graph = BY_TYPE.timeseries;
BY_TYPE.singlestat = BY_TYPE.stat;

/** The options a panel type reads, beyond its title, queries and size. Empty for types without any (inputs have their own). */
export function panelOptions(type: string): PanelOption[] {
  return BY_TYPE[type] ?? [];
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The value at a dotted path, or undefined. */
export function getPath(value: unknown, path: string): unknown {
  let node = value;
  for (const k of path.split('.')) {
    if (!isObject(node)) return undefined;
    node = node[k];
  }
  return node;
}

/** An option's value as its control shows it. */
export function optionValue(panel: Panel, option: PanelOption): unknown {
  return option.get ? option.get(panel) : getPath(panel, option.path);
}

/** Sets an option as its control gives it. Undefined (or '') unsets it. */
export function setOption(panel: Panel, option: PanelOption, value: unknown): Panel {
  return option.set ? option.set(panel, value) : setOptionValue(panel, option.path, value);
}

/**
 * A copy of the panel with the value at a dotted path set, making objects on the way as
 * needed. Undefined or '' removes it, along with any objects that leaves empty, so clearing a
 * field leaves no trace in the JSON.
 */
export function setOptionValue(panel: Panel, path: string, value: unknown): Panel {
  const keys = path.split('.');
  const put = (node: unknown, i: number): Record<string, unknown> | undefined => {
    const next = { ...(isObject(node) ? node : {}) };
    const k = keys[i];
    const child = i === keys.length - 1 ? (value === '' ? undefined : value) : put(next[k], i + 1);
    if (child === undefined) delete next[k];
    else next[k] = child;
    return Object.keys(next).length || i === 0 ? next : undefined;
  };
  return put(panel, 0) as Panel;
}

function storedType(option: PanelOption): NonNullable<PanelOption['stored']> {
  if (option.stored) return option.stored;
  switch (option.control.kind) {
    case 'boolean':
      return 'boolean';
    case 'number':
      return 'number';
    case 'thresholds':
      return 'object';
    case 'mappings':
      return 'list';
    default:
      return 'string';
  }
}

function fits(value: unknown, type: NonNullable<PanelOption['stored']>): boolean {
  switch (type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'string[]':
      return Array.isArray(value) && value.every((v) => typeof v === 'string');
    case 'object':
      return isObject(value);
    case 'list':
      return Array.isArray(value);
    default:
      return typeof value === type;
  }
}

/**
 * Removes, in place, option values of the wrong type for what the panel's type reads, and
 * anything on the way to one that isn't an object. Returns where each was, relative to the
 * panel (like `.options.legend.showLegend`), and why.
 */
export function cleanPanelOptions(panel: Panel): { path: string; message: string }[] {
  const removed: { path: string; message: string }[] = [];
  for (const option of panelOptions(panel.type)) {
    const keys = option.path.split('.');
    let node: Record<string, unknown> = panel;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (!(k in node) || node[k] === undefined) break;
      const last = i === keys.length - 1;
      const type = last ? storedType(option) : 'object';
      if (!fits(node[k], type)) {
        removed.push({ path: `.${keys.slice(0, i + 1).join('.')}`, message: mustBe(type) });
        delete node[k];
        break;
      }
      if (!last) node = node[k] as Record<string, unknown>;
      else if (option.control.kind === 'mappings') removed.push(...cleanMappings(node[k] as unknown[], `.${option.path}`));
    }
  }
  removed.push(...cleanOverrides(panel));
  return removed;
}

const mustBe = (type: NonNullable<PanelOption['stored']>) =>
  `must be ${type === 'string[]' ? 'a list of strings' : type === 'object' ? 'an object' : type === 'list' ? 'a list' : `a ${type}`}`;

/** Removes, in place, mappings the renderer can't use. */
function cleanMappings(list: unknown[], at: string): { path: string; message: string }[] {
  const removed: { path: string; message: string }[] = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const problem = mappingProblem(list[i]);
    if (!problem) continue;
    removed.unshift({ path: `${at}[${i}]`, message: problem });
    list.splice(i, 1);
  }
  return removed;
}

/** Override property ids are dotted paths into a field's config. */
const PROPERTY_ID = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;
const UNSAFE_KEY = /(^|\.)(__proto__|constructor|prototype)(\.|$)/;

/** Removes, in place, overrides and override properties the renderer can't use. */
function cleanOverrides(panel: Panel): { path: string; message: string }[] {
  const fc = panel.fieldConfig as Record<string, unknown> | undefined;
  if (!isObject(fc) || fc.overrides === undefined) return [];
  if (!Array.isArray(fc.overrides)) {
    delete fc.overrides;
    return [{ path: '.fieldConfig.overrides', message: 'must be a list' }];
  }
  const removed: { path: string; message: string }[] = [];
  const known = new Map(overrideProperties(panel.type).map((p) => [p.id, p]));
  const overrides = fc.overrides as unknown[];
  for (let i = overrides.length - 1; i >= 0; i--) {
    const o = overrides[i];
    const at = `.fieldConfig.overrides[${i}]`;
    if (!isObject(o) || !isObject(o.matcher) || typeof o.matcher.id !== 'string' || !Array.isArray(o.properties)) {
      removed.unshift({ path: at, message: 'must have a matcher with an id and a list of properties' });
      overrides.splice(i, 1);
      continue;
    }
    const props = o.properties as unknown[];
    const mine: { path: string; message: string }[] = [];
    for (let j = props.length - 1; j >= 0; j--) {
      const p = props[j];
      const pat = `${at}.properties[${j}]`;
      let problem: string | undefined;
      if (!isObject(p) || typeof p.id !== 'string' || !PROPERTY_ID.test(p.id) || UNSAFE_KEY.test(p.id)) problem = 'must have an id that is a dotted path';
      else if (p.value !== undefined && known.has(p.id)) {
        const type = storedType(known.get(p.id)!.option);
        if (!fits(p.value, type)) problem = `${p.id} ${mustBe(type)}`;
        else if (type === 'list' && known.get(p.id)!.option.control.kind === 'mappings') mine.unshift(...cleanMappings(p.value as unknown[], `${pat}.value`));
      }
      if (!problem) continue;
      mine.unshift({ path: pat, message: problem });
      props.splice(j, 1);
    }
    removed.unshift(...mine);
  }
  return removed;
}

/** Grafana's field matchers that modelform applies. Overrides with other matchers are kept but match nothing. */
export const OVERRIDE_MATCHERS: { label: string; value: string; help: string }[] = [
  { label: 'Fields with name', value: 'byName', help: 'The series or column name, before any display name.' },
  { label: 'Fields matching regex', value: 'byRegexp', help: 'Tested against the display name.' },
  { label: 'Fields returned by query', value: 'byFrameRefID', help: 'Every field of one query.' },
  { label: 'Fields with type', value: 'byType', help: 'number, string, time or boolean.' },
];

export interface OverrideProperty {
  /** The property id, a path into the field's config, e.g. "unit" or "custom.lineWidth". */
  id: string;
  /** How it's edited; its default is the panel's. */
  option: PanelOption;
  /** For values not stored as the control shows them (a fixed color is stored as a color object). */
  get?(value: unknown): unknown;
  set?(value: unknown): unknown;
}

const FIELD_PREFIX = 'fieldConfig.defaults.';

/** What an override can set on the fields it matches, for a panel type: its field options, with one Color in place of the color scheme pair. */
export function overrideProperties(type: string): OverrideProperty[] {
  const out: OverrideProperty[] = [];
  for (const option of panelOptions(type)) {
    if (!option.path.startsWith(FIELD_PREFIX) || option.path === field('color.fixedColor')) continue;
    if (option.path === field('color.mode'))
      out.push({
        id: 'color',
        option: { path: field('color'), label: 'Color', category: 'Standard options', help: 'One color for these fields.', control: { kind: 'color' }, stored: 'object' },
        get: (v) => (isObject(v) ? v.fixedColor : undefined),
        set: (v) => (v === undefined || v === '' ? undefined : { mode: 'fixed', fixedColor: v }),
      });
    else out.push({ id: option.path.slice(FIELD_PREFIX.length), option });
  }
  return out;
}

/** The panel's overrides, or none. */
export function panelOverrides(panel: Panel): FieldOverride[] {
  const o = panel.fieldConfig?.overrides;
  return Array.isArray(o) ? o : [];
}

/** A copy of the panel with its overrides replaced; none removes the key. */
export function setOverrides(panel: Panel, overrides: FieldOverride[]): Panel {
  return setOptionValue(panel, 'fieldConfig.overrides', overrides.length ? overrides : undefined);
}
