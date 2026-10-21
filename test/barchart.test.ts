import { describe, expect, it } from 'vitest';
import type { DataFrame, Panel } from '../src/core';
import { barCategory, categoryLabels } from '../src/ui/chart';

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
