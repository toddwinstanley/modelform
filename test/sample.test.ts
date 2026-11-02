import { describe, expect, it } from 'vitest';
import { sampleEntries, type Dashboard } from '../src';

const form: Dashboard = {
  title: 'F',
  panels: [
    { type: 'input-select', gridPos: { x: 0, y: 0, w: 24, h: 3 }, options: { metric: 'mood', choices: [{ label: 'Good', value: 'good' }, { label: 'Bad', value: 'bad' }] } },
    { type: 'input-rating', gridPos: { x: 0, y: 3, w: 24, h: 3 }, options: { metric: 'sleep', max: 5 } },
    { type: 'input-slider', gridPos: { x: 0, y: 6, w: 24, h: 3 }, options: { metric: 'energy', min: 0, max: 10, step: 1 } },
  ],
};
const NOW = Date.UTC(2026, 9, 31, 12);

describe('sample entries', () => {
  const entries = sampleEntries([form], ['weight'], NOW, 60);
  const of = (m: string) => entries.filter((e) => e.metric === m);

  it('shapes each metric by the input that records it', () => {
    expect(new Set(of('mood').map((e) => e.text))).toEqual(new Set(['good', 'bad']));
    expect(of('mood').every((e) => e.value === null)).toBe(true);
    expect(of('sleep').every((e) => Number.isInteger(e.value) && e.value! >= 1 && e.value! <= 5)).toBe(true);
    expect(of('energy').every((e) => e.value! >= 0 && e.value! <= 10)).toBe(true);
    expect(of('weight').length).toBeGreaterThan(30);
  });

  it('stays in the window and repeats exactly', () => {
    expect(entries.every((e) => e.ts <= NOW && e.ts > NOW - 61 * 86_400_000)).toBe(true);
    expect(sampleEntries([form], ['weight'], NOW, 60)).toEqual(entries);
  });
});
