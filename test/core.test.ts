import { describe, expect, it, vi } from 'vitest';
import {
  buildFrames,
  formatClock,
  formatValue,
  GrafanaClient,
  interpolate,
  layoutDashboard,
  MemoryEntryStore,
  LocalDataSource,
  parseClockDigits,
  parseRange,
  parseTime,
  parseLocalDateTime,
  formatLocalDateTime,
  timeExprError,
  describeRange,
  zoomRange,
  queryPanel,
  reduce,
  resolveFieldConfig,
  thresholdStep,
  toSeries,
  type Dashboard,
  type Panel,
} from '../src/core';

const panel = (type: string, x: number, y: number, w: number, h = 4, extra: Partial<Panel> = {}): Panel => ({
  type,
  title: `${type}@${x},${y}`,
  gridPos: { x, y, w, h },
  ...extra,
});

describe('layout', () => {
  it('pairs small panels and stretches full-width ones on phones', () => {
    const d: Dashboard = {
      title: 't',
      panels: [panel('stat', 0, 0, 6), panel('stat', 6, 0, 6), panel('stat', 12, 0, 6), panel('timeseries', 0, 4, 24, 8)],
    };
    const [section] = layoutDashboard(d, 'phone');
    expect(section.rows.map((r) => r.cells.map((c) => c.span))).toEqual([[12, 12], [24], [24]]);
    expect(section.rows[2].h).toBe(8);
  });

  it('keeps original widths in grid mode', () => {
    const d: Dashboard = { title: 't', panels: [panel('a', 0, 0, 8), panel('b', 8, 0, 16), panel('c', 0, 4, 12)] };
    const [section] = layoutDashboard(d, 'grid');
    expect(section.rows.map((r) => r.cells.map((c) => c.span))).toEqual([[8, 16], [12]]);
  });

  it('groups expanded and collapsed rows', () => {
    const d: Dashboard = {
      title: 't',
      panels: [
        panel('stat', 0, 0, 24),
        panel('row', 0, 4, 24, 1, { id: 1, title: 'Open' }),
        panel('stat', 0, 5, 24),
        panel('row', 0, 9, 24, 1, { id: 2, title: 'Closed', collapsed: true, panels: [panel('gauge', 0, 10, 24)] }),
      ],
    };
    const sections = layoutDashboard(d);
    expect(sections.map((s) => [s.row?.title, s.collapsed, s.rows.length])).toEqual([
      [undefined, false, 1],
      ['Open', false, 1],
      ['Closed', true, 1],
    ]);
  });

  it('honours mobile overrides', () => {
    const d: Dashboard = {
      title: 't',
      panels: [panel('a', 0, 0, 24, 8, { mobile: { span: 8, h: 3 } }), panel('b', 0, 8, 24, 8, { mobile: { hidden: true } })],
    };
    const [section] = layoutDashboard(d);
    expect(section.rows).toHaveLength(1);
    expect(section.rows[0]).toMatchObject({ h: 3, cells: [{ span: 24 }] });
  });
});

describe('time', () => {
  const now = new Date(2026, 9, 14, 15, 30).getTime();
  it('parses relative expressions', () => {
    expect(parseTime('now-6h', now)).toBe(now - 6 * 3600_000);
    expect(parseTime('now/d', now)).toBe(new Date(2026, 9, 14).getTime());
    expect(parseTime('now/d', now, true)).toBe(new Date(2026, 9, 15).getTime() - 1);
    expect(parseTime('now-1M/M', now)).toBe(new Date(2026, 8, 1).getTime());
  });
  it('rounds the end of a range up', () => {
    const r = parseRange({ from: 'now/d', to: 'now/d' }, now);
    expect(r.to - r.from).toBe(86_400_000 - 1);
  });
  it('reads zone-less dates as local time and rejects overflow', () => {
    expect(parseTime('2026-03-01')).toBe(new Date(2026, 2, 1).getTime());
    expect(parseTime('2026-03-01 14:05')).toBe(new Date(2026, 2, 1, 14, 5).getTime());
    expect(parseLocalDateTime('2026-02-30')).toBeNull();
    expect(parseTime('2026-03-01T00:00:00Z')).toBe(Date.UTC(2026, 2, 1));
  });
  it('round-trips the picker format', () => {
    const t = new Date(2026, 2, 1, 9, 4, 7).getTime();
    expect(formatLocalDateTime(t)).toBe('2026-03-01 09:04:07');
    expect(parseTime(formatLocalDateTime(t))).toBe(t);
  });
  it('validates picker input', () => {
    expect(timeExprError('now-7d')).toBeNull();
    expect(timeExprError('2026-03-01')).toBeNull();
    expect(timeExprError('')).toBe('Required');
    expect(timeExprError('last tuesday')).toMatch(/Use a date/);
  });
  it('zooms a range around the pinch point', () => {
    const r = { from: 0, to: 100 * 60_000 };
    // Spreading 2x around the middle halves the span, centered.
    expect(zoomRange(r, 2, 0.5, 0.5)).toEqual({ from: 25 * 60_000, to: 75 * 60_000 });
    // Around the left edge, the start stays put.
    expect(zoomRange(r, 2, 0, 0)).toEqual({ from: 0, to: 50 * 60_000 });
    // Moving the fingers without spreading them pans: the time under them follows.
    expect(zoomRange(r, 1, 0.5, 0.25)).toEqual({ from: 25 * 60_000, to: 125 * 60_000 });
    // Clamps the span and the end.
    expect(zoomRange(r, 1000, 0.5, 0.5).to - zoomRange(r, 1000, 0.5, 0.5).from).toBe(60_000);
    expect(zoomRange(r, 0.5, 0.5, 0.5, { maxTo: r.to })).toEqual({ from: -100 * 60_000, to: r.to });
    // A numeric axis can be kept inside the data's extent.
    const ext = { minSpan: 0.01, maxSpan: 10, minFrom: 0, maxTo: 10 };
    expect(zoomRange({ from: 0, to: 10 }, 0.5, 0.5, 0.5, ext)).toEqual({ from: 0, to: 10 });
    expect(zoomRange({ from: 0, to: 10 }, 4, 0.1, 0.1, ext)).toEqual({ from: 0.75, to: 3.25 });
    expect(zoomRange({ from: 0, to: 2.5 }, 1, 0.5, 0.9, ext)).toEqual({ from: 0, to: 2.5 });
  });
  it('describes ranges', () => {
    expect(describeRange({ from: 'now-7d', to: 'now' }, now)).toBe('7d');
    expect(describeRange({ from: 'now/y', to: 'now/y' }, now)).toBe('This year');
    expect(describeRange({ from: '2026-03-01 00:00:00', to: '2026-03-05 23:59:59' }, now)).toBe('Mar 1 – Mar 5');
    expect(describeRange({ from: '2025-12-30 00:00:00', to: '2026-01-02 23:59:59' }, now)).toBe('Dec 30, 2025 – Jan 2, 2026');
    expect(describeRange({ from: '2026-03-01 08:00:00', to: '2026-03-01 17:30:00' }, now)).toBe('Mar 1 08:00–17:30');
  });
});

describe('variables', () => {
  it('interpolates all syntaxes and multi-values', () => {
    const ctx = { values: { job: 'api', env: ['a', 'b'] }, intervalMs: 60_000 };
    expect(interpolate('up{job="$job"}', ctx)).toBe('up{job="api"}');
    expect(interpolate('${job}-[[job]]', ctx)).toBe('api-api');
    expect(interpolate('env=~"$env"', ctx)).toBe('env=~"(a|b)"');
    expect(interpolate('${env:csv}', ctx)).toBe('a,b');
    expect(interpolate('rate(x[$__rate_interval])', ctx)).toBe('rate(x[4m])');
    expect(interpolate('$unknown', ctx)).toBe('$unknown');
  });
});

describe('format & thresholds', () => {
  it('formats common units', () => {
    expect(formatValue(1284)).toBe('1,284');
    expect(formatValue(12_900)).toBe('12.9K');
    expect(formatValue(0.42, { unit: 'percentunit' })).toBe('42.0%');
    expect(formatValue(1536, { unit: 'bytes' })).toBe('1.5 kB');
    expect(formatValue(72.25, { unit: 'suffix: bpm', decimals: 0 })).toBe('72 bpm');
    expect(formatValue(null)).toBe('—');
  });
  it('picks the highest matching step', () => {
    const cfg = { thresholds: { steps: [{ value: null, color: 'green' }, { value: 80, color: 'red' }] } };
    expect(thresholdStep(50, cfg)?.color).toBe('green');
    expect(thresholdStep(80, cfg)?.color).toBe('red');
  });
  it('applies overrides by name', () => {
    const p = panel('timeseries', 0, 0, 24, 8, {
      fieldConfig: {
        defaults: { unit: 'short' },
        overrides: [{ matcher: { id: 'byName', options: 'errors' }, properties: [{ id: 'custom.lineWidth', value: 3 }] }],
      },
    });
    const field = { name: 'errors', type: 'number' as const, values: [] };
    expect(resolveFieldConfig(p, field, { fields: [field] }, 'errors')).toMatchObject({ unit: 'short', custom: { lineWidth: 3 } });
  });
});

describe('reduce', () => {
  it('handles nulls', () => {
    expect(reduce([1, null, 3, null], 'lastNotNull')).toBe(3);
    expect(reduce([1, null, 3], 'mean')).toBe(2);
    expect(reduce([5, 7, 2, 4], 'delta')).toBe(6);
  });
});

describe('local datasource', () => {
  const day = (d: number, h = 12) => new Date(2026, 9, d, h).getTime();
  const range = { from: new Date(2026, 9, 10).getTime(), to: new Date(2026, 9, 13, 23, 59).getTime(), raw: { from: '', to: '' } };

  it('sums into calendar days with zero fill', () => {
    const entries = [
      { id: '1', metric: 'water', ts: day(10, 8), value: 1, text: null },
      { id: '2', metric: 'water', ts: day(10, 20), value: 2, text: null },
      { id: '3', metric: 'water', ts: day(12), value: 1, text: null },
    ];
    const [frame] = buildFrames({ refId: 'A', metric: 'water', aggregate: 'sum', bucket: '1d' }, entries, { range, intervalMs: 0 });
    expect(frame.fields[0].values).toEqual([day(10, 0), day(11, 0), day(12, 0), day(13, 0)]);
    expect(frame.fields[1].values).toEqual([3, 0, 1, 0]);
  });

  it('splits by text value', () => {
    const entries = ['good', 'bad', 'good'].map((text, i) => ({ id: String(i), metric: 'mood', ts: day(11), value: null, text }));
    const frames = buildFrames({ refId: 'A', metric: 'mood', groupBy: 'text', bucket: '1d', fillZero: false }, entries, { range, intervalMs: 0 });
    expect(frames.map((f) => [f.fields[1].name, f.fields[1].values])).toEqual([
      ['good', [2]],
      ['bad', [1]],
    ]);
  });

  it('names text groups with the label option, keeping the text as the label value', async () => {
    const store = new MemoryEntryStore(['t1', 't2', 't1'].map((text) => ({ metric: 'tire-session', ts: day(11), value: 1, text })));
    const local = new LocalDataSource(store, { label: (metric, text) => (metric === 'tire-session' && text === 't1' ? 'Hoosier R7' : undefined) });
    const frames = await local.query({ targets: [{ refId: 'A', metric: 'tire-session', groupBy: 'text', aggregate: 'sum', bucket: '1d', fillZero: false }], range, intervalMs: 0 } as any);
    expect(frames.map((f) => [f.fields[1].config?.displayName, f.fields[1].labels, f.fields[1].values])).toEqual([
      ['Hoosier R7', { 'tire-session': 't1' }, [2]],
      ['t2', { 'tire-session': 't2' }, [1]],
    ]);
  });

  it('fill: previous carries the value in effect at the range start through to the range end', async () => {
    const store = new MemoryEntryStore([
      { metric: 'sway', ts: day(1), value: 2, text: null },
      { metric: 'sway', ts: day(5), value: 3, text: null },
      { metric: 'sway', ts: day(11), value: 4, text: null },
    ]);
    const [frame] = await new LocalDataSource(store).query({ targets: [{ refId: 'A', metric: 'sway', fill: 'previous' }], range, intervalMs: 0 } as any);
    expect(frame.fields[0].values).toEqual([range.from, day(11), Math.min(range.to, Date.now())]);
    expect(frame.fields[1].values).toEqual([3, 4, 4]);
  });

  it('runs end to end through queryPanel', async () => {
    const store = new MemoryEntryStore([{ metric: 'weight', ts: day(11), value: 80, text: null }]);
    const local = new LocalDataSource(store);
    const p = panel('timeseries', 0, 0, 24, 8, { datasource: { type: 'dashkit-local' }, targets: [{ refId: 'A', metric: 'weight' }] });
    const frames = await queryPanel(p, { resolve: () => local, range, variables: {}, widthPx: 400 });
    expect(toSeries(frames)[0]).toMatchObject({ name: 'weight', values: [80] });
  });
});

describe('grafana client', () => {
  it('resolves placeholder datasources and parses frames', async () => {
    const calls: { url: string; body?: any }[] = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const json = url.endsWith('/api/frontend/settings')
        ? { defaultDatasource: 'Prom', datasources: { Prom: { uid: 'p1', type: 'prometheus', name: 'Prom', isDefault: true } } }
        : {
            results: {
              A: {
                frames: [
                  {
                    schema: { refId: 'A', fields: [{ name: 'Time', type: 'time' }, { name: 'Value', type: 'number', labels: { job: 'api' } }] },
                    data: { values: [[1, 2], [10, 20]] },
                  },
                ],
              },
            },
          };
      return new Response(JSON.stringify(json), { status: 200 });
    });
    const client = new GrafanaClient({ url: 'https://g.example.com/', token: 't', fetch: fetch as any });
    const frames = await client.query({
      targets: [{ refId: 'A', expr: 'up', datasource: { type: 'prometheus', uid: '${DS_PROMETHEUS}' } }],
      range: { from: 0, to: 1000, raw: { from: '', to: '' } },
      intervalMs: 1000,
      maxDataPoints: 100,
    });
    expect(calls[1].url).toBe('https://g.example.com/api/ds/query');
    expect(calls[1].body.queries[0]).toMatchObject({ expr: 'up', datasource: { uid: 'p1', type: 'prometheus' } });
    expect(toSeries(frames)[0]).toMatchObject({ name: 'api', values: [10, 20] });
  });
});

describe('niceTicks', () => {
  it('always covers the max', async () => {
    const { niceTicks } = await import('../src/ui/chart');
    expect(niceTicks(0, 8.5).at(-1)).toBeGreaterThanOrEqual(8.5);
    expect(niceTicks(80.6, 81.2).at(-1)).toBeGreaterThanOrEqual(81.2);
  });
});

describe('grafana client default fetch', () => {
  it('calls the global fetch unbound (browsers reject fetch with a foreign this)', async () => {
    const original = globalThis.fetch;
    let receivedThis: unknown = 'unset';
    globalThis.fetch = function (this: unknown) {
      receivedThis = this;
      return Promise.resolve(new Response('{"login":"x","orgId":1}'));
    } as typeof fetch;
    try {
      await new GrafanaClient({ url: 'https://g.example.com', token: 't' }).user();
      expect(receivedThis).toBeUndefined();
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('series naming', () => {
  const frame = (name: string, labels: Record<string, string>, config = {}) => ({
    name,
    fields: [
      { name: 'Time', type: 'time' as const, values: [1] },
      { name: 'Value', type: 'number' as const, values: [1], labels, config },
    ],
  });
  it('qualifies colliding label names with the frame name', () => {
    const names = toSeries([frame('A-series', { env: 'prod' }), frame('A-series1', { env: 'prod' })]).map((s) => s.name);
    expect(names).toEqual(['A-series prod', 'A-series1 prod']);
  });
  it('prefers displayNameFromDS (Prometheus legendFormat)', () => {
    expect(toSeries([frame('', { code: '200' }, { displayNameFromDS: '200 OK' })])[0].name).toBe('200 OK');
  });
});

describe('lap time clock', () => {
  it('fills digits from the right as MM:SS.hh', () => {
    expect(parseClockDigits('13245')).toBe(92.45);
    expect(parseClockDigits('5')).toBe(0.05);
    expect(parseClockDigits('100000')).toBe(600);
    expect(parseClockDigits('01:32.45')).toBe(92.45);
    expect(parseClockDigits('')).toBeNull();
  });

  it('rejects seconds past 59', () => {
    expect(parseClockDigits('16000')).toBeNull();
  });

  it('formats seconds back to MM:SS.hh', () => {
    expect(formatClock(92.45)).toBe('01:32.45');
    expect(formatClock(59.999)).toBe('01:00.00');
    expect(formatClock(6000)).toBe('100:00.00');
    for (const d of ['13245', '5959', '995999']) expect(formatClock(parseClockDigits(d)!).replace(/\D/g, '')).toBe(d.padStart(6, '0'));
  });
});

describe('more reducers', () => {
  it('computes median, stdDev, distinct and change counts', () => {
    const v = [1, 3, 3, 7, null];
    expect(reduce(v, 'median')).toBe(3);
    expect(reduce([2, 4, 4, 4, 5, 5, 7, 9], 'stdDev')).toBe(2);
    expect(reduce(v, 'distinctCount')).toBe(3);
    expect(reduce(v, 'changeCount')).toBe(2);
  });
});
