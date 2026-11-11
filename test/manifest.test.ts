import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BUNDLE_ACCEPT, BUNDLE_TYPE, ConfigLoader, fetchBundle, prepareDashboard, resolveUrl, validateManifest, type CachedConfig, type ConfigBundle } from '../src/core';

const form = { title: 'Daily', panels: [{ type: 'input-number', title: 'Weight', gridPos: { x: 0, y: 0, w: 24, h: 3 }, options: { metric: 'weight' } }] };
const charts = { title: 'Charts', panels: [{ type: 'timeseries', title: 'Weight', gridPos: { x: 0, y: 0, w: 24, h: 8 } }] };
const manifest = {
  version: 1,
  title: 'Test',
  tabs: [
    { id: 'log', title: 'Log', screen: { type: 'forms', forms: ['daily'] } },
    { id: 'charts', title: 'Charts', screen: { type: 'dashboard', dashboard: 'charts' } },
  ],
  documents: { daily: 'forms/daily.json', charts: '../shared/charts.json' },
};

/** Serves `files` by URL; anything else 404s. */
const server = (files: Record<string, unknown>) => async (url: string) => {
  if (!(url in files)) throw new Error(`${url}: HTTP 404`);
  return structuredClone(files[url]);
};

const BASE = 'http://host:3302/config/app.json';
const files = {
  [BASE]: manifest,
  'http://host:3302/config/forms/daily.json': form,
  'http://host:3302/shared/charts.json': charts,
};

describe('resolveUrl', () => {
  it('resolves relative, parent, root-relative and absolute paths', () => {
    expect(resolveUrl('http://h/a/app.json', 'forms/x.json')).toBe('http://h/a/forms/x.json');
    expect(resolveUrl('http://h/a/app.json', './x.json')).toBe('http://h/a/x.json');
    expect(resolveUrl('http://h/a/b/app.json', '../x.json')).toBe('http://h/a/x.json');
    expect(resolveUrl('http://h/a/app.json?v=2', '/x.json')).toBe('http://h/x.json');
    expect(resolveUrl('http://h/a/app.json', 'https://other/x.json')).toBe('https://other/x.json');
    expect(resolveUrl('http://h/app.json', '../../x.json')).toBe('http://h/x.json');
  });
});

describe('validateManifest', () => {
  it('accepts a good manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('reports each problem with a path', () => {
    const bad = {
      version: 2,
      title: '',
      documents: { a: 5 },
      tabs: [
        { id: 'x y', title: 'A', screen: { type: 'dashboard' } },
        { id: 'b', title: 'B', screen: { type: 'forms', forms: [], extra: true } },
        { id: 'c', title: 'C', screen: { type: 'nope' } },
      ],
    };
    expect(validateManifest(bad, 'app.json').map((i) => `${i.path} ${i.message}`)).toEqual([
      'app.json: documents.a must be object or string',
      'app.json: tabs[0].id must match ^[A-Za-z0-9_-]+$',
      'app.json: tabs[0].screen.dashboard is required',
      'app.json: tabs[1].screen.extra is not a known key',
      'app.json: tabs[1].screen.forms must not be empty',
      'app.json: tabs[2].screen.type must be "dashboard", "forms" or "menu"',
      'app.json: title must not be empty',
      'app.json: version must be 1',
    ]);
  });

  it('checks what the schema cannot, once the shape is right', () => {
    const m = {
      ...manifest,
      tabs: [...manifest.tabs, { id: 'log', title: 'Again', screen: { type: 'menu', items: [{ dashboard: 'charts', form: 'daily' }, {}] } }],
    };
    expect(validateManifest(m, 'app.json').map((i) => `${i.path} ${i.message}`)).toEqual([
      'app.json: tabs[2].id "log" is used by another tab',
      'app.json: tabs[2].screen.items[0] needs either "dashboard" or "form"',
      'app.json: tabs[2].screen.items[1] needs either "dashboard" or "form"',
    ]);
  });

  it('leaves inline documents to the dashboard checks', () => {
    expect(validateManifest({ ...manifest, documents: { daily: { title: 'X', panels: 'no' } } })).toEqual([]);
  });
});

describe('fetchBundle', () => {
  it('fetches documents relative to the manifest', async () => {
    const { bundle, issues } = await fetchBundle(BASE, server(files));
    expect(issues).toEqual([]);
    expect(bundle?.documents.daily.title).toBe('Daily');
    expect(bundle?.documents.charts.title).toBe('Charts');
  });

  it('takes inline documents as they are', async () => {
    const inline = { ...manifest, documents: { daily: form, charts } };
    const { bundle } = await fetchBundle(BASE, server({ [BASE]: inline }));
    expect(bundle?.documents.daily).toEqual(form);
  });

  it('fails with an issue per missing document or reference', async () => {
    const m = { ...manifest, tabs: [...manifest.tabs, { id: 'm', title: 'More', screen: { type: 'menu', items: [{ form: 'ghost' }] } }] };
    const { bundle, issues } = await fetchBundle(BASE, server({ [BASE]: m, 'http://host:3302/config/forms/daily.json': form }));
    expect(bundle).toBeUndefined();
    expect(issues.map((i) => `${i.severity} ${i.path}`)).toEqual([
      'error ../shared/charts.json',
      'error app.json: tabs[2].screen.items[0].form',
    ]);
  });

  it('flags input panels without a metric, and forms without inputs', async () => {
    const noMetric = { title: 'X', panels: [{ type: 'input-text', title: 'Note', gridPos: { x: 0, y: 0, w: 24, h: 3 }, options: {} }] };
    const r1 = await fetchBundle(BASE, server({ ...files, 'http://host:3302/config/forms/daily.json': noMetric }));
    expect(r1.issues[0]).toMatchObject({ severity: 'error', path: 'forms/daily.json: panels[0].options.metric' });
    const r2 = await fetchBundle(BASE, server({ ...files, 'http://host:3302/config/forms/daily.json': charts }));
    expect(r2.bundle).toBeDefined();
    expect(r2.issues).toEqual([{ severity: 'warning', path: 'app.json: tabs[0].screen.forms[0]', message: '"daily" has no input-* panels to fill in' }]);
  });
});

describe('fetchBundle from a server that bundles', () => {
  const API = 'https://api.test/v1/configs/c1/files/app.json';
  const text = (v: unknown) => JSON.stringify(v);
  /** Answers the manifest's URL with a bundle when asked for one, like the API; records what was asked. */
  const bundling = (body: object, others: Record<string, unknown> = {}) => {
    const asked: { url: string; accept?: string }[] = [];
    const fetchJson = async (url: string, options?: { accept?: string }) => {
      asked.push({ url, accept: options?.accept });
      if (url === API && options?.accept?.includes(BUNDLE_TYPE)) return structuredClone(body);
      if (url in others) return structuredClone(others[url]);
      throw new Error('HTTP 404');
    };
    return { asked, fetchJson };
  };
  const bundle = (files: Record<string, unknown>, extra: object = {}) => ({
    $bundle: 1,
    revision: 7,
    manifest: 'app.json',
    commit: '../commit',
    files: Object.fromEntries(Object.entries(files).map(([p, v]) => [p, { revision: 1, text: typeof v === 'string' ? v : text(v) }])),
    ...extra,
  });

  it('loads the whole config in one request, with its revision', async () => {
    const m = { ...manifest, documents: { daily: 'forms/daily.json', charts: 'dashboards/charts.json' } };
    const { asked, fetchJson } = bundling(bundle({ 'app.json': m, 'forms/daily.json': form, 'dashboards/charts.json': charts }));
    const result = await fetchBundle(API, fetchJson);
    expect(result.issues).toEqual([]);
    expect(result.revision).toBe('7');
    expect(result.bundle?.documents.charts.title).toBe('Charts');
    expect(asked).toEqual([{ url: API, accept: BUNDLE_ACCEPT }]);
  });

  it('still fetches documents from outside the config', async () => {
    const m = { ...manifest, documents: { daily: 'forms/daily.json', charts: 'https://cdn.test/charts.json' } };
    const { asked, fetchJson } = bundling(bundle({ 'app.json': m, 'forms/daily.json': form }), { 'https://cdn.test/charts.json': charts });
    const result = await fetchBundle(API, fetchJson);
    expect(result.bundle?.documents.charts.title).toBe('Charts');
    expect(asked.map((a) => a.url)).toEqual([API, 'https://cdn.test/charts.json']);
  });

  it('reports a document missing from the bundle, or one that isn’t JSON, without fetching it', async () => {
    const m = { ...manifest, documents: { daily: 'forms/daily.json', charts: 'dashboards/charts.json' } };
    const { asked, fetchJson } = bundling(bundle({ 'app.json': m, 'forms/daily.json': '{"title": ' }));
    const result = await fetchBundle(API, fetchJson);
    expect(result.bundle).toBeUndefined();
    expect(result.issues.map((i) => `${i.path}: ${i.message}`).sort()).toEqual([
      'dashboards/charts.json: not found in the config',
      expect.stringMatching(/^forms\/daily\.json: .*JSON/),
    ]);
    expect(asked).toHaveLength(1);
  });

  it('resolves paths from a manifest in a subfolder against the config’s root', async () => {
    const url = 'https://api.test/v1/configs/c1/files/apps/main.json';
    const m = { ...manifest, documents: { daily: 'daily.json', charts: '../shared/charts.json' } };
    const body = bundle({ 'apps/main.json': m, 'apps/daily.json': form, 'shared/charts.json': charts }, { manifest: 'apps/main.json' });
    const result = await fetchBundle(url, async (u, o) => {
      if (u === url && o?.accept?.includes(BUNDLE_TYPE)) return structuredClone(body);
      throw new Error('HTTP 404');
    });
    expect(result.issues).toEqual([]);
    expect(Object.keys(result.bundle!.documents).sort()).toEqual(['charts', 'daily']);
  });

  it('falls back to file by file when the server just sends the manifest', async () => {
    const result = await fetchBundle(BASE, server(files));
    expect(result.bundle?.documents.daily.title).toBe('Daily');
    expect(result.revision).toBeUndefined();
  });
});

describe('ConfigLoader', () => {
  const fallback: ConfigBundle = { manifest: { ...manifest, title: 'Bundled', documents: {} }, documents: {} };
  const memoryCache = (initial: CachedConfig | null = null) => {
    let saved = initial;
    return { read: async () => saved, write: async (c: CachedConfig) => void (saved = c), get: () => saved };
  };

  it('shows the fallback, then the fetched config, and caches it', async () => {
    const cache = memoryCache();
    const loader = new ConfigLoader({ url: BASE, cache, fallback, fetchJson: server(files) });
    expect(loader.state).toMatchObject({ source: 'bundled', loading: true });
    await loader.start();
    expect(loader.state).toMatchObject({ source: 'remote', loading: false, error: undefined });
    expect(loader.state.bundle?.manifest.title).toBe('Test');
    expect(cache.get()?.bundle.manifest.title).toBe('Test');
  });

  it('keeps the last good config when a fetch fails', async () => {
    let live: Record<string, unknown> = files;
    const loader = new ConfigLoader({ url: BASE, fetchJson: (url) => server(live)(url) });
    await loader.start();
    live = { ...files, [BASE]: { ...manifest, tabs: [] } };
    await loader.refresh();
    expect(loader.state.bundle?.manifest.title).toBe('Test');
    expect(loader.state.error).toBe('1 error');
    expect(loader.state.issues[0]).toMatchObject({ path: 'app.json: tabs', message: 'must not be empty' });
  });

  it('starts from a cached copy of the same URL only', async () => {
    const cached = { url: BASE, fetchedAt: 1, bundle: { ...fallback, manifest: { ...fallback.manifest, title: 'Cached' } } };
    const offline = async () => {
      throw new Error('offline');
    };
    const same = new ConfigLoader({ url: BASE, cache: memoryCache(cached), fallback, fetchJson: offline });
    await same.start();
    expect(same.state).toMatchObject({ source: 'cache', fetchedAt: 1, error: '1 error', issues: [{ path: 'app.json', message: 'offline' }] });
    expect(same.state.bundle?.manifest.title).toBe('Cached');
    const other = new ConfigLoader({ url: 'http://elsewhere/app.json', cache: memoryCache(cached), fallback, fetchJson: offline });
    await other.start();
    expect(other.state.bundle?.manifest.title).toBe('Bundled');
  });

  it('only notifies when something changed', async () => {
    const loader = new ConfigLoader({ url: BASE, fetchJson: server(files) });
    let calls = 0;
    loader.subscribe(() => calls++);
    await loader.start();
    const after = calls;
    const snapshot = loader.state;
    await loader.refresh();
    await loader.refresh();
    expect(calls).toBe(after);
    expect(loader.state).toBe(snapshot);
  });
});

describe('prepareDashboard', () => {
  const panel = (extra: object = {}) => ({ type: 'stat', title: 'T', gridPos: { x: 0, y: 0, w: 12, h: 4 }, ...extra });
  const prep = (panels: object[]) => prepareDashboard({ title: 'D', panels }, 'd.json');

  it('leaves the real dashboards and forms exactly as they are', () => {
    const root = path.resolve(__dirname, 'fixtures');
    for (const file of [
      'config/dashboards/trends.json',
      'config/dashboards/workouts.json',
      'config/forms/daily.json',
      'config/forms/workout.json',
      'tracker/insights.json',
      'tracker/setup.json',
      'tracker/track-day.json',
    ]) {
      const json = JSON.parse(readFileSync(path.join(root, file), 'utf8'));
      const { dashboard, issues } = prepareDashboard(json, file);
      expect(dashboard, file).toEqual(json);
      expect(issues.filter((i) => i.message.includes('ignored')), file).toEqual([]);
    }
  });

  it('removes values of the wrong type, saying so, and keeps the rest of the panel', () => {
    const { dashboard, issues } = prep([panel({ title: 42, targets: [{ refId: 'A', metric: ['x'], alias: 'Kept' }] })]);
    expect(dashboard!.panels[0]).toEqual({ type: 'stat', gridPos: { x: 0, y: 0, w: 12, h: 4 }, targets: [{ refId: 'A', alias: 'Kept' }] });
    expect(issues).toEqual([
      { severity: 'warning', path: 'd.json: panels[0].targets[0].metric', message: 'must be string, so it’s ignored' },
      { severity: 'warning', path: 'd.json: panels[0].title', message: 'must be string, so it’s ignored' },
    ]);
  });

  it('removes an object left without something it requires, but not one that never had it', () => {
    // refId is required: removing a bad one takes the target with it, while a target that simply lacks one stays.
    const { dashboard } = prep([panel({ targets: [{ refId: 7, metric: 'a' }, { metric: 'b' }] })]);
    expect(dashboard!.panels[0].targets).toEqual([{ metric: 'b' }]);
  });

  it('drops a row’s panels that can’t render, rather than failing the dashboard', () => {
    const row = { type: 'row', title: 'R', gridPos: { x: 0, y: 0, w: 24, h: 1 }, collapsed: true, panels: [{}, panel(), { type: 'input-text', gridPos: { x: 0, y: 0, w: 1, h: 1 } }] };
    const { dashboard, issues } = prep([row]);
    expect(dashboard!.panels[0].panels).toEqual([panel()]);
    expect(issues.map((i) => `${i.path}: ${i.message}`)).toEqual([
      'd.json: panels[0].panels[0]: has no type, so it’s ignored',
      'd.json: panels[0].panels[2]: input-text needs a metric to record to, so it’s ignored',
    ]);
  });

  it('still refuses what can’t render at all', () => {
    expect(prep([panel({ gridPos: { x: 0 } })]).dashboard).toBeUndefined();
    expect(prepareDashboard({ panels: [] }, 'd.json').dashboard).toBeUndefined();
  });

  it('never changes what it was given', () => {
    const json = { title: 'D', panels: [panel({ title: 42 })] };
    prepareDashboard(json, 'd.json');
    expect(json.panels[0].title).toBe(42);
  });
});
