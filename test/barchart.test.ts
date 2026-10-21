import { describe, expect, it } from 'vitest';
import type { DataFrame, Panel } from '../src/core';
import { barAxes, barCategory, categoryLabels } from '../src/ui/chart';

const day = 86_400_000;
const t0 = Date.UTC(2026, 9, 14);
// Shaped like Driver Progress' "Laps and distance per day": a time column and two numbers, no text column.
const perDay: DataFrame = {
  fields: [
    { name: 'time', type: 'time', values: [t0, t0 + day, t0 + 3 * day] },
    { name: 'Laps', type: 'number', values: [0, 80, 12] },
    { name: 'Distance (km)', type: 'number', values: [0, 82.8, 15] },
  ],
};
const panel = (options: Record<string, unknown> = {}): Panel => ({ type: 'barchart', gridPos: { x: 0, y: 0, w: 24, h: 9 }, options });

describe('bar chart categories', () => {
  it('groups by the time field when there is no text field, one group per row', () => {
    const field = barCategory(panel(), perDay);
    expect(field?.name).toBe('time');
    const date = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    expect(categoryLabels(field!)).toEqual([t0, t0 + day, t0 + 3 * day].map(date));
  });

  it('prefers xField, then a text field', () => {
    const withText: DataFrame = { fields: [...perDay.fields, { name: 'Lap', type: 'string', values: ['a', 'b', 'c'] }] };
    expect(barCategory(panel(), withText)?.name).toBe('Lap');
    expect(barCategory(panel({ xField: 'time' }), withText)?.name).toBe('time');
  });

  it('labels with times of day when bars are under a day apart', () => {
    const hourly = { name: 'time', type: 'time' as const, values: [t0, t0 + 3_600_000] };
    expect(categoryLabels(hourly)[1]).toBe(new Date(t0 + 3_600_000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }));
  });
});

describe('bar chart axes', () => {
  // Driver Progress: Laps on the left, Distance (km) on the right with its own scale.
  const laps = { decimals: 0, min: 0, custom: { axisPlacement: 'left', axisLabel: 'laps' } };
  const km = { unit: 'suffix: km', min: 0, custom: { axisPlacement: 'right', axisLabel: 'km' } };

  it('scales right-placed fields on their own axis', () => {
    const axes = barAxes([laps, km], [[0, 80, 12], [0, 182.8, 15]], 4);
    expect(axes.map((a) => [a.side, a.fields, a.top, a.label])).toEqual([
      ['left', [0], 80, 'laps'],
      ['right', [1], 200, 'km'],
    ]);
    expect(axes[1].ticks).toEqual([0, 50, 100, 150, 200]);
  });

  it('keeps everything on one left axis by default, and honours max and hidden', () => {
    const axes = barAxes([{}, { max: 500 }], [[1, 2], [3, 4]], 4);
    expect(axes.map((a) => [a.side, a.fields])).toEqual([['left', [0, 1]]]);
    expect(barAxes([{ max: 500 }], [[3]], 4)[0].top).toBe(500);
    expect(barAxes([{ custom: { axisPlacement: 'hidden' } }], [[0, 0]], 4)[0]).toMatchObject({ show: false, top: 1 });
  });
});

it('drops ticks above a set max', () => {
  expect(barAxes([{ max: 90 }], [[10]], 4)[0].ticks).toEqual([0, 25, 50, 75]);
});
