import { describe, expect, it } from 'vitest';
import { toXYSeries, type DataFrame, type Panel } from '../src/core';
import { styledXYSeries } from '../src/ui/chart';

const num = (name: string, values: unknown[]) => ({ name, type: 'number' as const, values });

// Shaped like a Downshifts trace: seconds from the clutch release, then the pedals.
const trace: DataFrame = {
  refId: 'A',
  fields: [num('Brake', [0.9, 0.2, null, 0.5]), num('From release', [-0.5, 0.5, 1, 0]), num('Throttle', [0, 0.4, 0.1, '0.3'])],
};

describe('trend series', () => {
  it('plots every other number field against xField, in x order', () => {
    const { series, x } = toXYSeries([trace], 'From release');
    expect(x?.field.name).toBe('From release');
    expect(series.map((s) => s.name)).toEqual(['Brake', 'Throttle']);
    expect(series[0].times).toEqual([-0.5, 0, 0.5, 1]);
    expect(series[0].values).toEqual([0.9, 0.5, 0.2, null]);
    expect(series[1].values).toEqual([0, 0.3, 0.4, 0.1]);
  });

  it('defaults to the first number field and skips frames without the x field', () => {
    expect(toXYSeries([trace]).x?.field.name).toBe('Brake');
    const other: DataFrame = { fields: [num('y', [1])] };
    expect(toXYSeries([other, trace], 'From release').series.map((s) => s.name)).toEqual(['Brake', 'Throttle']);
  });

  it("uses the x field's overrides for axis labels", () => {
    const panel: Panel = {
      type: 'trend',
      gridPos: { x: 0, y: 0, w: 8, h: 6 },
      options: { xField: 'From release' },
      fieldConfig: { overrides: [{ matcher: { id: 'byName', options: 'From release' }, properties: [{ id: 'unit', value: 'suffix: s' }] }] },
    };
    const { series, xConfig } = styledXYSeries(panel, [trace], 'light');
    expect(xConfig.unit).toBe('suffix: s');
    expect(series).toHaveLength(2);
  });
});
