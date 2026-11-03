import { describe, expect, it } from 'vitest';
import {
  cleanPanelOptions,
  formatValue,
  mappingRows,
  OPTION_CATEGORIES,
  optionValue,
  overrideProperties,
  panelOptions,
  prepareDashboard,
  resolveFieldConfig,
  rowsToMappings,
  setOption,
  setOptionValue,
  setOverrides,
  type DataFrame,
  type Panel,
  type ValueMapping,
} from '../src';
import { reducedValues } from '../src/ui/chart';

const panel = (extra: Partial<Panel> = {}): Panel => ({ type: 'stat', title: 'P', gridPos: { x: 0, y: 0, w: 6, h: 4 }, ...extra });
const option = (type: string, path: string) => panelOptions(type).find((o) => o.path === path)!;

describe('panel options', () => {
  it('lists options in known categories, with defaults their controls can show', () => {
    for (const type of ['timeseries', 'trend', 'barchart', 'xychart', 'stat', 'gauge', 'bargauge', 'piechart', 'table', 'text', 'geomap']) {
      const options = panelOptions(type);
      expect(options.length, type).toBeGreaterThan(0);
      expect(new Set(options.map((o) => o.path)).size, `${type} lists a path twice`).toBe(options.length);
      for (const o of options) {
        expect(OPTION_CATEGORIES, `${type} ${o.path}`).toContain(o.category);
        if (o.default === undefined) continue;
        if (o.control.kind === 'select') expect(o.control.choices.map((c) => c.value), `${type} ${o.path}`).toContain(o.default);
        if (o.control.kind === 'boolean') expect(typeof o.default).toBe('boolean');
        if (o.control.kind === 'number') expect(typeof o.default).toBe('number');
      }
    }
    expect(panelOptions('input-number')).toEqual([]);
  });

  it('sets values at a path and prunes what clearing leaves empty', () => {
    const p = setOptionValue(panel(), 'fieldConfig.defaults.custom.lineWidth', 3);
    expect(p.fieldConfig).toEqual({ defaults: { custom: { lineWidth: 3 } } });
    expect(setOptionValue(p, 'fieldConfig.defaults.custom.lineWidth', undefined)).toEqual(panel());
    // Siblings stay; '' counts as clearing.
    const q = setOptionValue(setOptionValue(p, 'fieldConfig.defaults.unit', 'percent'), 'fieldConfig.defaults.custom.lineWidth', '');
    expect(q.fieldConfig).toEqual({ defaults: { unit: 'percent' } });
    // Something that isn't an object on the way is replaced.
    expect(setOptionValue(panel({ options: { legend: 5 } }), 'options.legend.showLegend', false).options).toEqual({ legend: { showLegend: false } });
  });

  it('keeps a reducer as a one-item list, as Grafana does', () => {
    const calc = option('stat', 'options.reduceOptions.calcs');
    const p = setOption(panel(), calc, 'max');
    expect(p.options).toEqual({ reduceOptions: { calcs: ['max'] } });
    expect(optionValue(p, calc)).toBe('max');
    expect(setOption(p, calc, undefined).options).toBeUndefined();
  });

  it('shows the legend unless either way of hiding it is set', () => {
    const legend = option('timeseries', 'options.legend.showLegend');
    expect(optionValue(panel(), legend)).toBe(true);
    const hidden = panel({ options: { legend: { displayMode: 'hidden', placement: 'bottom' } } });
    expect(optionValue(hidden, legend)).toBe(false);
    const shown = setOption(hidden, legend, true);
    expect(shown.options).toEqual({ legend: { placement: 'bottom' } });
    expect(setOption(shown, legend, false).options).toEqual({ legend: { placement: 'bottom', showLegend: false } });
  });

  it('removes values of the wrong type, and leaves the rest', () => {
    const p = panel({
      type: 'timeseries',
      options: { legend: 'yes', tooltip: { mode: 'multi' } },
      fieldConfig: { defaults: { unit: 'percent', custom: { lineWidth: 'thick', fillOpacity: 20, showPoints: 3 } } },
    });
    expect(cleanPanelOptions(p)).toEqual([
      { path: '.options.legend', message: 'must be an object' },
      { path: '.fieldConfig.defaults.custom.lineWidth', message: 'must be a number' },
      { path: '.fieldConfig.defaults.custom.showPoints', message: 'must be a string' },
    ]);
    expect(p.options).toEqual({ tooltip: { mode: 'multi' } });
    expect(p.fieldConfig!.defaults).toEqual({ unit: 'percent', custom: { fillOpacity: 20 } });
  });

  it('is part of readying a dashboard, collapsed rows included', () => {
    const { dashboard, issues } = prepareDashboard(
      {
        title: 'D',
        panels: [
          panel({ options: { reduceOptions: { calcs: 'max' } } }),
          { type: 'row', title: 'R', collapsed: true, gridPos: { x: 0, y: 4, w: 24, h: 1 }, panels: [panel({ type: 'text', options: { content: 7 } })] },
        ],
      },
      'd.json',
    );
    expect(dashboard!.panels[0].options).toEqual({ reduceOptions: {} });
    expect(dashboard!.panels[1].panels![0].options).toEqual({});
    expect(issues.map((i) => `${i.path} ${i.message}`)).toEqual([
      'd.json: panels[0].options.reduceOptions.calcs must be a list of strings, so it’s ignored',
      'd.json: panels[1].panels[0].options.content must be a string, so it’s ignored',
    ]);
  });
});

describe('value mappings', () => {
  it('edits as one row per condition, in the order Grafana shows them', () => {
    const grafana: ValueMapping[] = [
      { type: 'value', options: { '1': { text: 'One', index: 2 }, high: { text: 'High', color: 'red', index: 0 } } },
      { type: 'range', options: { from: 10, to: null, result: { text: 'Lots', index: 1 } } },
      { type: 'future', options: { x: 1 } },
    ];
    const rows = mappingRows(grafana);
    expect(rows.map((r) => r.type)).toEqual(['value', 'value', 'range', 'other']);
    expect(rows.slice(0, 2).map((r) => r.type === 'value' && r.value)).toEqual(['high', '1']);
    // Each value gets its own mapping, so editing one never reorders or merges the others.
    expect(rowsToMappings(rows)).toEqual([
      { type: 'value', options: { high: { text: 'High', color: 'red', index: 0 } } },
      { type: 'value', options: { '1': { text: 'One', index: 2 } } },
      { type: 'range', options: { from: 10, to: null, result: { text: 'Lots', index: 1 } } },
      { type: 'future', options: { x: 1 } },
    ]);
  });

  it('shows on stats, gauges and pies: the text in place of the value, and its color', () => {
    const frame: DataFrame = { refId: 'A', fields: [{ name: 'time', type: 'time', values: [1, 2] }, { name: 'mood', type: 'number', values: [3, 1] }] };
    const p = panel({
      fieldConfig: {
        defaults: {
          unit: 'percent',
          thresholds: { steps: [{ value: null, color: 'green' }] },
          mappings: [{ type: 'value', options: { '1': { text: 'Low', color: 'red' } } }, { type: 'range', options: { from: 5, to: 9, result: { color: 'blue' } } }],
        },
      },
    });
    const [low] = reducedValues(p, [frame], 'light');
    expect(low.text).toBe('Low');
    expect(low.stateColor).toBe('#F2495C');
    // A mapping with only a color keeps the formatted value.
    const [mid] = reducedValues(p, [{ ...frame, fields: [frame.fields[0], { ...frame.fields[1], values: [6] }] }], 'light');
    expect(mid.text).toBe(formatValue(6, { unit: 'percent' }));
    expect(mid.stateColor).toBe('#5794F2');
    // Unmapped, it's the threshold color as before.
    const [plain] = reducedValues(p, [{ ...frame, fields: [frame.fields[0], { ...frame.fields[1], values: [50] }] }], 'light');
    expect([plain.text, plain.stateColor]).toEqual([formatValue(50, { unit: 'percent' }), '#73BF69']);
  });

  it('drops mappings the renderer can’t use when loading', () => {
    const p = panel({
      fieldConfig: {
        defaults: {
          mappings: [
            { type: 'value', options: { a: { text: 'A' } } },
            { type: 'value' },
            { type: 'range', options: { from: 'low', result: {} } },
            { type: 'special', options: { match: 'maybe', result: {} } },
            { type: 'regex', options: { pattern: '.*', result: { text: 5 } } },
            { type: 'someday' },
          ] as ValueMapping[],
        },
      },
    });
    expect(cleanPanelOptions(p).map((r) => `${r.path} ${r.message}`)).toEqual([
      '.fieldConfig.defaults.mappings[1] needs options',
      '.fieldConfig.defaults.mappings[2] from and to must be numbers',
      '.fieldConfig.defaults.mappings[3] match must be one of null, nan, null+nan, true, false, empty',
      '.fieldConfig.defaults.mappings[4] text must be a string',
    ]);
    expect(p.fieldConfig!.defaults!.mappings).toEqual([{ type: 'value', options: { a: { text: 'A' } } }, { type: 'someday' }]);
  });
});

describe('field overrides', () => {
  it('offer the panel’s field options, with one Color for the color scheme pair', () => {
    const stat = overrideProperties('stat');
    const ids = stat.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['unit', 'decimals', 'displayName', 'color', 'mappings', 'thresholds']));
    expect(ids).not.toContain('color.mode');
    expect(ids).not.toContain('color.fixedColor');
    expect(overrideProperties('timeseries').map((p) => p.id)).toContain('custom.lineWidth');
    expect(overrideProperties('text')).toEqual([]);
    const color = stat.find((p) => p.id === 'color')!;
    expect(color.set!('red')).toEqual({ mode: 'fixed', fixedColor: 'red' });
    expect(color.get!({ mode: 'fixed', fixedColor: 'red' })).toBe('red');
  });

  it('apply to matching fields, once given a value', () => {
    const frame: DataFrame = { refId: 'B', fields: [{ name: 'weight', type: 'number', values: [1] }] };
    const p = panel({
      fieldConfig: {
        defaults: { unit: 'short' },
        overrides: [
          { matcher: { id: 'byName', options: 'weight' }, properties: [{ id: 'unit', value: 'masskg' }, { id: 'decimals', value: undefined }] },
          { matcher: { id: 'byFrameRefID', options: 'A' }, properties: [{ id: 'unit', value: 'percent' }] },
        ],
      },
    });
    expect(resolveFieldConfig(p, frame.fields[0], frame, 'weight')).toEqual({ unit: 'masskg', custom: {} });
    expect(setOverrides(p, []).fieldConfig).toEqual({ defaults: { unit: 'short' } });
  });

  it('are cleaned when loading: broken overrides and wrong-typed properties go, the rest stay', () => {
    const p = panel({
      fieldConfig: {
        overrides: [
          { matcher: { id: 'byName', options: 'a' }, properties: [{ id: 'unit', value: 3 }, { id: 'decimals', value: 1 }, { id: '__proto__.x', value: 1 }, { id: 'custom.anything', value: [1] }] },
          { matcher: 'byName', properties: [] },
          { matcher: { id: 'byType', options: 'number' }, properties: [{ id: 'mappings', value: [{ type: 'value' }, { type: 'value', options: {} }] }, { id: 'color', value: 'red' }] },
        ] as never,
      },
    });
    expect(cleanPanelOptions(p).map((r) => `${r.path} ${r.message}`)).toEqual([
      '.fieldConfig.overrides[0].properties[0] unit must be a string',
      '.fieldConfig.overrides[0].properties[2] must have an id that is a dotted path',
      '.fieldConfig.overrides[1] must have a matcher with an id and a list of properties',
      '.fieldConfig.overrides[2].properties[0].value[0] needs options',
      '.fieldConfig.overrides[2].properties[1] color must be an object',
    ]);
    expect(p.fieldConfig!.overrides).toEqual([
      { matcher: { id: 'byName', options: 'a' }, properties: [{ id: 'decimals', value: 1 }, { id: 'custom.anything', value: [1] }] },
      { matcher: { id: 'byType', options: 'number' }, properties: [{ id: 'mappings', value: [{ type: 'value', options: {} }] }] },
    ]);
  });
});
