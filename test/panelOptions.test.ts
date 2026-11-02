import { describe, expect, it } from 'vitest';
import { cleanPanelOptions, OPTION_CATEGORIES, optionValue, panelOptions, prepareDashboard, setOption, setOptionValue, type Panel } from '../src';

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
