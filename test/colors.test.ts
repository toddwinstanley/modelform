import { describe, expect, it } from 'vitest';
import { resolveColor, seriesColor, SERIES_PALETTE } from '../src/core/format';

describe('named colors', () => {
  it("resolves every shade of Grafana's palette", () => {
    expect(resolveColor('super-light-purple', '#000')).toBe('#DEB6F2');
    expect(resolveColor('dark-green', '#000')).toBe('#37872D');
  });

  it('passes CSS colors through and falls back for unknown names', () => {
    for (const c of ['#abc', '#A1B2C3D4', 'rgba(1, 2, 3, 0.5)', 'white']) expect(resolveColor(c, '#000')).toBe(c);
    expect(resolveColor('ultra-light-teal', '#000')).toBe('#000');
  });

  it('keeps a series visible when its fixed color is unknown', () => {
    expect(seriesColor(1, 'light', { color: { mode: 'fixed', fixedColor: 'ultra-light-teal' } })).toBe(SERIES_PALETTE.light[1]);
  });
});
