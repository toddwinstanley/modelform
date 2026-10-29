import { describe, expect, it } from 'vitest';
import { ConfigLoader, fetchBundle, resolveUrl, validateManifest, type CachedConfig, type ConfigBundle } from '../src/core';

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
        { id: 'b', title: 'B', screen: { type: 'menu', items: [{ dashboard: 'a', form: 'b' }] } },
        { id: 'b', title: 'C', screen: { type: 'nope' } },
      ],
    };
    expect(validateManifest(bad, 'app.json').map((i) => i.path)).toEqual([
      'app.json: version',
      'app.json: title',
      'app.json: documents.a',
      'app.json: tabs[0].id',
      'app.json: tabs[0].screen.dashboard',
      'app.json: tabs[1].screen.items[0]',
      'app.json: tabs[2].id',
      'app.json: tabs[2].screen.type',
    ]);
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
      'error app.json: tabs[1].screen.dashboard',
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
    expect(loader.state.issues[0]).toMatchObject({ path: 'app.json: tabs', message: 'must be a non-empty array' });
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
