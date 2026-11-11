/**
 * Deleting and renaming a config's documents, as edits to the manifest's text that keep its
 * formatting, and spotting edits that change which metrics forms record (saved entries are
 * keyed by metric, so a renamed metric leaves the old entries behind).
 */
import { findNodeAtLocation, parseTree } from 'jsonc-parser';
import { inputPanels } from './inputs';
import { applyJsonEdits, type JsonEdit } from './jsonEdit';
import type { AppManifest } from './manifest';
import type { Dashboard } from './schema';

/** A document id from a title: lower case, with dashes for anything else. Empty if there's nothing to use. */
export function documentIdFor(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseManifest(text: string): AppManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('The manifest isn’t valid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The manifest isn’t an object');
  return value as AppManifest;
}

export interface RemovedDocument {
  text: string;
  /** Titles of tabs removed because they showed only this document. */
  removedTabs: string[];
}

/**
 * The manifest without document `id`: out of `documents`, every tab's forms and menu items,
 * and with any tab that showed nothing else removed. Throws if that would leave no tabs.
 */
export function removeDocumentFromManifest(text: string, id: string): RemovedDocument {
  const manifest = parseManifest(text);
  const tabs = Array.isArray(manifest.tabs) ? manifest.tabs : [];
  const edits: JsonEdit[] = [];
  const removedTabs: string[] = [];
  // Last first, so each edit's array indexes are still right when it's applied.
  for (let i = tabs.length - 1; i >= 0; i--) {
    const screen = tabs[i]?.screen;
    const at = ['tabs', i, 'screen'];
    const removeTab = () => {
      edits.push({ path: ['tabs', i], remove: true });
      removedTabs.unshift(tabs[i].title ?? tabs[i].id);
    };
    if (screen?.type === 'dashboard' && screen.dashboard === id) removeTab();
    else if (screen?.type === 'forms' && Array.isArray(screen.forms) && screen.forms.includes(id)) {
      if (screen.forms.every((f) => f === id)) removeTab();
      else for (let j = screen.forms.length - 1; j >= 0; j--) if (screen.forms[j] === id) edits.push({ path: [...at, 'forms', j], remove: true });
    } else if (screen?.type === 'menu' && Array.isArray(screen.items))
      for (let j = screen.items.length - 1; j >= 0; j--) {
        const item = screen.items[j];
        if (item?.dashboard === id || item?.form === id) edits.push({ path: [...at, 'items', j], remove: true });
      }
  }
  if (tabs.length && removedTabs.length === tabs.length) throw new Error(`Every tab shows only "${id}". Add another tab first`);
  if (manifest.documents && id in manifest.documents) edits.push({ path: ['documents', id], remove: true });
  return { text: applyJsonEdits(text, edits), removedTabs };
}

/**
 * The manifest with document `from` listed as `to` instead, at `path` (a file) or unchanged
 * (an inline document), and every tab and menu item that showed it updated. `documents` keeps
 * its order.
 */
export function renameDocumentInManifest(text: string, from: string, to: string, path?: string): string {
  const manifest = parseManifest(text);
  if (!manifest.documents || !(from in manifest.documents)) throw new Error(`There’s no document "${from}"`);
  if (to !== from && to in manifest.documents) throw new Error(`There’s already a document "${to}"`);
  const edits: JsonEdit[] = [];
  (Array.isArray(manifest.tabs) ? manifest.tabs : []).forEach((tab, i) => {
    const screen = tab?.screen;
    const at = ['tabs', i, 'screen'];
    if (screen?.type === 'dashboard' && screen.dashboard === from) edits.push({ path: [...at, 'dashboard'], value: to });
    if (screen?.type === 'forms' && Array.isArray(screen.forms))
      screen.forms.forEach((f, j) => f === from && edits.push({ path: [...at, 'forms', j], value: to }));
    if (screen?.type === 'menu' && Array.isArray(screen.items))
      screen.items.forEach((item, j) => {
        if (item?.dashboard === from) edits.push({ path: [...at, 'items', j, 'dashboard'], value: to });
        if (item?.form === from) edits.push({ path: [...at, 'items', j, 'form'], value: to });
      });
  });
  if (path !== undefined) edits.push({ path: ['documents', from], value: path });
  let out = applyJsonEdits(text, edits);
  if (to !== from) {
    // Swap the key's text in place, so the document stays where it was in the list.
    const key = findNodeAtLocation(parseTree(out)!, ['documents', from])?.parent?.children?.[0];
    if (key) out = out.slice(0, key.offset) + JSON.stringify(to) + out.slice(key.offset + key.length);
  }
  return out;
}

export interface MetricChange {
  /** A metric some form recorded before and none does after. */
  metric: string;
  /** Where the same input now records something else: probably a rename. */
  renamedTo?: string;
  /** The form (file) and input title, when it was renamed. */
  file?: string;
  input?: string;
  /** Files whose charts still read the metric after the change, so they stop getting new data. */
  readBy: string[];
}

function parse(text: string | null | undefined): Dashboard | undefined {
  if (!text) return undefined;
  try {
    const d = JSON.parse(text) as Dashboard;
    return d && Array.isArray(d.panels) && d.panels.every((p) => p && typeof p === 'object') ? d : undefined;
  } catch {
    return undefined;
  }
}

/** Input panels by panel id, with the metric each records. */
function inputs(text: string | null | undefined): Map<number, { metric: string; title?: string }> {
  const d = parse(text);
  const out = new Map<number, { metric: string; title?: string }>();
  try {
    if (d) for (const p of inputPanels(d)) if (typeof p.id === 'number' && typeof p.options?.metric === 'string') out.set(p.id, { metric: p.options.metric, title: p.title });
  } catch {
    // A panel too broken to read (no type, say); the file's issues report it.
  }
  return out;
}

/** Whether any panel's queries read `metric`. */
function reads(text: string | null | undefined, metric: string): boolean {
  const d = parse(text);
  const panels = d ? d.panels.flatMap((p) => (p.type === 'row' ? [p, ...(p.panels ?? [])] : [p])) : [];
  return panels.some((p) => (p?.targets ?? []).some((t) => (t as { metric?: unknown }).metric === metric));
}

/**
 * Metrics that forms stop recording when `before` (files as saved) becomes `after` (null for a
 * deleted file; files not in `after` are unchanged). Entries already saved under them stay, but
 * no form adds to them and a renamed input starts a new history.
 */
export function metricChanges(before: Record<string, string>, after: Record<string, string | null>): MetricChange[] {
  const merged = { ...before, ...after };
  const recorded = (files: Record<string, string | null>) => new Set(Object.values(files).flatMap((t) => [...inputs(t).values()].map((i) => i.metric)));
  const was = recorded(before);
  const now = recorded(merged);
  const changes: MetricChange[] = [];
  for (const metric of was) {
    if (now.has(metric)) continue;
    const readBy = Object.keys(merged).filter((file) => reads(merged[file], metric)).sort();
    let rename: MetricChange | undefined;
    for (const [file, text] of Object.entries(after)) {
      const old = inputs(before[file]);
      for (const [id, input] of inputs(text))
        if (old.get(id)?.metric === metric && input.metric !== metric) rename ??= { metric, renamedTo: input.metric, file, input: input.title, readBy };
    }
    changes.push(rename ?? { metric, readBy });
  }
  return changes.sort((a, b) => a.metric.localeCompare(b.metric));
}
