import { describe, expect, it } from 'vitest';
import { applyTransformations, type DataFrame, type Panel } from '../src/core';
import { cellDisplay, contrastText, tableColumns, tableFooter } from '../src/ui/table';

const field = (name: string, type: 'string' | 'number', values: unknown[]) => ({ name, type, values });
const steps = [
  { color: 'green', value: null },
  { color: 'yellow', value: 0.1 },
  { color: 'red', value: 0.5 },
];

// Section Rankings' "Recent Laps against the Section Bests": a matrix colored by time lost, null as "not timed".
const sections: Panel = {
  type: 'table',
  gridPos: { x: 0, y: 0, w: 24, h: 10 },
  transformations: [{ id: 'groupingToMatrix', options: { columnField: 'section', rowField: 'lap', valueField: 'lost', emptyValue: 'null' } }],
  fieldConfig: {
    defaults: {
      color: { mode: 'thresholds' },
      custom: { align: 'auto', cellOptions: { type: 'color-background', mode: 'basic' } },
      decimals: 3,
      noValue: '',
      thresholds: { mode: 'absolute', steps },
      mappings: [{ type: 'special', options: { match: 'null', result: { color: '#6e7079', text: 'not timed' } } }],
    },
    overrides: [
      { matcher: { id: 'byName', options: 'lap\\section' }, properties: [{ id: 'custom.cellOptions', value: { type: 'auto' } }, { id: 'custom.width', value: 300 }] },
      { matcher: { id: 'byName', options: 'Total' }, properties: [{ id: 'custom.cellOptions', value: { type: 'auto' } }] },
    ],
  },
};
const long: DataFrame = {
  fields: [field('lap', 'string', ['L8', 'L8', 'L8']), field('section', 'string', ['S1', 'S2', 'Total']), field('lost', 'number', [null, 0.27919, 0.9418])],
};

describe('table field config', () => {
  it('colors the section matrix like Grafana', () => {
    const [frame] = applyTransformations([long], sections.transformations);
    const cols = tableColumns(sections, frame);
    expect(cols.map((c) => [c.name, c.width, c.cellType, c.align])).toEqual([
      ['lap\\section', 300, 'auto', 'left'],
      ['S1', 120, 'color-background', 'right'],
      ['S2', 120, 'color-background', 'right'],
      ['Total', 120, 'auto', 'right'],
    ]);
    const cell = (i: number) => cellDisplay(cols[i], cols[i].field.values[0], '#000');
    expect(cell(1)).toEqual({ text: 'not timed', background: '#6e7079' });
    expect(cell(2)).toEqual({ text: '0.279', background: '#FADE2A' });
    expect(cell(3)).toEqual({ text: '0.942' });
  });

  it('hides columns, renames them, and applies units, noValue and regex mappings', () => {
    const panel: Panel = {
      type: 'table',
      gridPos: { x: 0, y: 0, w: 24, h: 10 },
      fieldConfig: {
        defaults: { noValue: '-' },
        overrides: [
          { matcher: { id: 'byName', options: 'id' }, properties: [{ id: 'custom.hidden', value: true }] },
          { matcher: { id: 'byName', options: 'speed' }, properties: [{ id: 'displayName', value: 'Speed' }, { id: 'unit', value: 'suffix: km/h' }, { id: 'decimals', value: 1 }] },
          { matcher: { id: 'byName', options: 'track' }, properties: [{ id: 'mappings', value: [{ type: 'regex', options: { pattern: '/^ks_(.*)$/', result: { text: '$1' } } }] }] },
        ],
      },
    };
    const frame: DataFrame = { fields: [field('id', 'string', ['a']), field('speed', 'number', [null]), field('track', 'string', ['ks_monza'])] };
    const cols = tableColumns(panel, frame);
    expect(cols.map((c) => c.name)).toEqual(['Speed', 'track']);
    expect(cellDisplay(cols[0], 123.45, '#000').text).toBe('123.5 km/h');
    expect(cellDisplay(cols[0], null, '#000').text).toBe('-');
    expect(cellDisplay(cols[1], 'ks_monza', '#000').text).toBe('monza');
  });

  it('draws gauges against min/max or the column range, and colored text', () => {
    const panel: Panel = {
      type: 'table',
      gridPos: { x: 0, y: 0, w: 24, h: 10 },
      fieldConfig: { defaults: { custom: { cellOptions: { type: 'gauge', mode: 'basic' } }, thresholds: { mode: 'absolute', steps } } },
    };
    const [col] = tableColumns(panel, { fields: [field('v', 'number', [0, 0.25, 1])] });
    expect(cellDisplay(col, 0.25, '#000')).toMatchObject({ gauge: 0.25, gaugeColor: '#FADE2A' });
    const textPanel = { ...panel, fieldConfig: { defaults: { custom: { cellOptions: { type: 'color-text' } }, color: { mode: 'thresholds' }, thresholds: { mode: 'absolute' as const, steps: [{ color: 'text', value: null }, { color: 'red', value: 1 }] } } } };
    const [t] = tableColumns(textPanel, { fields: [field('v', 'number', [0, 2])] });
    expect(cellDisplay(t, 0, '#000').color).toBeUndefined();
    expect(cellDisplay(t, 2, '#000').color).toBe('#F2495C');
  });

  it('picks readable text on a background', () => {
    expect(contrastText('#FADE2A', '#fff')).toBe('#111111');
    expect(contrastText('#6e7079', '#fff')).toBe('#ffffff');
    expect(contrastText('transparent', '#abc')).toBe('#abc');
  });
});

describe('table footer', () => {
  const frame: DataFrame = {
    fields: [field('Lap', 'string', ['L1', 'L2', 'L3']), field('Time', 'number', [80, 79, 81]), field('Fuel', 'number', [2, 2.5, null])],
  };
  const base = (extra: Partial<Panel>): Panel => ({ type: 'table', gridPos: { x: 0, y: 0, w: 24, h: 10 }, ...extra });
  const texts = (p: Panel) => tableFooter(tableColumns(p, frame))?.map((lines) => lines.map((l) => (l.label ? `${l.label} ${l.text}` : l.text)));

  it("reads Grafana 13's per-field reducers, formatted with the column's config", () => {
    const panel = base({
      fieldConfig: {
        defaults: {},
        overrides: [
          { matcher: { id: 'byName', options: 'Time' }, properties: [{ id: 'custom.footer.reducers', value: ['mean', 'max'] }, { id: 'unit', value: 'suffix: s' }] },
          { matcher: { id: 'byName', options: 'Fuel' }, properties: [{ id: 'custom.footer.reducers', value: ['sum'] }, { id: 'decimals', value: 1 }] },
        ],
      },
    });
    expect(texts(panel)).toEqual([[], ['Mean 80 s', 'Max 81 s'], ['4.5']]);
    expect(tableFooter(tableColumns(base({}), frame))).toBeNull();
  });

  it('converts the older options.footer like Grafana does', () => {
    const footer = (f: Record<string, unknown>) => texts(base({ options: { footer: { show: true, ...f } } }));
    expect(footer({ reducer: ['sum'], fields: '' })).toEqual([[], ['240'], ['4.5']]);
    expect(footer({ reducer: ['max'], fields: ['Fuel'] })).toEqual([[], [], ['2.5']]);
    expect(footer({ reducer: ['count'], countRows: true })).toEqual([['Count 3'], [], []]);
    expect(tableFooter(tableColumns(base({ options: { footer: { show: false, reducer: ['sum'] } } }), frame))).toBeNull();
  });

  it('counts text columns and skips calculations it has no numbers or name for', () => {
    const panel = base({ fieldConfig: { defaults: { custom: { footer: { reducers: ['distinctCount', 'mean', 'percentile95'] } } }, overrides: [] } });
    expect(texts(panel)).toEqual([['3'], ['Distinct Count 3', 'Mean 80'], ['Distinct Count 2', 'Mean 2.25']]);
  });

  it('hides columns marked hideFrom.viz, as Grafana 13 saves them', () => {
    const panel = base({ fieldConfig: { defaults: {}, overrides: [{ matcher: { id: 'byName', options: 'Fuel' }, properties: [{ id: 'custom.hideFrom.viz', value: true }] }] } });
    expect(tableColumns(panel, frame).map((c) => c.name)).toEqual(['Lap', 'Time']);
  });
});
