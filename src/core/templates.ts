/**
 * Templates: ready-made forms and dashboards to start a config from or add to one, with the
 * tabs that show them. A template holds any number of each.
 *
 *   { "$modelform": "template", "version": 1, "title": "Workout tracker", "description": "...",
 *     "documents": [{ "kind": "form", "id": "workout", "dashboard": {...} }, ...],
 *     "tabs": [...], "metrics": ["workout-minutes", "effort"] }
 *
 * Using one copies its documents into the config: ids that clash get new ones, metrics can be
 * pointed at ones the config already records, and its tabs are added only if asked for.
 */
import { applyJsonEdits, type JsonEdit } from './jsonEdit';
import { inputPanels } from './inputs';
import { prepareDashboard, type AppManifest, type Screen, type Tab } from './manifest';
import { screenDocuments, tabIdFor } from './navigation';
import type { Dashboard } from './schema';
import { panelMetrics, renameMetrics } from './snippets';

export const TEMPLATE_VERSION = 1;

export interface TemplateDocument {
  kind: 'form' | 'dashboard';
  /** The document's id where the template was made; it gets a new one if the config has it already. */
  id: string;
  dashboard: Dashboard;
}

export interface AppTemplate {
  $modelform: 'template';
  version: number;
  title: string;
  description: string;
  documents: TemplateDocument[];
  /** Tabs showing the template's documents, in the manifest's shape. Added only when asked for. */
  tabs: Tab[];
  /** What the forms record and the dashboards read. */
  metrics: string[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const allPanels = (d: Dashboard) => (d.panels ?? []).flatMap((p) => [p, ...(p.type === 'row' ? (p.panels ?? []) : [])]);
const documentMetrics = (d: Dashboard) => [...new Set(allPanels(d).flatMap(panelMetrics))];
const recordedBy = (d: Dashboard) => inputPanels(d).map((p) => p.options.metric);

/** The template's metrics, worked out from its documents. */
const metricsOf = (documents: TemplateDocument[]) => [...new Set(documents.flatMap((d) => documentMetrics(d.dashboard)))];

/** Tabs that show only documents in `ids`; ones that also show anything else are left behind. */
function tabsShowing(tabs: Tab[], ids: Set<string>): Tab[] {
  return tabs.filter((t) => {
    const shown = screenDocuments(t.screen);
    return shown.length > 0 && shown.every((d) => ids.has(d.id));
  });
}

/**
 * A template of the config's documents `ids` (forms and dashboards by their manifest id), with
 * the tabs that show only those documents.
 */
export function makeTemplate(
  manifest: Pick<AppManifest, 'tabs'>,
  documents: Record<string, Dashboard>,
  ids: string[],
  meta: { title: string; description?: string },
): AppTemplate {
  const docs: TemplateDocument[] = ids
    .filter((id) => documents[id])
    .map((id) => ({ kind: inputPanels(documents[id]).length ? 'form' : 'dashboard', id, dashboard: structuredClone(documents[id]) }));
  return {
    $modelform: 'template',
    version: TEMPLATE_VERSION,
    title: meta.title,
    description: meta.description ?? '',
    documents: docs,
    tabs: structuredClone(tabsShowing(manifest.tabs ?? [], new Set(docs.map((d) => d.id)))),
    metrics: metricsOf(docs),
  };
}

/**
 * Reads a template, or says why it isn't one. Documents that can't render are refused; tabs
 * that show anything outside the template are dropped; metrics are worked out again.
 */
export function parseTemplate(text: string): { template: AppTemplate } | { error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { error: 'That isn’t JSON' };
  }
  if (!isObject(json) || json.$modelform !== 'template') return { error: 'That isn’t a template' };
  if (typeof json.version !== 'number' || json.version > TEMPLATE_VERSION) return { error: 'That template comes from a newer version of modelform' };
  if (typeof json.title !== 'string' || !json.title.trim()) return { error: 'The template has no title' };
  if (!Array.isArray(json.documents)) return { error: 'The template has no documents list' };
  const documents: TemplateDocument[] = [];
  const seen = new Set<string>();
  for (const [i, d] of json.documents.entries()) {
    if (!isObject(d) || (d.kind !== 'form' && d.kind !== 'dashboard') || typeof d.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(d.id))
      return { error: `Document ${i + 1} needs a kind (form or dashboard) and an id of letters, digits, - or _` };
    if (seen.has(d.id)) return { error: `Two documents are called "${d.id}"` };
    seen.add(d.id);
    const { dashboard, issues } = prepareDashboard(d.dashboard, d.id);
    if (!dashboard) return { error: `"${d.id}" can’t be shown: ${issues.find((x) => x.severity === 'error')?.message ?? 'it isn’t a dashboard'}` };
    documents.push({ kind: d.kind, id: d.id, dashboard });
  }
  const tabs = Array.isArray(json.tabs)
    ? json.tabs.filter((t): t is Tab => isObject(t) && typeof t.id === 'string' && typeof t.title === 'string' && isObject(t.screen))
    : [];
  return {
    template: {
      $modelform: 'template',
      version: TEMPLATE_VERSION,
      title: json.title.trim(),
      description: typeof json.description === 'string' ? json.description : '',
      documents,
      tabs: tabsShowing(tabs, seen),
      metrics: metricsOf(documents),
    },
  };
}

export interface TemplateNeeds {
  /** Metrics the chosen documents read that neither their forms nor the config record: worth asking to map. */
  unknown: string[];
  /** The template's forms whose metrics the config already records (directly or once mapped): ones it could do without. */
  covered: string[];
}

/**
 * What using a template would need decided, given the metrics the config's forms record, which
 * of its documents are chosen (all by default), and any mapping so far.
 */
export function templateNeeds(template: AppTemplate, recorded: Iterable<string>, chosen?: string[], metrics: Record<string, string> = {}): TemplateNeeds {
  const config = new Set(recorded);
  const docs = template.documents.filter((d) => !chosen || chosen.includes(d.id));
  const ownForms = new Set(docs.filter((d) => d.kind === 'form').flatMap((d) => recordedBy(d.dashboard)));
  const unknown = [...new Set(docs.flatMap((d) => documentMetrics(d.dashboard)))].filter((m) => !config.has(m) && !ownForms.has(m) && !(m in metrics));
  const covered = template.documents
    .filter((d) => d.kind === 'form')
    .filter((d) => {
      const recordedHere = recordedBy(d.dashboard);
      return recordedHere.length > 0 && recordedHere.every((m) => config.has(metrics[m] ?? m));
    })
    .map((d) => d.id);
  return { unknown, covered };
}

export interface ApplyOptions {
  /** Ids of the template's documents to add. Defaults to all of them. */
  documents?: string[];
  /** Metrics to read and record as ones the config already has, e.g. { weight: 'body-weight' }. */
  metrics?: Record<string, string>;
  /** Ids of the template's tabs to add. Defaults to none. */
  tabs?: string[];
}

export interface AppliedTemplate {
  /** The manifest's new text: the documents listed, and any tabs added. */
  manifest: string;
  /** New files by path, e.g. "dashboards/progress.json". */
  files: Record<string, string>;
  /** Each added document's id in the config, by its id in the template. */
  ids: Record<string, string>;
  /** Ids of the tabs added, in order. */
  tabs: string[];
}

/** `base`, or `base-2`, `base-3`... until `free` says yes. */
function unique(base: string, free: (id: string) => boolean): string {
  let id = base;
  for (let n = 2; !free(id); n++) id = `${base}-${n}`;
  return id;
}

/** A screen pointing at the added documents' new ids, without the ones that weren't added; null if nothing's left. */
function retarget(screen: Screen, ids: Record<string, string>): Screen | null {
  switch (screen.type) {
    case 'dashboard':
      return ids[screen.dashboard] ? { ...screen, dashboard: ids[screen.dashboard] } : null;
    case 'forms': {
      const forms = screen.forms.filter((f) => ids[f]).map((f) => ids[f]);
      return forms.length ? { ...screen, forms } : null;
    }
    case 'menu': {
      const items = screen.items
        .filter((i) => (i.dashboard && ids[i.dashboard]) || (i.form && ids[i.form]))
        .map((i) => ({ ...i, ...(i.dashboard && { dashboard: ids[i.dashboard] }), ...(i.form && { form: ids[i.form] }) }));
      return items.length ? { ...screen, items } : null;
    }
  }
}

/**
 * Adds a template's documents to a config: a file each under forms/ or dashboards/, listed in
 * the manifest, with ids and paths that clash renamed (`workout-2`) and metrics mapped. Tabs
 * asked for are added at the end, pointing at the new ids; one left showing nothing is skipped.
 * `paths` are the files the config has (saved or not), so a new one never lands on one.
 * Returns the manifest's new text, keeping its formatting, and the new files.
 */
export function applyTemplate(manifestText: string, paths: Iterable<string>, template: AppTemplate, options: ApplyOptions = {}): AppliedTemplate {
  let manifest: AppManifest;
  try {
    manifest = JSON.parse(manifestText) as AppManifest;
  } catch {
    throw new Error('The manifest isn’t valid JSON');
  }
  const taken = new Set(Object.keys(manifest.documents ?? {}));
  const files = new Set(paths);
  const folder = (kind: TemplateDocument['kind']) => (kind === 'form' ? 'forms' : 'dashboards');
  const edits: JsonEdit[] = [];
  const out: Record<string, string> = {};
  const ids: Record<string, string> = {};

  for (const doc of template.documents) {
    if (options.documents && !options.documents.includes(doc.id)) continue;
    const id = unique(doc.id, (c) => !taken.has(c) && !files.has(`${folder(doc.kind)}/${c}.json`));
    const path = `${folder(doc.kind)}/${id}.json`;
    taken.add(id);
    files.add(path);
    ids[doc.id] = id;
    const dashboard = options.metrics ? { ...doc.dashboard, panels: renameMetrics(doc.dashboard.panels ?? [], options.metrics) } : doc.dashboard;
    out[path] = JSON.stringify(dashboard, null, 2) + '\n';
    if (manifest.documents) edits.push({ path: ['documents', id], value: path });
    else {
      // A manifest without a documents list gets one; later documents go into it.
      edits.push({ path: ['documents'], value: { [id]: path } });
      manifest.documents = {};
    }
  }

  const tabIds = (manifest.tabs ?? []).map((t) => t.id);
  const added: string[] = [];
  let at = manifest.tabs?.length ?? 0;
  for (const tab of template.tabs) {
    if (!options.tabs?.includes(tab.id)) continue;
    const screen = retarget(tab.screen, ids);
    if (!screen) continue;
    const id = tabIdFor(tab.id, tabIds);
    tabIds.push(id);
    added.push(id);
    const value = { ...tab, id, screen };
    if (manifest.tabs) edits.push({ path: ['tabs', at++], value, insert: true });
    else {
      edits.push({ path: ['tabs'], value: [value] });
      manifest.tabs = [value];
      at = 1;
    }
  }

  return { manifest: applyJsonEdits(manifestText, edits), files: out, ids, tabs: added };
}
