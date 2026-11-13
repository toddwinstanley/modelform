/**
 * Panel snippets: panels lifted out of one dashboard to drop into another, with what they
 * depend on (the variables they use, the metrics they record or read). Copy and paste goes
 * through them, and templates are snippets with a title, whose metrics and variables are the
 * parameters filled in when one is used.
 *
 *   { "$modelform": "panels", "version": 1, "kind": "dashboard",
 *     "panels": [...], "variables": [...], "metrics": ["weight"] }
 *
 * Panels carry no ids, and their gridPos is relative to the top left of the copied block.
 */
import { renameVariableInPanels } from './dashboardSettings';
import { isInputType } from './inputs';
import { GRID_COLUMNS, isRow } from './layout';
import { nextPanelId, readingOrder, settleLayout } from './layoutEdit';
import type { Dashboard, GridPos, Panel, TemplateVariable } from './schema';
import { variableReferences } from './variables';

export const SNIPPET_VERSION = 1;

export interface PanelSnippet {
  $modelform: 'panels';
  version: number;
  /** "form" when any panel is an input, which only forms can show. */
  kind: 'form' | 'dashboard';
  /** Top-level panels. A row brings its panels: inside it when collapsed, after it when not. */
  panels: Panel[];
  /** The dashboard variables the panels use, and the variables those use. */
  variables: TemplateVariable[];
  /** Every metric the panels record (inputs) or read (local queries). */
  metrics: string[];
}

const DEFAULT_POS: GridPos = { x: 0, y: 0, w: GRID_COLUMNS, h: 4 };
const pos = (p: Panel): GridPos => ({ ...DEFAULT_POS, ...p.gridPos });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const refers = (name: string) => new RegExp(`\\$${name}\\b|\\$\\{${name}(:\\w+)?\\}|\\[\\[${name}(:\\w+)?\\]\\]`);

/** A panel and, for a collapsed row, the panels inside it. */
const withChildren = (p: Panel): Panel[] => [p, ...(isRow(p) ? (p.panels ?? []) : [])];

/** The metrics a panel records or reads, leaving out ones taken from a variable ($metric). */
function panelMetrics(p: Panel): string[] {
  const found: string[] = [];
  if (isInputType(p.type) && typeof p.options?.metric === 'string') found.push(p.options.metric);
  for (const t of p.targets ?? []) if (typeof t.metric === 'string' && t.metric && !t.metric.startsWith('$')) found.push(t.metric);
  return found;
}

/** `panels` with every recorded or read metric renamed per `map`. */
function renameMetrics(panels: Panel[], map: Record<string, string>): Panel[] {
  const rename = (p: Panel): Panel => {
    let out = p;
    if (isInputType(p.type) && typeof p.options?.metric === 'string' && map[p.options.metric]) out = { ...out, options: { ...out.options, metric: map[p.options.metric] } };
    if (p.targets?.some((t) => typeof t.metric === 'string' && map[t.metric])) out = { ...out, targets: p.targets.map((t) => (typeof t.metric === 'string' && map[t.metric] ? { ...t, metric: map[t.metric] } : t)) };
    if (p.panels?.length) out = { ...out, panels: p.panels.map(rename) };
    return out;
  };
  return panels.map(rename);
}

/**
 * The top-level panels at `indices` as a snippet. A row brings the panels under it, down to the
 * next row; a collapsed row already holds them. Ids go, positions become relative to the block.
 */
export function copyPanels(dashboard: Dashboard, indices: number[]): PanelSnippet {
  const panels = dashboard.panels ?? [];
  const order = readingOrder(panels);
  const picked = new Set<number>();
  for (const i of indices) {
    if (!panels[i]) continue;
    picked.add(i);
    if (isRow(panels[i]) && !panels[i].collapsed) {
      for (const j of order.slice(order.indexOf(i) + 1)) {
        if (isRow(panels[j])) break;
        picked.add(j);
      }
    }
  }
  const chosen = order.filter((i) => picked.has(i)).map((i) => panels[i]);
  return snippetOf(chosen, dashboard.templating?.list ?? []);
}

/** A snippet of `panels`, taking from `available` the variables they use. */
function snippetOf(panels: Panel[], available: TemplateVariable[]): PanelSnippet {
  const left = Math.min(...panels.map((p) => pos(p).x));
  const top = Math.min(...panels.map((p) => pos(p).y));
  const shift = (p: Panel): Panel => {
    const { id: _, ...rest } = p;
    const g = pos(p);
    return { ...rest, gridPos: { ...g, x: g.x - (isRow(p) ? 0 : left), y: g.y - top }, ...(p.panels && { panels: p.panels.map(shift) }) };
  };
  const out = panels.map(shift);

  const text = JSON.stringify(panels);
  const names = available.map((v) => v.name);
  const used = new Set(names.filter((n) => panels.some((p) => withChildren(p).some((c) => c.repeat === n)) || refers(n).test(text)));
  // Variables can use other variables; bring those too.
  for (let grew = true; grew; ) {
    grew = false;
    for (const v of available) {
      if (!used.has(v.name)) continue;
      for (const r of variableReferences(v, names)) {
        if (used.has(r)) continue;
        used.add(r);
        grew = true;
      }
    }
  }
  const all = panels.flatMap(withChildren);
  return {
    $modelform: 'panels',
    version: SNIPPET_VERSION,
    kind: all.some((p) => isInputType(p.type)) ? 'form' : 'dashboard',
    panels: out,
    variables: available.filter((v) => used.has(v.name)),
    metrics: [...new Set(all.flatMap(panelMetrics))],
  };
}

const looksLikePanel = (v: unknown): v is Panel => isObject(v) && typeof v.type === 'string';

/**
 * Reads clipboard text as a snippet: a snippet itself, one Grafana panel, an array of panels, or
 * a whole dashboard (its panels and variables). Positions, ids, variables and metrics are worked
 * out again from the panels, so hand-edited or foreign JSON comes out consistent.
 */
export function parseSnippet(text: string): { snippet: PanelSnippet } | { error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { error: 'That isn’t JSON' };
  }
  let panels: unknown[];
  let variables: unknown[] = [];
  if (isObject(json) && json.$modelform === 'panels') {
    if (typeof json.version !== 'number' || json.version > SNIPPET_VERSION) return { error: 'Those panels come from a newer version of modelform' };
    if (!Array.isArray(json.panels)) return { error: 'The copied panels are missing their panels' };
    panels = json.panels;
    variables = Array.isArray(json.variables) ? json.variables : [];
  } else if (Array.isArray(json)) panels = json;
  else if (isObject(json) && Array.isArray(json.panels) && !looksLikePanel(json)) {
    panels = json.panels;
    const templating = json.templating;
    variables = isObject(templating) && Array.isArray(templating.list) ? templating.list : [];
  } else if (looksLikePanel(json)) panels = [json];
  else return { error: 'That isn’t a panel, a list of panels or a dashboard' };

  const usable = panels.filter(looksLikePanel);
  if (!usable.length) return { error: 'There are no panels in it' };
  const vars = variables.filter((v): v is TemplateVariable => isObject(v) && typeof v.name === 'string' && typeof v.type === 'string');
  return { snippet: snippetOf(usable, vars) };
}

export interface PasteOptions {
  /** Put the block under this top-level panel; otherwise at the bottom. */
  after?: number | null;
  /** Metrics to rename on the way in, e.g. { weight: 'body-weight' }. */
  metrics?: Record<string, string>;
  /** What's being pasted into. Inputs only go into forms. Defaults to a form if it has inputs. */
  kind?: 'form' | 'dashboard';
}

export interface PasteResult {
  panels: Panel[];
  /** The dashboard's variables after the paste. */
  variables: TemplateVariable[];
  /** Index in `panels` of the first pasted panel; the rest follow it. */
  index: number;
  /** How many top-level panels were pasted. */
  count: number;
  /** Variables the dashboard didn't have, by name as added. */
  added: string[];
  /** Variables added under a new name because the dashboard has a different one of the same name. */
  renamed: Record<string, string>;
  /** Titles of panels left out: inputs going into a dashboard. */
  skipped: string[];
}

/** JSON with keys sorted at every level, so equal values compare equal however they were written. */
const stable = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(stable).join(',')}]` : isObject(v) ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v);

/** Two variables are the same if they match in everything but what's selected and the options last seen. */
const sameVariable = (a: TemplateVariable, b: TemplateVariable) => {
  const strip = ({ current: _, options: __, ...rest }: TemplateVariable) => stable(rest);
  return strip(a) === strip(b);
};

/** What a paste would add and rename, without doing it: for asking first. */
export function previewPaste(dashboard: Dashboard, snippet: PanelSnippet): { added: string[]; renamed: Record<string, string> } {
  const { added, renamed } = mergeVariables(dashboard.templating?.list ?? [], snippet.variables);
  return { added, renamed };
}

function mergeVariables(existing: TemplateVariable[], incoming: TemplateVariable[]) {
  const taken = new Set(existing.map((v) => v.name));
  const added: string[] = [];
  const renamed: Record<string, string> = {};
  const out = [...existing];
  for (const v of incoming) {
    const same = existing.find((e) => e.name === v.name);
    if (same && sameVariable(same, v)) continue;
    let name = v.name;
    if (same) {
      let n = 2;
      while (taken.has(`${v.name}_${n}`)) n++;
      name = `${v.name}_${n}`;
      renamed[v.name] = name;
    }
    taken.add(name);
    added.push(name);
    out.push({ ...v, name });
  }
  // A renamed variable may be used by another one being added. renameVariableInPanels walks any JSON.
  const follow = (v: TemplateVariable) =>
    Object.entries(renamed).reduce((acc, [from, to]) => renameVariableInPanels([acc as unknown as Panel], from, to)[0] as unknown as TemplateVariable, v);
  return { variables: out.map((v, i) => (i < existing.length ? v : follow(v))), added, renamed };
}

/**
 * Drops a snippet into a dashboard: fresh ids, metrics renamed per `options.metrics`, variables
 * added (or added under a new name where one of the same name differs), and the block placed as
 * a unit under `options.after` or at the bottom, with the panels below moving down. Pasted
 * panels go at the end of the panels array, so the rest of the file stays as it is.
 */
export function pasteSnippet(dashboard: Dashboard, snippet: PanelSnippet, options: PasteOptions = {}): PasteResult {
  const existing = dashboard.panels ?? [];
  const kind = options.kind ?? (existing.flatMap(withChildren).some((p) => isInputType(p.type)) ? 'form' : 'dashboard');
  const skipped: string[] = [];
  const keep = (p: Panel) => {
    if (kind === 'dashboard' && isInputType(p.type)) {
      skipped.push(p.title || p.type);
      return false;
    }
    return true;
  };
  let incoming = snippet.panels.filter(keep).map((p) => (p.panels ? { ...p, panels: p.panels.filter(keep) } : p));

  const { variables, added, renamed } = mergeVariables(dashboard.templating?.list ?? [], snippet.variables);
  for (const [from, to] of Object.entries(renamed)) incoming = renameVariableInPanels(incoming, from, to);
  if (options.metrics) incoming = renameMetrics(incoming, options.metrics);

  const after = options.after != null ? existing[options.after] : undefined;
  const top = after ? pos(after).y + pos(after).h : Math.max(0, ...existing.map((p) => pos(p).y + pos(p).h));
  let id = nextPanelId(existing);
  const place = (p: Panel): Panel => ({ ...p, id: id++, gridPos: { ...pos(p), y: pos(p).y + top }, ...(p.panels && { panels: p.panels.map(place) }) });
  const pasted = incoming.map(place);

  const index = existing.length;
  const all = [...existing, ...pasted];
  return {
    panels: settleLayout(all, pasted.map((_, i) => index + i)),
    variables,
    index,
    count: pasted.length,
    added,
    renamed,
    skipped,
  };
}
