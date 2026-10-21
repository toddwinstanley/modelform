import { describe, expect, it } from 'vitest';
import { applyTransformations, queryPanel, type Dashboard, type DataFrame, type DataSource, type Panel } from '../src/core';

const range = { from: 0, to: 1000, raw: { from: '', to: '' } };
const PG = { type: 'grafana-postgresql-datasource', uid: 'pg' };
const DASH = { type: 'datasource', uid: '-- Dashboard --' };
const field = (name: string, type: 'string' | 'number', values: unknown[]) => ({ name, type, values });
const laps: DataFrame = {
  refId: 'A',
  fields: [field('Lap', 'string', ['Lap 1', 'Lap 2']), field('Time', 'number', [80, 79]), field('Understeer', 'number', [1, 2]), field('Oversteer', 'number', [0.5, 0.2])],
};
const names = (frames: DataFrame[]) => frames.flatMap((f) => f.fields.map((x) => x.name));

// Shaped like Passage Details: a table, and a bar chart that reuses the table's results.
const table: Panel = { id: 2, type: 'table', gridPos: { x: 0, y: 0, w: 24, h: 8 }, datasource: PG, targets: [{ refId: 'A', rawSql: 'select laps' }] };
const chart = (extra: Partial<Panel> = {}): Panel => ({
  id: 3,
  type: 'barchart',
  gridPos: { x: 0, y: 8, w: 24, h: 8 },
  datasource: DASH,
  targets: [{ refId: 'A', datasource: DASH, panelId: 2 }],
  transformations: [{ id: 'filterFieldsByName', options: { include: { names: ['Lap', 'Understeer', 'Oversteer'] } } }],
  ...extra,
});

function setup(panels: Panel[]) {
  let calls = 0;
  const ds: DataSource = { query: async () => (calls++, [laps]) };
  const dashboard: Dashboard = { title: 'd', panels };
  const ctx = { resolve: () => ds, range, variables: {}, widthPx: 400, dashboard, shared: new Map() };
  return { ctx, calls: () => calls };
}

describe('-- Dashboard -- datasource', () => {
  it("reuses the source panel's results, querying once, then applies its own transformations", async () => {
    const { ctx, calls } = setup([table, chart()]);
    const [fromTable, fromChart] = await Promise.all([queryPanel(table, ctx), queryPanel(chart(), ctx)]);
    expect(names(fromTable)).toEqual(['Lap', 'Time', 'Understeer', 'Oversteer']);
    expect(names(fromChart)).toEqual(['Lap', 'Understeer', 'Oversteer']);
    expect(calls()).toBe(1);
  });

  it("applies the source's transformations only with withTransforms", async () => {
    const source = { ...table, transformations: [{ id: 'organize', options: { excludeByName: { Time: true } } }] };
    const plain = chart({ transformations: [] });
    const withT = chart({ transformations: [], targets: [{ refId: 'A', datasource: DASH, panelId: 2, withTransforms: true }] });
    const { ctx } = setup([source, plain]);
    expect(names(await queryPanel(plain, ctx))).toContain('Time');
    expect(names(await queryPanel(withT, ctx))).not.toContain('Time');
  });

  it('reports a missing source and a loop', async () => {
    await expect(queryPanel(chart(), setup([chart()]).ctx)).rejects.toThrow('Panel 2 not found');
    const a = chart({ id: 2, targets: [{ refId: 'A', datasource: DASH, panelId: 3 }] });
    const b = chart();
    await expect(queryPanel(b, setup([a, b]).ctx)).rejects.toThrow('loop');
  });
});

describe('transformations', () => {
  it('filters by pattern and exclusion, and organizes', () => {
    expect(names(applyTransformations([laps], [{ id: 'filterFieldsByName', options: { include: { pattern: '/steer$/' } } }]))).toEqual(['Understeer', 'Oversteer']);
    expect(names(applyTransformations([laps], [{ id: 'filterFieldsByName', options: { exclude: { names: ['Time'] } } }]))).toEqual(['Lap', 'Understeer', 'Oversteer']);
    const organized = applyTransformations([laps], [{ id: 'organize', options: { indexByName: { Oversteer: 0 }, renameByName: { Lap: 'Pass' } } }]);
    expect(names(organized)).toEqual(['Oversteer', 'Lap', 'Time', 'Understeer']);
    expect(organized[0].fields[1].config?.displayName).toBe('Pass');
  });

  it('converts field types', () => {
    const frame: DataFrame = {
      fields: [
        field('Laps', 'string', ['80', '', 'x']),
        { name: 'time', type: 'time', values: [Date.UTC(2026, 9, 14, 12)] },
        field('ok', 'string', ['yes', '0']),
        field('when', 'string', ['2026-10-14T12:00:00Z', '1792108800000']),
      ],
    };
    const [out] = applyTransformations([frame], [
      {
        id: 'convertFieldType',
        options: {
          conversions: [
            { targetField: 'Laps', destinationType: 'number' },
            { targetField: 'time', destinationType: 'string', dateFormat: 'YYYY' },
            { targetField: 'ok', destinationType: 'boolean' },
            { targetField: 'when', destinationType: 'time' },
          ],
        },
      },
    ]);
    expect(out.fields.map((f) => [f.type, f.values])).toEqual([
      ['number', [80, null, null]],
      ['string', ['2026']],
      ['boolean', [true, false]],
      ['time', [Date.UTC(2026, 9, 14, 12), 1792108800000]],
    ]);
  });

  it('pivots long rows into a matrix, like Section Rankings', () => {
    const long: DataFrame = {
      fields: [
        field('lap', 'string', ['L8', 'L8', 'L8', 'L7', 'L7']),
        field('section', 'string', ['S1', 'S2', 'Total', 'S2', 'Total']),
        { name: 'lost', type: 'number', values: [null, 0.28, 0.94, 0.1, 0.1], config: { decimals: 3 } },
      ],
    };
    const t = (emptyValue?: string) => [{ id: 'groupingToMatrix', options: { columnField: 'section', rowField: 'lap', valueField: 'lost', emptyValue } }];
    const [m] = applyTransformations([long], t('null'));
    expect(m.fields.map((f) => [f.name, f.values])).toEqual([
      ['lap\\section', ['L8', 'L7']],
      ['S1', [null, null]],
      ['S2', [0.28, 0.1]],
      ['Total', [0.94, 0.1]],
    ]);
    expect(m.fields[1].config?.decimals).toBe(3);
    expect(applyTransformations([long], t())[0].fields[1].values).toEqual([null, '']);
    expect(applyTransformations([long], t('zero'))[0].fields[1].values).toEqual([null, 0]);
  });

  it('skips disabled and unsupported transformations', () => {
    const t = [{ id: 'filterFieldsByName', disabled: true, options: { include: { names: ['Lap'] } } }, { id: 'calculateField' }];
    expect(applyTransformations([laps], t)).toEqual([laps]);
  });
});
