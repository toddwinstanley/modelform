import { describe, expect, it } from 'vitest';
import { formatDisplay, valueColor, type DataFrame, type Panel } from '../src/core';
import { xyDomain, xySeries } from '../src/ui/xychart';

const num = (name: string, values: unknown[]) => ({ name, type: 'number' as const, values });
const frame: DataFrame = {
  refId: 'A',
  fields: [num('X', [0, 1, null, 3]), num('Y', [0, 1, 2, 3]), num('Pedal', [-1, 0, 1, 1]), { name: 'Into lap', type: 'string', values: ['a', 'b', 'c', 'd'] }, num('Speed', [10, 20, 30, 40])],
};
const steps = { mode: 'absolute' as const, steps: [{ color: 'red', value: null }, { color: 'yellow', value: 0 }, { color: 'green', value: 1 }] };
const by = (name: string) => ({ matcher: { id: 'byName', options: name } });

// Shaped like Lap Map: one manual series, X against Y, colored by Pedal's thresholds.
const lapMap: Panel = {
  type: 'xychart',
  gridPos: { x: 0, y: 0, w: 12, h: 22 },
  options: { mapping: 'manual', series: [{ frame: { matcher: { id: 'byIndex', options: 0 } }, x: by('X'), y: by('Y'), color: by('Pedal'), name: { fixed: 'Racing line' } }] },
  fieldConfig: {
    defaults: { color: { mode: 'thresholds' }, custom: { pointSize: { fixed: 6 }, show: 'points' }, thresholds: { mode: 'absolute', steps: [{ color: 'text', value: null }] } },
    overrides: [{ matcher: { id: 'byName', options: 'Pedal' }, properties: [{ id: 'thresholds', value: steps }] }],
  },
};

describe('xychart series', () => {
  it('maps a manual series, skipping rows without x or y, and colors points by the color field', () => {
    const [s, ...rest] = xySeries(lapMap, [frame], 'light');
    expect(rest).toEqual([]);
    expect(s.name).toBe('Racing line');
    expect(s.rows).toEqual([0, 1, 3]);
    expect(s.xs).toEqual([0, 1, 3]);
    expect(s.colors).toEqual(['#F2495C', '#FADE2A', '#73BF69']);
    expect(s.sizes).toEqual([6, 6, 6]);
    expect(s.color).toBe('#888888');
  });

  it('plots every other numeric field against the first in auto mode', () => {
    const auto = { ...lapMap, options: {}, fieldConfig: {} };
    expect(xySeries(auto, [frame], 'light').map((s) => [s.xField.name, s.yField.name])).toEqual([
      ['X', 'Y'],
      ['X', 'Pedal'],
      ['X', 'Speed'],
    ]);
  });

  it('reads dashboards saved before Grafana 11', () => {
    const manual = { ...lapMap, options: { seriesMapping: 'manual', series: [{ x: 'Speed', y: 'Y', pointColor: { field: 'Pedal' }, pointSize: { field: 'Speed', min: 2, max: 8 } }] } };
    const [s] = xySeries(manual, [frame], 'light');
    expect([s.xField.name, s.yField.name]).toEqual(['Speed', 'Y']);
    expect(s.sizes).toEqual([2, 4, 6, 8]);
    const auto = { ...lapMap, options: { seriesMapping: 'auto', dims: { x: 'Speed', exclude: ['Pedal', 'X'] } } };
    expect(xySeries(auto, [frame], 'light').map((x) => [x.xField.name, x.yField.name])).toEqual([['Speed', 'Y']]);
  });

  it('pads the domain unless min and max are set', () => {
    expect(xyDomain([[0, 10]], {})).toEqual([-0.5, 10.5]);
    expect(xyDomain([[0, 10]], { min: -1.05, max: 1.05 })).toEqual([-1.05, 1.05]);
  });
});

describe('value colors and mappings', () => {
  it('interpolates continuous schemes and applies mappings', () => {
    const c = { color: { mode: 'continuous-GrYlRd' }, min: 0, max: 1 };
    expect(valueColor(0, c, '#000')).toBe('#73bf69');
    expect(valueColor(0.5, c, '#000')).toBe('#fade2a');
    const gear = { mappings: [{ type: 'value', options: { '-1': { text: 'R' }, '0': { text: 'N' } } }], decimals: 0 };
    expect([-1, 0, 3].map((g) => formatDisplay(g, gear))).toEqual(['R', 'N', '3']);
    expect(formatDisplay(5, { mappings: [{ type: 'range', options: { from: 4, to: 6, result: { text: 'mid' } } }] })).toBe('mid');
  });
});
