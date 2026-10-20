import { describe, expect, it } from 'vitest';
import { interpolate, layoutDashboard, queryPanel, variableInfo, type Dashboard, type DataSource, type Panel } from '../src/core';

const PG = 'grafana-postgresql-datasource';
const range = { from: 0, to: 1000, raw: { from: '', to: '' } };
const panel = (id: number, y: number, extra: Partial<Panel> = {}): Panel => ({ id, type: 'table', title: `p${id}`, gridPos: { x: 0, y, w: 24, h: 4 }, ...extra });

// Shaped like Downshifts: a table, then a row repeated per downshift holding three traces.
const dashboard: Dashboard = {
  title: 'd',
  panels: [
    panel(2, 0),
    { id: 200, type: 'row', title: '${ds_rep:text}', repeat: 'ds_rep', gridPos: { x: 0, y: 4, w: 24, h: 1 }, panels: [] },
    panel(3, 5, { gridPos: { x: 0, y: 5, w: 8, h: 6 } }),
    panel(4, 5, { gridPos: { x: 8, y: 5, w: 8, h: 6 } }),
    panel(5, 5, { gridPos: { x: 16, y: 5, w: 8, h: 6 } }),
  ],
  templating: {
    list: [{ name: 'ds_rep', type: 'query', multi: true, includeAll: true, current: { value: ['$__all'] } }],
  },
};
const options = [
  { text: 'Lap 1 | 4 to 3', value: '2026-10-19T14:31:00Z' },
  { text: "Lap 2 | O'Brien", value: '2026-10-19T14:33:00Z' },
];
const ctx = { values: { ds_rep: ['$__all'] }, info: variableInfo(dashboard, { ds_rep: options }) };

describe('repeating rows', () => {
  it('copies the row and its panels once per option, each scoped to its value', () => {
    const sections = layoutDashboard(dashboard, 'grid', ctx);
    expect(sections.map((s) => s.key)).toEqual(['section-0', 'row-200:2026-10-19T14:31:00Z', 'row-200:2026-10-19T14:33:00Z']);
    const [, first, second] = sections;
    expect(first.row?.scopedVars?.ds_rep).toEqual(options[0]);
    expect(second.rows[0].cells.map((c) => c.panel.scopedVars?.ds_rep.value)).toEqual(Array(3).fill(options[1].value));
    const keys = sections.flatMap((s) => s.rows.flatMap((r) => r.cells.map((c) => c.key)));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('follows the selection, and renders once without variables', () => {
    const one = layoutDashboard(dashboard, 'grid', { ...ctx, values: { ds_rep: [options[1].value] } });
    expect(one.map((s) => s.row?.scopedVars?.ds_rep.text)).toEqual([undefined, "Lap 2 | O'Brien"]);
    expect(layoutDashboard(dashboard, 'grid')).toHaveLength(2);
  });

  it('interpolates the scoped value raw for Postgres and quoted for MySQL', () => {
    const scoped = { ds_rep: options[1] };
    const base = { values: ctx.values, info: ctx.info, scoped };
    expect(interpolate("'$ds_rep'::timestamptz", { ...base, datasourceType: PG })).toBe("'2026-10-19T14:33:00Z'::timestamptz");
    expect(interpolate('${ds_rep:text}', base)).toBe("Lap 2 | O'Brien");
    expect(interpolate("'$ds_rep'", { ...base, scoped: { ds_rep: { text: '', value: "O'B" } }, datasourceType: PG })).toBe("'O''B'");
    expect(interpolate('t = $ds_rep', { ...base, datasourceType: 'mysql' })).toBe("t = '2026-10-19T14:33:00Z'");
  });

  it('queries each copy with its own value', async () => {
    const sql: string[] = [];
    const ds: DataSource = { query: async (req) => (sql.push(String(req.targets[0].rawSql)), []) };
    const d = { ...dashboard, panels: dashboard.panels.map((p) => (p.id === 3 ? { ...p, targets: [{ refId: 'A', rawSql: "x('$ds_rep')", datasource: { type: PG, uid: 'pg' } }] } : p)) };
    for (const s of layoutDashboard(d, 'grid', ctx).slice(1)) {
      await queryPanel(s.rows[0].cells[0].panel, { resolve: () => ds, range, variables: ctx.values, variableInfo: ctx.info, widthPx: 400 });
    }
    expect(sql).toEqual(["x('2026-10-19T14:31:00Z')", "x('2026-10-19T14:33:00Z')"]);
  });
});

describe('repeating panels', () => {
  const d = (extra: Partial<Panel>): Dashboard => ({
    title: 'd',
    panels: [panel(1, 0, { repeat: 'host', gridPos: { x: 0, y: 0, w: 6, h: 4 }, ...extra }), panel(2, 4)],
    templating: { list: [{ name: 'host', type: 'custom', multi: true, includeAll: true, query: 'a,b,c,d,e' }] },
  });
  const hosts = { values: { host: ['$__all'] }, info: variableInfo(d({})) };

  it('goes side by side up to maxPerRow, then wraps, ahead of the panels below', () => {
    const [section] = layoutDashboard(d({ maxPerRow: 3 }), 'grid', hosts);
    expect(section.rows.map((r) => r.cells.map((c) => c.panel.scopedVars?.host?.value ?? c.panel.id))).toEqual([['a', 'b', 'c'], ['d', 'e'], [2]]);
    expect(section.rows[0].cells.map((c) => c.span)).toEqual([8, 8, 8]);
  });

  it('stacks when vertical', () => {
    const [section] = layoutDashboard(d({ repeatDirection: 'v' }), 'grid', hosts);
    expect(section.rows.map((r) => r.cells.length)).toEqual([4, 1, 1]);
  });
});
