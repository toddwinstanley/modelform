import { describe, expect, it } from 'vitest';
import { copyPanels, parseSnippet, pasteSnippet, previewPaste, type Dashboard, type Panel, type PanelSnippet, type TemplateVariable } from '../src/core';

const chart = (id: number, x: number, y: number, w: number, extra: Partial<Panel> = {}): Panel => ({
  id,
  type: 'timeseries',
  title: `C${id}`,
  gridPos: { x, y, w, h: 4 },
  datasource: { type: 'modelform-local' },
  targets: [{ refId: 'A', metric: `m${id}` }],
  ...extra,
});
const row = (id: number, y: number, extra: Partial<Panel> = {}): Panel => ({ id, type: 'row', title: `R${id}`, gridPos: { x: 0, y, w: 24, h: 1 }, ...extra });
const input = (id: number, y: number, metric: string): Panel => ({ id, type: 'input-number', title: `I${id}`, gridPos: { x: 0, y, w: 24, h: 3 }, options: { metric } });
const custom = (name: string, query = 'a,b'): TemplateVariable => ({ name, type: 'custom', query, current: { text: 'a', value: 'a' } });

const source: Dashboard = {
  title: 'Source',
  templating: { list: [custom('host'), custom('unused'), { name: 'region', type: 'custom', query: '$host-east,$host-west' }] },
  panels: [
    chart(1, 0, 0, 12),
    chart(2, 12, 2, 12, { title: 'On $region' }),
    row(10, 6),
    chart(3, 6, 7, 6),
    chart(4, 12, 7, 6),
    row(11, 11, { collapsed: true, panels: [chart(5, 0, 12, 24)] }),
  ],
};

describe('copyPanels', () => {
  it('lifts panels out with positions relative to the block and no ids', () => {
    const s = copyPanels(source, [1]);
    expect(s).toMatchObject({ $modelform: 'panels', version: 1, kind: 'dashboard', metrics: ['m2'] });
    expect(s.panels).toHaveLength(1);
    expect(s.panels[0].id).toBeUndefined();
    expect(s.panels[0].gridPos).toEqual({ x: 0, y: 0, w: 12, h: 4 });
  });

  it('brings the variables the panels use, and the ones those use', () => {
    expect(copyPanels(source, [1]).variables.map((v) => v.name)).toEqual(['host', 'region']);
    expect(copyPanels(source, [0]).variables).toEqual([]);
  });

  it('brings a row’s panels with it, down to the next row', () => {
    const s = copyPanels(source, [2]);
    expect(s.panels.map((p) => p.title)).toEqual(['R10', 'C3', 'C4']);
    expect(s.panels.map((p) => p.gridPos)).toEqual([
      { x: 0, y: 0, w: 24, h: 1 },
      { x: 6, y: 1, w: 6, h: 4 }, // a row spans the grid, so its panels keep their columns
      { x: 12, y: 1, w: 6, h: 4 },
    ]);
    expect(s.metrics).toEqual(['m3', 'm4']);
  });

  it('copies a collapsed row with the panels inside it', () => {
    const s = copyPanels(source, [5]);
    expect(s.panels).toHaveLength(1);
    expect(s.panels[0].panels?.[0]).toMatchObject({ title: 'C5', gridPos: { y: 1 } });
    expect(s.panels[0].panels?.[0].id).toBeUndefined();
    expect(s.metrics).toEqual(['m5']);
  });

  it('marks snippets with inputs as for forms', () => {
    expect(copyPanels({ title: 'F', panels: [input(1, 0, 'weight')] }, [0])).toMatchObject({ kind: 'form', metrics: ['weight'] });
  });

  it('leaves metrics taken from a variable out of the metrics', () => {
    const d: Dashboard = { title: 'D', panels: [chart(1, 0, 0, 24, { targets: [{ refId: 'A', metric: '$metric' }] })] };
    expect(copyPanels(d, [0]).metrics).toEqual([]);
  });
});

describe('parseSnippet', () => {
  it('reads a snippet back', () => {
    const s = copyPanels(source, [1]);
    expect(parseSnippet(JSON.stringify(s))).toEqual({ snippet: s });
  });

  it('reads a Grafana panel, a list of panels, or a whole dashboard', () => {
    const one = parseSnippet(JSON.stringify(chart(7, 6, 20, 12)));
    expect('snippet' in one && one.snippet.panels[0]).toMatchObject({ title: 'C7', gridPos: { x: 0, y: 0 } });
    const list = parseSnippet(JSON.stringify([chart(1, 0, 0, 12), chart(2, 12, 0, 12)]));
    expect('snippet' in list && list.snippet.panels).toHaveLength(2);
    const whole = parseSnippet(JSON.stringify(source));
    expect('snippet' in whole && whole.snippet.panels).toHaveLength(6);
    expect('snippet' in whole && whole.snippet.variables.map((v) => v.name)).toEqual(['host', 'region']);
  });

  it('says why text isn’t panels', () => {
    expect(parseSnippet('nope')).toEqual({ error: 'That isn’t JSON' });
    expect(parseSnippet('{"a":1}')).toEqual({ error: 'That isn’t a panel, a list of panels or a dashboard' });
    expect(parseSnippet('[1,2]')).toEqual({ error: 'There are no panels in it' });
    expect(parseSnippet('{"$modelform":"panels","version":99,"panels":[]}')).toEqual({ error: 'Those panels come from a newer version of modelform' });
  });
});

describe('pasteSnippet', () => {
  const target: Dashboard = { title: 'Target', panels: [chart(1, 0, 0, 12), chart(2, 12, 0, 12), chart(3, 0, 4, 24)] };

  it('pastes under a panel with fresh ids, moving what’s below down', () => {
    const s = copyPanels(source, [2]);
    const out = pasteSnippet(target, s, { after: 0 });
    expect(out).toMatchObject({ index: 3, count: 3, added: [], skipped: [] });
    const pasted = out.panels.slice(3);
    expect(pasted.map((p) => p.id)).toEqual([4, 5, 6]);
    expect(pasted.map((p) => p.gridPos)).toEqual([
      { x: 0, y: 4, w: 24, h: 1 },
      { x: 6, y: 5, w: 6, h: 4 },
      { x: 12, y: 5, w: 6, h: 4 },
    ]);
    expect(out.panels[2].gridPos.y).toBe(9); // the chart that was under panel 1 moves below the block
  });

  it('pastes at the bottom without a place, and gives a collapsed row’s panels ids too', () => {
    const out = pasteSnippet(target, copyPanels(source, [5]));
    expect(out.panels[3]).toMatchObject({ id: 4, gridPos: { y: 8 } });
    expect(out.panels[3].panels?.[0]).toMatchObject({ id: 5, gridPos: { y: 9 } });
  });

  it('adds the variables it needs, shares identical ones and renames clashing ones', () => {
    const s = copyPanels(source, [1]);
    const fresh = pasteSnippet(target, s);
    expect(fresh.added).toEqual(['host', 'region']);
    expect(fresh.variables.map((v) => v.name)).toEqual(['host', 'region']);

    const same = pasteSnippet({ ...target, templating: { list: [custom('host')] } }, s);
    expect(same.added).toEqual(['region']);

    const clash = pasteSnippet({ ...target, templating: { list: [custom('host', 'x,y')] } }, s);
    expect(clash.renamed).toEqual({ host: 'host_2' });
    expect(clash.added).toEqual(['host_2', 'region']);
    // The pasted region variable now builds on host_2, and so does the panel through it.
    expect(clash.variables.find((v) => v.name === 'region')?.query).toBe('$host_2-east,$host_2-west');
    expect(previewPaste({ ...target, templating: { list: [custom('host', 'x,y')] } }, s)).toEqual({ added: ['host_2', 'region'], renamed: { host: 'host_2' } });
  });

  it('renames panels’ uses of a renamed variable', () => {
    const s: PanelSnippet = { ...copyPanels(source, [1]), panels: [chart(9, 0, 0, 24, { title: 'On $host' })] };
    const out = pasteSnippet({ ...target, templating: { list: [custom('host', 'x,y')] } }, s);
    expect(out.panels.at(-1)?.title).toBe('On $host_2');
  });

  it('maps metrics in queries and inputs', () => {
    const out = pasteSnippet(target, copyPanels(source, [0]), { metrics: { m1: 'weight' } });
    expect(out.panels.at(-1)?.targets?.[0].metric).toBe('weight');
    const form: Dashboard = { title: 'F', panels: [input(1, 0, 'a')] };
    const s = copyPanels({ title: 'G', panels: [input(1, 0, 'old')] }, [0]);
    expect(pasteSnippet(form, s, { metrics: { old: 'new' } }).panels.at(-1)?.options?.metric).toBe('new');
  });

  it('leaves inputs out of dashboards, saying which', () => {
    const s = copyPanels({ title: 'F', panels: [input(1, 0, 'weight'), chart(2, 0, 3, 24)] }, [0, 1]);
    const out = pasteSnippet(target, s, { kind: 'dashboard' });
    expect(out).toMatchObject({ count: 1, skipped: ['I1'] });
  });
});
