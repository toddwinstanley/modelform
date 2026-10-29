/**
 * App config loaded at runtime: a root manifest that lays out navigation, plus the
 * dashboards and forms (Grafana dashboard JSON) it refers to by id.
 *
 *   {
 *     "version": 1,
 *     "title": "My Log",
 *     "tabs": [
 *       { "id": "log", "title": "Log", "icon": "edit", "screen": { "type": "forms", "forms": ["daily"] } },
 *       { "id": "charts", "title": "Charts", "icon": "chart", "screen": { "type": "dashboard", "dashboard": "trends" } }
 *     ],
 *     "documents": { "daily": "forms/daily.json", "trends": { "title": "Trends", "panels": [] } }
 *   }
 *
 * A document is either a path (relative to the manifest's URL) or the dashboard inlined.
 */
import { inputPanels } from './inputs';
import type { Dashboard } from './schema';

export const MANIFEST_VERSION = 1;

export interface AppManifest {
  version: number;
  title: string;
  tabs: Tab[];
  documents: Record<string, string | Dashboard>;
}

export interface Tab {
  /** Also the tab's route, so keep it URL-safe and stable. */
  id: string;
  title: string;
  /** A name from the app's icon set (e.g. "edit", "chart"), or per-platform symbol names. */
  icon?: string | { ios?: string; android?: string; web?: string };
  screen: Screen;
}

export type Screen =
  /** One dashboard. */
  | { type: 'dashboard'; dashboard: string }
  /** Input forms, picked with chips when there's more than one. */
  | { type: 'forms'; forms: string[] }
  /** A list that opens dashboards and forms. */
  | { type: 'menu'; items: MenuItem[] };

export interface MenuItem {
  /** Defaults to the document's title. */
  title?: string;
  description?: string;
  /** Exactly one of these. */
  dashboard?: string;
  form?: string;
}

/** A manifest with every document fetched and parsed. */
export interface ConfigBundle {
  manifest: AppManifest;
  documents: Record<string, Dashboard>;
}

export interface ConfigIssue {
  severity: 'error' | 'warning';
  /** Where in the config, e.g. `app.json: tabs[1].screen.dashboard` or `forms/daily.json: panels[3]`. */
  path: string;
  message: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** Checks the manifest's own shape. Document references are checked by validateBundle once documents are loaded. */
export function validateManifest(json: unknown, file = 'manifest'): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const error = (path: string, message: string) => issues.push({ severity: 'error', path: `${file}: ${path}`, message });
  if (!isObject(json)) {
    error('(root)', 'must be a JSON object');
    return issues;
  }
  if (json.version !== MANIFEST_VERSION) error('version', `must be ${MANIFEST_VERSION}`);
  if (!nonEmptyString(json.title)) error('title', 'must be a non-empty string');
  if (!isObject(json.documents)) error('documents', 'must be an object of id → path or dashboard');
  else
    for (const [id, d] of Object.entries(json.documents))
      if (!nonEmptyString(d) && !isObject(d)) error(`documents.${id}`, 'must be a path or an inline dashboard');
  if (!Array.isArray(json.tabs) || !json.tabs.length) {
    error('tabs', 'must be a non-empty array');
    return issues;
  }
  const ids = new Set<string>();
  json.tabs.forEach((tab, i) => {
    const at = `tabs[${i}]`;
    if (!isObject(tab)) return error(at, 'must be an object');
    if (!nonEmptyString(tab.id) || !/^[\w-]+$/.test(tab.id)) error(`${at}.id`, 'must be letters, digits, - or _');
    else if (ids.has(tab.id)) error(`${at}.id`, `"${tab.id}" is used by another tab`);
    else ids.add(tab.id);
    if (!nonEmptyString(tab.title)) error(`${at}.title`, 'must be a non-empty string');
    const s = tab.screen;
    if (!isObject(s)) return error(`${at}.screen`, 'must be an object');
    switch (s.type) {
      case 'dashboard':
        if (!nonEmptyString(s.dashboard)) error(`${at}.screen.dashboard`, 'must be a document id');
        break;
      case 'forms':
        if (!Array.isArray(s.forms) || !s.forms.length || !s.forms.every(nonEmptyString))
          error(`${at}.screen.forms`, 'must be a non-empty array of document ids');
        break;
      case 'menu':
        if (!Array.isArray(s.items)) error(`${at}.screen.items`, 'must be an array');
        else
          s.items.forEach((item, j) => {
            if (!isObject(item) || nonEmptyString(item.dashboard) === nonEmptyString(item.form))
              error(`${at}.screen.items[${j}]`, 'must have either "dashboard" or "form"');
          });
        break;
      default:
        error(`${at}.screen.type`, 'must be "dashboard", "forms" or "menu"');
    }
  });
  return issues;
}

/** Checks a dashboard or form well enough that rendering it won't throw. */
export function validateDashboard(json: unknown, file: string): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const error = (path: string, message: string) => issues.push({ severity: 'error', path: `${file}: ${path}`, message });
  if (!isObject(json)) {
    error('(root)', 'must be a JSON object');
    return issues;
  }
  if (typeof json.title !== 'string') error('title', 'must be a string');
  if (!Array.isArray(json.panels)) {
    error('panels', 'must be an array');
    return issues;
  }
  json.panels.forEach((p, i) => {
    if (!isObject(p)) return error(`panels[${i}]`, 'must be an object');
    if (typeof p.type !== 'string') error(`panels[${i}].type`, 'must be a string');
    const g = p.gridPos;
    if (!isObject(g) || !['x', 'y', 'w', 'h'].every((k) => typeof g[k] === 'number'))
      error(`panels[${i}].gridPos`, 'must have numeric x, y, w and h');
    if (typeof p.type === 'string' && p.type.startsWith('input-') && !nonEmptyString((p.options as Record<string, unknown>)?.metric))
      error(`panels[${i}].options.metric`, `${p.type} needs a metric to record to`);
  });
  return issues;
}

/** Every document id the manifest's screens refer to, with where and what kind. */
function references(manifest: AppManifest) {
  const refs: { id: string; path: string; kind: 'dashboard' | 'form' }[] = [];
  manifest.tabs.forEach((tab, i) => {
    const at = `tabs[${i}].screen`;
    const s = tab.screen;
    if (s.type === 'dashboard') refs.push({ id: s.dashboard, path: `${at}.dashboard`, kind: 'dashboard' });
    else if (s.type === 'forms') s.forms.forEach((id, j) => refs.push({ id, path: `${at}.forms[${j}]`, kind: 'form' }));
    else
      s.items.forEach((item, j) => {
        if (item.dashboard) refs.push({ id: item.dashboard, path: `${at}.items[${j}].dashboard`, kind: 'dashboard' });
        if (item.form) refs.push({ id: item.form, path: `${at}.items[${j}].form`, kind: 'form' });
      });
  });
  return refs;
}

/** Cross-checks a loaded bundle: screens must point at documents that exist, and forms must have inputs. */
export function validateBundle(bundle: ConfigBundle, file = 'manifest'): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  for (const ref of references(bundle.manifest)) {
    const doc = bundle.documents[ref.id];
    if (!doc) issues.push({ severity: 'error', path: `${file}: ${ref.path}`, message: `no document "${ref.id}" in documents` });
    else if (ref.kind === 'form' && !inputPanels(doc).length)
      issues.push({ severity: 'warning', path: `${file}: ${ref.path}`, message: `"${ref.id}" has no input-* panels to fill in` });
  }
  const used = new Set(references(bundle.manifest).map((r) => r.id));
  for (const id of Object.keys(bundle.documents))
    if (!used.has(id)) issues.push({ severity: 'warning', path: `${file}: documents.${id}`, message: 'not used by any tab' });
  return issues;
}

/**
 * Resolves `rel` against the URL of the file that referenced it. Hand-rolled because
 * React Native's URL polyfill doesn't support relative resolution.
 */
export function resolveUrl(base: string, rel: string): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(rel)) return rel;
  const [, origin = '', basePath = '/'] = base.match(/^([a-z][a-z\d+.-]*:\/\/[^/?#]*)?([^?#]*)/i) ?? [];
  const path = rel.startsWith('/') ? rel : basePath.replace(/[^/]*$/, '') + rel;
  const out: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '..') {
      if (out.length > 1) out.pop();
    } else if (seg !== '.') out.push(seg);
  }
  return origin + out.join('/');
}

export type FetchJson = (url: string) => Promise<unknown>;

export const defaultFetchJson: FetchJson = async (url) => {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  // Callers prefix errors with the file's path, so these don't repeat the URL.
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(await res.text());
};

export interface LoadResult {
  /** Present when there are no errors. */
  bundle?: ConfigBundle;
  issues: ConfigIssue[];
}

const fileName = (url: string) => url.replace(/[?#].*$/, '').split('/').pop() || url;

/**
 * Builds a bundle from a parsed manifest, getting each path document with `load`.
 * Never throws: failures to fetch or parse come back as issues.
 */
export async function assembleBundle(manifest: unknown, load: (path: string) => Promise<unknown>, file = 'manifest'): Promise<LoadResult> {
  const issues = validateManifest(manifest, file);
  if (issues.length) return { issues };
  const m = manifest as AppManifest;
  const documents: Record<string, Dashboard> = {};
  await Promise.all(
    Object.entries(m.documents).map(async ([id, ref]) => {
      const name = typeof ref === 'string' ? ref : `${file}: documents.${id}`;
      try {
        const json = typeof ref === 'string' ? await load(ref) : ref;
        const docIssues = validateDashboard(json, name);
        issues.push(...docIssues);
        if (!docIssues.length) documents[id] = json as Dashboard;
      } catch (e) {
        issues.push({ severity: 'error', path: name, message: (e as Error).message });
      }
    }),
  );
  const bundle = { manifest: m, documents };
  issues.push(...validateBundle(bundle, file));
  return issues.some((i) => i.severity === 'error') ? { issues } : { bundle, issues };
}

/** Fetches a manifest and the documents it points to, resolving paths against its URL. */
export async function fetchBundle(url: string, fetchJson: FetchJson = defaultFetchJson): Promise<LoadResult> {
  let manifest: unknown;
  try {
    manifest = await fetchJson(url);
  } catch (e) {
    return { issues: [{ severity: 'error', path: fileName(url), message: (e as Error).message }] };
  }
  return assembleBundle(manifest, (path) => fetchJson(resolveUrl(url, path)), fileName(url));
}

/** Where the last good config is kept between launches. */
export interface ConfigCache {
  read(): Promise<CachedConfig | null>;
  write(config: CachedConfig): Promise<void>;
}

export interface CachedConfig {
  url: string;
  fetchedAt: number;
  bundle: ConfigBundle;
}

export interface ConfigState {
  bundle?: ConfigBundle;
  source: 'none' | 'bundled' | 'cache' | 'remote';
  url?: string;
  /** When the bundle shown was fetched (cache or remote). */
  fetchedAt?: number;
  loading: boolean;
  /** A summary ("2 errors") when the last fetch failed; the bundle shown is then the last good one. See `issues`. */
  error?: string;
  /** From the last fetch, good or bad. */
  issues: ConfigIssue[];
}

export interface ConfigLoaderOptions {
  /** Where the manifest is served. Without one, only `fallback` is used. */
  url?: string;
  cache?: ConfigCache;
  /** Shown until something better loads, e.g. a config bundled with the app. */
  fallback?: ConfigBundle;
  fetchJson?: FetchJson;
}

/**
 * Keeps the app's config current. Shows the bundled fallback, then the cached copy,
 * then each newer fetch that validates. A bad fetch never replaces a good config: it's
 * reported in `error`/`issues` and the last good bundle stays.
 */
export class ConfigLoader {
  private listeners = new Set<() => void>();
  private snapshot: ConfigState;
  private lastJson?: string;
  private inflight?: Promise<void>;

  constructor(private options: ConfigLoaderOptions) {
    const { fallback, url } = options;
    this.snapshot = { bundle: fallback, source: fallback ? 'bundled' : 'none', url, loading: !!url, issues: [] };
    this.lastJson = fallback && JSON.stringify(fallback);
  }

  get state() {
    return this.snapshot;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  /** Loads the cached copy (if it was fetched from the same URL), then fetches. */
  async start() {
    const { url, cache } = this.options;
    if (!url) return;
    const cached = await cache?.read().catch(() => null);
    if (cached?.url === url && !this.snapshot.fetchedAt) {
      this.lastJson = JSON.stringify(cached.bundle);
      this.set({ bundle: cached.bundle, source: 'cache', fetchedAt: cached.fetchedAt });
    }
    await this.refresh();
  }

  /** Fetches now. Concurrent calls share one fetch. Only notifies listeners when something changed. */
  refresh(): Promise<void> {
    const { url, cache, fetchJson } = this.options;
    if (!url) return Promise.resolve();
    this.inflight ??= (async () => {
      try {
        const { bundle, issues } = await fetchBundle(url, fetchJson);
        if (!bundle) {
          const errors = issues.filter((i) => i.severity === 'error').length;
          return this.set({ loading: false, error: errors === 1 ? '1 error' : `${errors} errors`, issues });
        }
        const json = JSON.stringify(bundle);
        const changed = json !== this.lastJson;
        this.lastJson = json;
        const fetchedAt = Date.now();
        if (changed) cache?.write({ url, fetchedAt, bundle }).catch(() => {});
        this.set(
          { ...(changed && { bundle }), source: 'remote', fetchedAt, loading: false, error: undefined, issues },
          changed || this.snapshot.source !== 'remote' || !!this.snapshot.error || this.snapshot.loading || !sameIssues(issues, this.snapshot.issues),
        );
      } finally {
        this.inflight = undefined;
      }
    })();
    return this.inflight;
  }

  /** `notify: false` drops the patch, so the snapshot only changes when listeners hear about it. */
  private set(patch: Partial<ConfigState>, notify = true) {
    if (!notify) return;
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((l) => l());
  }
}

const sameIssues = (a: ConfigIssue[], b: ConfigIssue[]) => JSON.stringify(a) === JSON.stringify(b);
