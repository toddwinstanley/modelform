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
import { cleanDashboard, dashboardSchemaIssues, manifestSchemaIssues } from './configSchema';
import { inputPanels } from './inputs';
import { cleanPanelOptions } from './panelOptions';
import type { Dashboard } from './schema';

export const MANIFEST_VERSION = 1;

/** The root of an app config: navigation, plus the documents it shows. Annotations here feed schema/app.schema.json. */
export interface AppManifest {
  /** Format version. Always 1 for now. */
  version: number;
  /**
   * The app's name.
   * @minLength 1
   */
  title: string;
  /**
   * The bottom tabs, in order.
   * @minItems 1
   */
  tabs: Tab[];
  /** Dashboards and forms by id: a path relative to this file, or the dashboard JSON inline. */
  documents: Record<string, string | Dashboard>;
}

export interface Tab {
  /**
   * Also the tab's route, so keep it URL-safe and stable.
   * @pattern ^[A-Za-z0-9_-]+$
   */
  id: string;
  /** @minLength 1 */
  title: string;
  /** A name from the app's icon set (e.g. "edit", "chart"), or per-platform symbol names. */
  icon?: string | { ios?: string; android?: string; web?: string };
  screen: Screen;
}

export type Screen =
  /** One dashboard. */
  | { type: 'dashboard'; dashboard: string }
  /** Input forms, picked with chips when there's more than one. */
  | {
      type: 'forms';
      /** @minItems 1 */
      forms: string[];
    }
  /** A list that opens dashboards and forms. */
  | { type: 'menu'; items: MenuItem[] };

export interface MenuItem {
  /** Defaults to the document's title. */
  title?: string;
  description?: string;
  /** A dashboard to open. Give this or `form`, not both. */
  dashboard?: string;
  /** A form to open. Give this or `dashboard`, not both. */
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

/**
 * Checks the manifest's own shape against schema/app.schema.json, plus what the schema can't
 * say. Inline documents are left to validateDashboard, and document references to
 * validateBundle once documents are loaded.
 */
export function validateManifest(json: unknown, file = 'manifest'): ConfigIssue[] {
  const error = (path: string, message: string): ConfigIssue => ({ severity: 'error', path: `${file}: ${path}`, message });
  const shape = manifestSchemaIssues(json).filter((i) => !/^documents\.[^.[]+[.[]/.test(i.path));
  if (shape.length) return shape.map((i) => error(i.path, i.message));
  const issues: ConfigIssue[] = [];
  const ids = new Set<string>();
  (json as AppManifest).tabs.forEach((tab, i) => {
    if (ids.has(tab.id)) issues.push(error(`tabs[${i}].id`, `"${tab.id}" is used by another tab`));
    ids.add(tab.id);
    if (tab.screen.type === 'menu')
      tab.screen.items.forEach((item, j) => {
        if (!item.dashboard === !item.form) issues.push(error(`tabs[${i}].screen.items[${j}]`, 'needs either "dashboard" or "form"'));
      });
  });
  return issues;
}

/**
 * Checks a dashboard or form and readies it for rendering. Errors are what would stop it
 * rendering, and leave no dashboard. Otherwise values that don't fit the schema (a title
 * that's a number, say) are removed, each with a warning, so the renderer never sees them;
 * anything else the schema flags (unknown keys, mostly) is a warning, since Grafana exports
 * often carry values modelform just ignores.
 */
export function prepareDashboard(json: unknown, file: string): { dashboard?: Dashboard; issues: ConfigIssue[] } {
  const errors = dashboardErrors(json, file);
  if (errors.length) return { issues: [...errors, ...schemaWarnings(json, file, errors)] };
  const { value, removed } = cleanDashboard(json);
  const dashboard = value as Dashboard;
  // A row's own panels only show when it's expanded, so one that can't render is dropped rather than failing the dashboard.
  dashboard.panels.forEach((row, i) => {
    if (!Array.isArray(row.panels)) return;
    row.panels = row.panels.filter((child, j) => {
      const problem = panelProblem(child);
      if (problem) removed.push({ path: `panels[${i}].panels[${j}]`, message: problem.summary });
      return !problem;
    });
  });
  // The schema types options loosely; what each panel type reads is checked here.
  dashboard.panels.forEach((p, i) => {
    for (const r of cleanPanelOptions(p)) removed.push({ path: `panels[${i}]${r.path}`, message: r.message });
    p.panels?.forEach((child, j) => {
      for (const r of cleanPanelOptions(child)) removed.push({ path: `panels[${i}].panels[${j}]${r.path}`, message: r.message });
    });
  });
  return {
    dashboard,
    issues: [
      ...removed.map((r): ConfigIssue => ({ severity: 'warning', path: `${file}: ${r.path}`, message: `${r.message}, so it’s ignored` })),
      ...schemaWarnings(dashboard, file, []),
    ],
  };
}

/**
 * Why a panel can't be laid out or rendered at all, if it can't: where (relative to the panel)
 * and what, and the same as one phrase about the whole panel.
 */
function panelProblem(p: unknown): { at: string; message: string; summary: string } | null {
  if (!isObject(p)) return { at: '', message: 'must be an object', summary: 'must be an object' };
  if (typeof p.type !== 'string') return { at: '.type', message: 'must be a string', summary: 'has no type' };
  const g = p.gridPos;
  if (!isObject(g) || !['x', 'y', 'w', 'h'].every((k) => typeof g[k] === 'number'))
    return { at: '.gridPos', message: 'must have numeric x, y, w and h', summary: 'has no usable gridPos' };
  if (p.type.startsWith('input-') && !nonEmptyString((p.options as Record<string, unknown>)?.metric)) {
    const message = `${p.type} needs a metric to record to`;
    return { at: '.options.metric', message, summary: message };
  }
  return null;
}

/** The issues `prepareDashboard` would find. */
export function validateDashboard(json: unknown, file: string): ConfigIssue[] {
  return prepareDashboard(json, file).issues;
}

/** What would stop a dashboard rendering at all. */
function dashboardErrors(json: unknown, file: string): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const error = (path: string, message: string) => issues.push({ severity: 'error', path: `${file}: ${path}`, message });
  if (!isObject(json)) {
    error('(root)', 'must be a JSON object');
    return issues;
  }
  if (typeof json.title !== 'string') error('title', 'must be a string');
  if (!Array.isArray(json.panels)) error('panels', 'must be an array');
  else
    json.panels.forEach((p, i) => {
      const problem = panelProblem(p);
      if (problem) error(`panels[${i}]${problem.at}`, problem.message);
    });
  return issues;
}

/** Schema findings as warnings, skipping any already covered by an error at or around the same spot. */
function schemaWarnings(json: unknown, file: string, errors: ConfigIssue[]): ConfigIssue[] {
  const covered = errors.map((i) => i.path.slice(file.length + 2));
  const near = (a: string, b: string) => a === b || a.startsWith(`${b}.`) || a.startsWith(`${b}[`) || b.startsWith(`${a}.`) || b.startsWith(`${a}[`);
  return dashboardSchemaIssues(json)
    .filter((w) => !covered.some((c) => near(w.path, c)))
    .map((w) => ({ severity: 'warning', path: `${file}: ${w.path}`, message: w.message }));
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
    // Listed but failed to load: that failure is already reported.
    if (!doc && ref.id in bundle.manifest.documents) continue;
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

/** `accept` replaces the default Accept header, e.g. to ask for a bundle. `signal` cancels the request. */
export type FetchJson = (url: string, options?: { accept?: string; signal?: AbortSignal }) => Promise<unknown>;

export interface HttpFetchJsonOptions {
  /** Extra request headers, e.g. Authorization. */
  headers?: () => Promise<Record<string, string>> | Record<string, string>;
  /** The error message for a failed response. Defaults to `HTTP <status>`. */
  httpError?: (status: number) => string;
}

/**
 * A FetchJson over fetch(). It remembers each response's ETag and sends it back as
 * If-None-Match, so a file that hasn't changed comes back as a 304 and is answered from
 * memory. On the web that only happens where the server exposes ETag to scripts.
 */
export function httpFetchJson(options: HttpFetchJsonOptions = {}): FetchJson {
  const seen = new Map<string, { etag: string; json: unknown }>();
  return async (url, { accept = 'application/json', signal } = {}) => {
    const extra = (await options.headers?.()) ?? {};
    // Keyed by the headers too, so one user's copy is never the answer to another's request.
    const key = JSON.stringify([url, accept, extra]);
    const last = seen.get(key);
    const get = (etag?: string) =>
      fetch(url, { headers: { Accept: accept, ...extra, ...(etag && { 'If-None-Match': etag }) }, cache: 'no-store', signal });
    // A host that sends ETags but won't take If-None-Match across origins fails the conditional
    // request outright on the web; ask again without it, and stop sending it.
    const res = await get(last?.etag).catch((e) => {
      if (!last || signal?.aborted) throw e;
      seen.delete(key);
      return get();
    });
    if (res.status === 304 && last) return last.json;
    // Callers prefix errors with the file's path, so these don't repeat the URL.
    if (!res.ok) throw new Error(options.httpError?.(res.status) ?? `HTTP ${res.status}`);
    const json = JSON.parse(await res.text());
    const etag = res.headers.get('ETag');
    if (etag) seen.set(key, { etag, json });
    else seen.delete(key);
    return json;
  };
}

export const defaultFetchJson: FetchJson = httpFetchJson();

export interface LoadResult {
  /** Present when there are no errors. */
  bundle?: ConfigBundle;
  issues: ConfigIssue[];
  /** The config's revision, when the server sent it as one bundle. */
  revision?: string;
  /** True when the manifest couldn't be fetched at all (no network, an HTTP error, a timeout), as opposed to a config with errors. */
  unreachable?: boolean;
}

const fileName = (url: string) => url.replace(/[?#].*$/, '').split('/').pop() || url;

/** Asked for on the manifest's URL, a server that can returns the whole config in one response. */
export const BUNDLE_TYPE = 'application/vnd.modelform.bundle+json';
export const BUNDLE_ACCEPT = `${BUNDLE_TYPE}, application/json;q=0.9`;

/**
 * A whole config as of one moment: what the API and the dev config server send for the
 * manifest's URL when asked for BUNDLE_TYPE. File paths are relative to the config's root,
 * of which `manifest` is one; `commit` (relative to the manifest's URL) saves several at once.
 */
export interface BundleResponse {
  $bundle: 1;
  revision: string | number;
  manifest: string;
  commit?: string;
  files: Record<string, { revision: string | number; text: string }>;
}

export function isBundleResponse(json: unknown): json is BundleResponse {
  const b = json as BundleResponse | null;
  return !!b && typeof b === 'object' && b.$bundle === 1 && typeof b.manifest === 'string' && !!b.files && typeof b.files === 'object';
}

/** The URL of a bundle's root folder, from the manifest's URL. */
export function bundleRoot(manifestUrl: string, manifestPath: string): string {
  const bare = manifestUrl.replace(/[?#].*$/, '');
  return bare.endsWith(manifestPath) ? bare.slice(0, bare.length - manifestPath.length) : bare.replace(/[^/]*$/, '');
}

const NOT_IN_BUNDLE = 'not found in the config';

/**
 * Builds a bundle from a server's bundle response. Documents inside the config come from the
 * response; one elsewhere (an absolute URL) is still fetched.
 */
export async function assembleFromResponse(
  url: string,
  response: BundleResponse,
  fetchJson: FetchJson = defaultFetchJson,
  signal?: AbortSignal,
): Promise<LoadResult> {
  const root = bundleRoot(url, response.manifest);
  const file = fileName(url);
  const parse = (path: string) => {
    const f = response.files[path];
    if (!f) throw new Error(NOT_IN_BUNDLE);
    return JSON.parse(f.text);
  };
  let manifest: unknown;
  try {
    manifest = parse(response.manifest);
  } catch (e) {
    return { issues: [{ severity: 'error', path: file, message: (e as Error).message }] };
  }
  const result = await assembleBundle(
    manifest,
    async (ref) => {
      const abs = resolveUrl(url, ref).replace(/[?#].*$/, '');
      return abs.startsWith(root) ? parse(abs.slice(root.length)) : fetchJson(resolveUrl(url, ref), { signal });
    },
    file,
  );
  return { ...result, revision: String(response.revision) };
}

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
        const { dashboard, issues: docIssues } = prepareDashboard(json, name);
        issues.push(...docIssues);
        if (dashboard) documents[id] = dashboard;
      } catch (e) {
        issues.push({ severity: 'error', path: name, message: (e as Error).message });
      }
    }),
  );
  const bundle = { manifest: m, documents };
  issues.push(...validateBundle(bundle, file));
  return issues.some((i) => i.severity === 'error') ? { issues } : { bundle, issues };
}

/**
 * Fetches a config: in one response from a server that bundles (all of it from the same
 * moment), or else the manifest and then each document it points to, resolved against its URL.
 */
export async function fetchBundle(url: string, fetchJson: FetchJson = defaultFetchJson, signal?: AbortSignal): Promise<LoadResult> {
  let manifest: unknown;
  try {
    manifest = await fetchJson(url, { accept: BUNDLE_ACCEPT, signal });
  } catch (e) {
    // A manifest that arrived but isn't JSON is the config's problem, not the connection's.
    return { issues: [{ severity: 'error', path: fileName(url), message: (e as Error).message }], ...(!(e instanceof SyntaxError) && { unreachable: true }) };
  }
  if (isBundleResponse(manifest)) return assembleFromResponse(url, manifest, fetchJson, signal);
  return assembleBundle(manifest, (path) => fetchJson(resolveUrl(url, path), { signal }), fileName(url));
}

/**
 * Checks a bundle that was assembled earlier (a cached copy, say) as if it had just been
 * fetched, since the checks may have changed since. Returns it readied for rendering, or
 * nothing if it no longer loads.
 */
export function revalidateBundle(bundle: ConfigBundle): ConfigBundle | undefined {
  try {
    const { manifest } = bundle;
    if (validateManifest(manifest).length) return undefined;
    const documents: Record<string, Dashboard> = {};
    for (const id of Object.keys(manifest.documents)) {
      const { dashboard } = prepareDashboard(bundle.documents[id], id);
      if (!dashboard) return undefined;
      documents[id] = dashboard;
    }
    const checked = { manifest, documents };
    return validateBundle(checked).some((i) => i.severity === 'error') ? undefined : checked;
  } catch {
    return undefined;
  }
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
  revision?: string;
}

export interface ConfigState {
  bundle?: ConfigBundle;
  source: 'none' | 'bundled' | 'cache' | 'remote';
  url?: string;
  /** When the bundle shown was fetched (cache or remote). */
  fetchedAt?: number;
  /** The shown config's revision, when the server gives one. */
  revision?: string;
  loading: boolean;
  /**
   * Set when the last fetch failed; the bundle shown is then the last good one. See `issues`.
   * A summary ("2 errors") for a config with errors, or why the server couldn't be reached
   * ("HTTP 503", "no answer in 15s") when `unreachable`.
   */
  error?: string;
  /** True when the last fetch failed because the config couldn't be fetched at all, not because it has errors. */
  unreachable?: boolean;
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
  /** How long a fetch may take before it's abandoned. Defaults to 15 seconds. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Keeps the app's config current. Shows the bundled fallback, then the cached copy,
 * then each newer fetch that validates. A bad fetch never replaces a good config: it's
 * reported in `error`/`issues` and the last good bundle stays. Call `dispose` when done
 * with a loader, so a fetch still in flight can't write the cache afterwards.
 */
export class ConfigLoader {
  private listeners = new Set<() => void>();
  private snapshot: ConfigState;
  private lastJson?: string;
  private inflight?: Promise<void>;
  private controller?: AbortController;
  private disposed = false;

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

  /** Loads the cached copy (if it was fetched from the same URL and still checks out), then fetches. */
  async start() {
    const { url, cache } = this.options;
    if (!url) return;
    const cached = await cache?.read().catch(() => null);
    const bundle = cached?.url === url ? revalidateBundle(cached.bundle) : undefined;
    if (cached && bundle && !this.snapshot.fetchedAt) {
      this.lastJson = JSON.stringify(bundle);
      this.set({ bundle, source: 'cache', fetchedAt: cached.fetchedAt, revision: cached.revision });
    }
    await this.refresh();
  }

  /** Fetches now. Concurrent calls share one fetch. Only notifies listeners when something changed. */
  refresh(): Promise<void> {
    const { url, cache, fetchJson, timeoutMs = DEFAULT_TIMEOUT_MS } = this.options;
    if (!url || this.disposed) return Promise.resolve();
    this.inflight ??= (async () => {
      const controller = new AbortController();
      this.controller = controller;
      // Raced as well as aborted, so a fetchJson that ignores the signal can't hang the loader either.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const abandoned = new Promise<LoadResult>((resolve) => {
        const fail = (message: string) => resolve({ issues: [{ severity: 'error', path: fileName(url), message }], unreachable: true });
        timer = setTimeout(() => {
          fail(`no answer in ${timeoutMs / 1000}s`);
          controller.abort();
        }, timeoutMs);
        controller.signal.addEventListener('abort', () => fail('cancelled'));
      });
      try {
        const result = await Promise.race([fetchBundle(url, fetchJson, controller.signal), abandoned]);
        if (this.disposed) return;
        const { bundle, issues, revision, unreachable } = result;
        if (!bundle) {
          const errors = issues.filter((i) => i.severity === 'error').length;
          const error = unreachable ? issues[0]?.message : errors === 1 ? '1 error' : `${errors} errors`;
          return this.set(
            { loading: false, error, unreachable: !!unreachable, issues },
            this.snapshot.loading || error !== this.snapshot.error || !!unreachable !== !!this.snapshot.unreachable || !sameIssues(issues, this.snapshot.issues),
          );
        }
        const json = JSON.stringify(bundle);
        const changed = json !== this.lastJson;
        this.lastJson = json;
        const fetchedAt = Date.now();
        if (changed || revision !== this.snapshot.revision) cache?.write({ url, fetchedAt, bundle, revision }).catch(() => {});
        this.set(
          { ...(changed && { bundle }), source: 'remote', fetchedAt, revision, loading: false, error: undefined, unreachable: undefined, issues },
          changed ||
            revision !== this.snapshot.revision ||
            this.snapshot.source !== 'remote' ||
            !!this.snapshot.error ||
            this.snapshot.loading ||
            !sameIssues(issues, this.snapshot.issues),
        );
      } finally {
        clearTimeout(timer);
        if (this.controller === controller) this.controller = undefined;
        this.inflight = undefined;
      }
    })();
    return this.inflight;
  }

  /** Stops the loader: cancels a fetch in flight, and nothing it does afterwards changes the state or the cache. */
  dispose() {
    this.disposed = true;
    this.controller?.abort();
    this.listeners.clear();
  }

  /** `notify: false` drops the patch, so the snapshot only changes when listeners hear about it. */
  private set(patch: Partial<ConfigState>, notify = true) {
    if (!notify || this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((l) => l());
  }
}

const sameIssues = (a: ConfigIssue[], b: ConfigIssue[]) => JSON.stringify(a) === JSON.stringify(b);
