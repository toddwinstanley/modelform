import { describe, expect, it, vi } from 'vitest';
import {
  framesToOptions,
  GrafanaClient,
  GrafanaDataSource,
  interpolate,
  queryPanel,
  refineOptions,
  resolveVariables,
  selectValue,
  variableDependents,
  variableInfo,
  variableOrder,
  type Dashboard,
  type DataSource,
  type TemplateVariable,
  type VarOption,
} from '../src/core';

const PG = 'grafana-postgresql-datasource';
const range = { from: 0, to: 1000, raw: { from: '', to: '' } };
const opts = (...values: string[]): VarOption[] => values.map((v) => ({ text: v.toUpperCase(), value: v }));
const qvar = (name: string, query: string, extra: Partial<TemplateVariable> = {}): TemplateVariable => ({
  name,
  type: 'query',
  query,
  refresh: 1,
  datasource: { type: PG, uid: 'pg' },
  ...extra,
});
const dash = (...list: TemplateVariable[]): Dashboard => ({ title: 't', panels: [], templating: { list } });

describe('interpolating All and multi-values', () => {
  const info = {
    car: { multi: true, includeAll: true, options: opts('a', "o'b") },
    one: { options: opts('x') },
    empty: { includeAll: true, options: [] },
    custom: { includeAll: true, allValue: '%', options: opts('a') },
  };
  const values = { car: ['$__all'], one: 'x', empty: '$__all', custom: '$__all', two: ['a', 'b'] };

  it('expands All to a quoted list for SQL', () => {
    const ctx = { values, info, datasourceType: PG };
    expect(interpolate('car in ($car)', ctx)).toBe("car in ('a','o''b')");
    expect(interpolate("'$one'", ctx)).toBe("'x'");
    expect(interpolate('in ($empty)', ctx)).toBe('in (NULL)');
    expect(interpolate("like '$custom'", ctx)).toBe("like '%'");
  });

  it('keeps regex alternation for other datasources', () => {
    const ctx = { values, info, datasourceType: 'prometheus' };
    expect(interpolate('car=~"$car"', ctx)).toBe('car=~"(a|o\'b)"');
    expect(interpolate('x=~"$empty"', ctx)).toBe('x=~".*"');
    expect(interpolate('x=~"$two"', { values })).toBe('x=~"(a|b)"');
  });

  it('fills $__timezone from the dashboard, or the device zone for "browser"', () => {
    const sql = "time AT TIME ZONE '$__timezone' and $__timeGroup(t, 1d)";
    expect(interpolate(sql, { values, timezone: 'Europe/London' })).toBe("time AT TIME ZONE 'Europe/London' and $__timeGroup(t, 1d)");
    expect(interpolate('$__timezone', { values, timezone: 'utc' })).toBe('utc');
    const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(interpolate('${__timezone}', { values, timezone: 'browser' })).toBe(device);
    expect(interpolate('$__timezone', { values })).toBe(device);
  });

  it('formats :text and :sqlstring', () => {
    const ctx = { values, info };
    expect(interpolate('${one:text}', ctx)).toBe('X');
    expect(interpolate('${car:text}', ctx)).toBe('All');
    expect(interpolate('${two:sqlstring}', ctx)).toBe("'a','b'");
  });
});

describe('variable options', () => {
  it('reads __text/__value columns, else the first column', () => {
    const field = (name: string, values: unknown[]) => ({ name, type: 'string' as const, values });
    expect(framesToOptions([{ fields: [field('__value', ['1', null]), field('__text', ['one', 'two'])] }])).toEqual([{ text: 'one', value: '1' }]);
    expect(framesToOptions([{ fields: [field('car', ['a', 'b']), field('other', [1, 2])] }])).toEqual([
      { text: 'a', value: 'a' },
      { text: 'b', value: 'b' },
    ]);
  });

  it('applies regex and sort and drops duplicates', () => {
    const v = (extra: Partial<TemplateVariable>) => ({ name: 'v', type: 'query', ...extra });
    const raw = [10, 9, 10, 100].map((n) => ({ text: `T${n}`, value: `T${n}` }));
    expect(refineOptions(v({}), raw).map((o) => o.value)).toEqual(['T10', 'T9', 'T100']);
    expect(refineOptions(v({ sort: 3 }), raw).map((o) => o.value)).toEqual(['T9', 'T10', 'T100']);
    expect(refineOptions(v({ sort: 2 }), raw).map((o) => o.value)).toEqual(['T9', 'T100', 'T10']);
    expect(refineOptions(v({ regex: '/T(1\\d*)/' }), raw).map((o) => o.value)).toEqual(['10', '100']);
    // T100 maps to value 1 as well, so it's dropped as a duplicate.
    expect(refineOptions(v({ regex: '/T(?<value>\\d)(?<text>\\d+)/' }), raw)).toEqual([{ text: '0', value: '1' }]);
  });

  it('selects like Grafana', () => {
    const single: TemplateVariable = { name: 's', type: 'query' };
    const multiAll: TemplateVariable = { name: 'm', type: 'query', multi: true, includeAll: true };
    expect(selectValue(single, '', opts('a', 'b'))).toBe('a');
    expect(selectValue(single, 'b', opts('a', 'b'))).toBe('b');
    expect(selectValue(single, 'z', [])).toBe('');
    expect(selectValue(multiAll, ['$__all'], opts('a'))).toEqual(['$__all']);
    expect(selectValue(multiAll, ['a', 'z'], opts('a', 'b'))).toEqual(['a']);
    expect(selectValue(multiAll, ['z'], opts('a'))).toEqual(['$__all']);
  });
});

describe('resolving query variables', () => {
  // Shaped like the Downshifts dashboard: a session saved as "", turns that depend on it,
  // and a hidden repeat variable that depends on everything.
  const downshifts = dash(
    qvar('rep', 'select ts from downshifts($session, $from, $to)', { multi: true, includeAll: true, refresh: 2, current: { value: ['$__all'] } }),
    qvar('session', 'select id as __value, name as __text from sessions', { current: { value: '' } }),
    qvar('from', "select turn from turns where session = '$session'", { current: { value: 'all' } }),
    qvar('to', "select turn from turns where session = '$session' and turn >= '$from'"),
  );

  const fakeDs = () => {
    const queries: string[] = [];
    const ds: DataSource = {
      query: async () => [],
      variableOptions: async ({ query }) => {
        queries.push(String(query));
        if (String(query).includes('from sessions')) return [{ text: 'Latest', value: 's1' }, { text: 'Older', value: 's0' }];
        if (String(query).includes('downshifts')) return opts('t1', 't2');
        return opts('all', '1', '2');
      },
    };
    return { ds, queries };
  };

  it('orders by reference and finds dependents', () => {
    expect(variableOrder(downshifts).order.map((v) => v.name)).toEqual(['session', 'from', 'to', 'rep']);
    expect([...variableDependents(downshifts, ['from'])].sort()).toEqual(['rep', 'to']);
    const cyc = dash(qvar('a', '$b'), qvar('b', '$a'), qvar('c', 'x'));
    expect(variableOrder(cyc).cyclic.map((v) => v.name)).toEqual(['a', 'b']);
  });

  it('replaces an empty saved session with the first option and feeds it to dependents', async () => {
    const { ds, queries } = fakeDs();
    const res = await resolveVariables(downshifts, {
      values: { session: '', from: 'all', rep: ['$__all'] },
      names: ['session', 'from', 'to', 'rep'],
      resolve: () => ds,
      range,
    });
    expect(res.values).toMatchObject({ session: 's1', from: 'all', to: 'all', rep: ['$__all'] });
    expect(queries[1]).toBe("select turn from turns where session = 's1'");
    expect(queries[3]).toBe('select ts from downshifts(s1, all, all)');
    expect(res.errors).toEqual({});
  });

  it('records failures and keeps going', async () => {
    const ds: DataSource = {
      query: async () => [],
      variableOptions: async ({ query }) => {
        if (String(query).includes('sessions')) throw new Error('boom');
        return opts('x');
      },
    };
    const res = await resolveVariables(downshifts, { values: { session: '' }, names: ['session', 'from'], resolve: () => ds, range });
    expect(res.errors).toEqual({ session: 'boom' });
    expect(res.values.from).toBe('x');
  });

  it('expands All in panel queries from resolved options', async () => {
    const d = dash(qvar('car', 'select car from laps', { multi: true, includeAll: true }));
    const seen: any[] = [];
    const ds: DataSource = { query: async (req) => (seen.push(...req.targets), []) };
    const panel = { type: 'table', targets: [{ refId: 'A', rawSql: 'where car in ($car)', datasource: { type: PG, uid: 'pg' } }] };
    await queryPanel(panel, {
      resolve: () => ds,
      range,
      variables: { car: ['$__all'] },
      variableInfo: variableInfo(d, { car: opts('a', 'b') }),
      widthPx: 400,
    });
    expect(seen[0].rawSql).toBe("where car in ('a','b')");
  });
});

describe('grafana variable queries', () => {
  const client = (results: unknown) => {
    const bodies: any[] = [];
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ results }), { status: 200 });
    });
    return { ds: new GrafanaDataSource(new GrafanaClient({ url: 'https://g', token: 't', fetch: fetch as any })), bodies };
  };

  it('runs SQL variable queries through /api/ds/query', async () => {
    const { ds, bodies } = client({
      variable: { frames: [{ schema: { fields: [{ name: 'car', type: 'string' }] }, data: { values: [['a', 'b']] } }] },
    });
    const options = await ds.variableOptions({ query: 'select car from laps', datasource: { type: PG, uid: 'pg' }, range });
    expect(options).toEqual([
      { text: 'a', value: 'a' },
      { text: 'b', value: 'b' },
    ]);
    expect(bodies[0].queries[0]).toMatchObject({ rawSql: 'select car from laps', format: 'table', datasource: { uid: 'pg', type: PG } });
  });

  it('matches renamed plugin ids and rejects types the instance lacks', async () => {
    const settings = { defaultDatasource: 'PG', datasources: { PG: { uid: 'pg', type: PG, name: 'PG', isDefault: true } } };
    const fetch = vi.fn(async () => new Response(JSON.stringify(settings), { status: 200 }));
    const c = new GrafanaClient({ url: 'https://g', token: 't', fetch: fetch as any });
    expect(await c.resolveRef({ type: 'postgres', uid: '${DS_PG}' })).toEqual({ uid: 'pg', type: PG });
    await expect(c.resolveRef({ type: 'prometheus', uid: '${DS_PROM}' })).rejects.toThrow('No prometheus datasource in this Grafana');
    expect(await c.resolveRef(undefined)).toEqual({ uid: 'pg', type: PG });
  });

  it('declines datasources whose variable queries run in the browser', async () => {
    const { ds, bodies } = client({});
    expect(await ds.variableOptions({ query: 'label_values(job)', datasource: { type: 'prometheus', uid: 'p' }, range })).toBeNull();
    expect(bodies).toEqual([]);
  });
});
