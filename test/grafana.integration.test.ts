/**
 * Runs against a real Grafana when GRAFANA_URL and GRAFANA_TOKEN are set (skipped otherwise):
 *
 *   GRAFANA_URL=https://g-xxx.grafana-workspace.us-east-1.amazonaws.com GRAFANA_TOKEN=glsa_… pnpm test
 *
 * Queries every panel of every dashboard the token can see, the same way the app does.
 */
import { describe, expect, it } from 'vitest';
import { GrafanaClient, GrafanaDataSource, initialVariableValues, isRow, parseRange, queryPanel, toSeries, type Panel } from '../src/core';

const url = process.env.GRAFANA_URL;
const token = process.env.GRAFANA_TOKEN;

describe.skipIf(!url || !token)('grafana integration', () => {
  // Built lazily: describe bodies run during collection even when the suite is skipped.
  const client = () => new GrafanaClient({ url: url!, token: token! });

  it('authenticates', async () => {
    expect((await client().user()).login).toBeTruthy();
  });

  it('queries every panel of every dashboard', async () => {
    const c = client();
    const ds = new GrafanaDataSource(c);
    const hits = await c.search('', { limit: 20 });
    expect(hits.length).toBeGreaterThan(0);
    const failures: string[] = [];
    let queried = 0;

    for (const hit of hits) {
      const dashboard = await c.dashboard(hit.uid);
      const range = parseRange(dashboard.time ?? { from: 'now-6h', to: 'now' });
      const panels = dashboard.panels.flatMap((p): Panel[] => (isRow(p) ? (p.panels ?? []) : [p]));
      for (const panel of panels) {
        if (!panel.targets?.length) continue;
        try {
          const frames = await queryPanel(panel, { resolve: () => ds, range, variables: initialVariableValues(dashboard), widthPx: 400 });
          queried++;
          console.log(`${dashboard.title} / ${panel.title}: ${frames.length} frames, ${toSeries(frames).length} series`);
        } catch (e: any) {
          failures.push(`${dashboard.title} / ${panel.title}: ${e.message}`);
        }
      }
    }
    expect(failures).toEqual([]);
    expect(queried).toBeGreaterThan(0);
  }, 60_000);
});
