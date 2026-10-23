import { describe, expect, it } from 'vitest';
import { applyDashboardLink, parseDashboardLink, parseRange, resolveLinks, type DataFrame, type Dashboard } from '../src/core';

const frame: DataFrame = {
  name: 'laps',
  fields: [
    { name: 'Time', type: 'time', values: [1000, 2000] },
    { name: 'Lap time', type: 'number', values: [92.4, 91.8], labels: { car: 'miata' } },
    { name: 'Session', type: 'string', values: ['AM 1', 'PM 2'] },
  ],
};
const dashboard: Dashboard = {
  uid: 'laps',
  title: 'Laps',
  panels: [],
  templating: {
    list: [
      { name: 'car', type: 'custom', multi: true },
      { name: 'track', type: 'custom' },
    ],
  },
};
const range = parseRange({ from: 'now-7d', to: 'now' }, Date.UTC(2026, 9, 22));
const ctx = { dashboard, values: { car: ['miata', 'gr86'], track: 'Laguna Seca' }, range };

describe('resolveLinks', () => {
  it('fills value, field, series and row macros, URL-encoded', () => {
    const [l] = resolveLinks([{ title: 'Lap ${__value.raw}', url: '/d/x?session=${__data.fields.Session}&t=${__value.time}&f=${__field.name}&car=${__field.labels.car}&s=${__series.name}' }], {
      ...ctx,
      data: { frame, row: 1, field: frame.fields[1], value: 91.8, time: 2000 },
    });
    expect(l).toEqual({ title: 'Lap 91.8', href: '/d/x?session=PM%202&t=2000&f=Lap%20time&car=miata&s=laps', targetBlank: false });
  });

  it('reads fields by quoted name or index, and keeps unknown macros', () => {
    const [l] = resolveLinks([{ title: 't', url: '?a=${__data.fields["Lap time"]}&b=${__data.fields[2]}&c=${__value.nope}' }], {
      ...ctx,
      data: { frame, row: 0 },
    });
    expect(l.href).toBe('?a=92.4&b=AM%201&c=${__value.nope}');
  });

  it('expands time range, all variables and queryparam', () => {
    const [l] = resolveLinks([{ title: 't', url: '/d/x?${__url_time_range}&${__all_variables}&${track:queryparam}' }], ctx);
    expect(l.href).toBe('/d/x?from=now-7d&to=now&var-car=miata&var-car=gr86&var-track=Laguna%20Seca&var-track=Laguna%20Seca');
  });

  it('encodes dashboard variables unless :raw, and formats __from', () => {
    const [l] = resolveLinks([{ title: '${track}', url: 'https://x.test/?t=${track}&r=${track:raw}&iso=${__from:date:iso}' }], ctx);
    expect(l.title).toBe('Laguna Seca');
    expect(l.href).toBe(`https://x.test/?t=Laguna%20Seca&r=Laguna Seca&iso=${encodeURIComponent(new Date(range.from).toISOString())}`);
  });

  it('drops links with an empty URL', () => {
    expect(resolveLinks([{ title: 'nothing', url: '' }], ctx)).toEqual([]);
  });
});

describe('dashboard links', () => {
  it('parses relative and same-host links with time and variables', () => {
    expect(parseDashboardLink('/d/abc/laps?from=now-30d&to=now&var-car=miata&var-car=gr86&orgId=1')).toEqual({
      uid: 'abc',
      from: 'now-30d',
      to: 'now',
      vars: { car: ['miata', 'gr86'] },
    });
    expect(parseDashboardLink('https://g.example.com/d/abc?var-track=Laguna+Seca', 'https://g.example.com')?.vars).toEqual({ track: ['Laguna Seca'] });
    expect(parseDashboardLink('https://g.example.com/grafana/d/abc/x', 'https://g.example.com/grafana/')?.uid).toBe('abc');
  });

  it('rejects other hosts and non-dashboard paths', () => {
    expect(parseDashboardLink('https://other.example.com/d/abc', 'https://g.example.com')).toBeNull();
    expect(parseDashboardLink('https://g.example.com/d/abc')).toBeNull();
    expect(parseDashboardLink('/explore?left=1')).toBeNull();
  });

  it('applies a link to a dashboard', () => {
    const d = applyDashboardLink(dashboard, { from: '1700000000000', vars: { car: ['gr86'], track: ['Sonoma'] } });
    expect(d.time).toEqual({ from: '1700000000000', to: 'now' });
    expect(d.templating!.list[0].current).toEqual({ text: ['gr86'], value: ['gr86'] });
    expect(d.templating!.list[1].current).toEqual({ text: 'Sonoma', value: 'Sonoma' });
    expect(dashboard.templating!.list[1].current).toBeUndefined();
  });
});
