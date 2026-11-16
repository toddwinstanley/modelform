/**
 * Prompts for making templates, or changing a form or dashboard, with an AI assistant the user
 * already has (Claude, ChatGPT…), and reading its answer back. Nothing here calls a model: an app copies the prompt for the
 * user to paste, and the user pastes the answer back.
 */
import { prepareDashboard } from './manifest';
import { screenDocuments } from './navigation';
import type { Dashboard, DocumentKind, Panel } from './schema';
import { parseTemplate, type AppTemplate } from './templates';

/** How to write forms and dashboards, for an assistant: the part of the guide that applies to one document. */
export const DOCUMENT_GUIDE = `## Documents

A document is a subset of Grafana's dashboard JSON: \`{ "kind": "form" | "dashboard", "title": "…", "panels": [ … ] }\`, and dashboards add \`"time": { "from": "now-30d", "to": "now" }\`.

Every panel has an \`id\` (a number, unique in its document), a \`type\`, a \`title\`, and a \`gridPos\` \`{ "x", "y", "w", "h" }\` on a 24-column grid: \`w: 24\` is full width, \`w: 12\` half. Stack panels top to bottom with no gaps or overlaps (each \`y\` is the previous \`y + h\` unless they sit side by side). On phones panels show full width in that order.

A \`"row"\` panel (\`h: 1\`, no options) is a section heading for the panels under it, in forms and dashboards.

## Forms

Forms hold input panels. Each records to a \`metric\` (lowercase words joined with dashes, e.g. \`"body-weight"\`), and charts read entries by that metric. Two inputs never share a metric. Use \`h: 3\` for inputs.

| type | what | options besides metric |
|---|---|---|
| input-number | a number typed or stepped with + and − | unit, step, min, max |
| input-slider | a value dragged along a range | min, max, step, unit, labels (text spread along the track) |
| input-select | one of a set of choices | choices: [{ "label", "value" }], multi (allow several) |
| input-toggle | yes or no (records 1 or 0) | |
| input-rating | a score, e.g. 1 to 5 | min, max |
| input-text | free text | placeholder, suggest (offer earlier values) |
| input-counter | taps that add up, e.g. glasses of water | increment, unit |
| input-duration | a length of time, recorded in seconds | placeholder |

Any input (not counter) can also take \`required: true\`, \`default\` (a value, or \`"last"\` for the last one saved), and \`record: "always"\` to record its value on every save even when it wasn't changed.

\`input-group\` repeats fields once per item, for things like the sets of a workout or the dishes of a meal. Give it \`h: 12\` and options \`{ "itemTitle": "Set", "titleFrom": "<a field's metric>", "start": 1 | "last", "min", "max", "fields": [ { "type": "input-…", "title", "span": 1–24, "options": { "metric", … } } ] }\`. Fields can be any input but input-counter.

## Dashboards

Chart panels read the app's entries with \`"datasource": { "type": "modelform-local" }\` and \`"targets": [ { "refId": "A", "metric": "…" } ]\` (refIds A, B, C… for more series). A target can also have:

- \`aggregate\`: "sum", "avg", "min", "max", "count" or "last", with \`bucket\`: "1h", "1d", "1w" or "1M". Without them each entry is a point.
- \`groupBy\`: "text" for one series per text or choice value; \`{ "field": "<metric>" }\` for one series per value of another input saved at the same time (in an input-group, of the same item, e.g. weight per exercise).
- \`alias\`: the series name. \`fillZero: false\` leaves empty buckets out.

| type | use for | h |
|---|---|---|
| timeseries | values over time | 7–8 |
| barchart | totals per day, week or category | 7–8 |
| stat | one big number; \`"options": { "reduceOptions": { "calcs": ["lastNotNull" or "mean" or "sum"] } }\` | 4 |
| gauge, bargauge | a value against a range (set min and max) | 5–6 |
| piechart | how a total splits, e.g. by choice with groupBy "text" and aggregate "count" | 8 |
| table | rows of values | 8 |
| text | markdown notes: \`"options": { "content": "…" }\`, no targets | 3–4 |

Units and ranges go in \`"fieldConfig": { "defaults": { "unit": "…", "min", "max", "decimals" } }\`. Units are Grafana's, e.g. "percent", "masskg", "lengthkm", "s", or "suffix: <text>" for anything else (\`"suffix: glasses"\`). Don't use trend, xychart or geomap panels.

Charts can't do arithmetic across metrics (weight × reps, a ratio of two inputs). Chart what's recorded instead, or add an input for the combined value, and say which you did in the sentence before the JSON.

`;

/** How to write a modelform template, for an assistant. Kept next to the format so they change together. */
export const AUTHORING_GUIDE = `# modelform templates

A template is JSON that adds forms (for recording entries) and dashboards (for charting them) to an app, plus tabs to show them.

\`\`\`
{
  "$modelform": "template",
  "version": 1,
  "title": "Short name",
  "description": "One sentence on what it's for.",
  "documents": [ { "kind": "form" | "dashboard", "id": "letters-digits-dashes", "dashboard": { ...document } } ],
  "tabs": [ ...tabs ]
}
\`\`\`

Each document's \`kind\` matches its entry in \`documents\`.

${DOCUMENT_GUIDE}## Tabs

\`{ "id": "…", "title": "…", "icon": "…", "screen": … }\`, where the screen is one of:

- \`{ "type": "forms", "forms": ["<form id>", …] }\`
- \`{ "type": "dashboard", "dashboard": "<dashboard id>" }\`
- \`{ "type": "menu", "items": [ { "form": "<id>" } or { "dashboard": "<id>", "description": "…" } ] }\`

Usually one tab for the forms and one per dashboard.
`;

/** A small, complete template: how an answer should look. */
const EXAMPLE: AppTemplate = {
  $modelform: 'template',
  version: 1,
  title: 'Water and sleep',
  description: 'Count glasses of water and log sleep, and see both by day.',
  documents: [
    {
      kind: 'form',
      id: 'today',
      dashboard: {
        kind: 'form',
        title: 'Today',
        panels: [
          { id: 1, type: 'input-counter', title: 'Water', gridPos: { x: 0, y: 0, w: 24, h: 3 }, options: { metric: 'water', unit: 'glasses' } },
          { id: 2, type: 'input-duration', title: 'Sleep', gridPos: { x: 0, y: 3, w: 12, h: 3 }, options: { metric: 'sleep' } },
          { id: 3, type: 'input-rating', title: 'Sleep quality', gridPos: { x: 12, y: 3, w: 12, h: 3 }, options: { metric: 'sleep-quality', min: 1, max: 5 } },
        ],
      },
    },
    {
      kind: 'dashboard',
      id: 'by-day',
      dashboard: {
        kind: 'dashboard',
        title: 'By day',
        time: { from: 'now-30d', to: 'now' },
        panels: [
          {
            id: 1,
            type: 'stat',
            title: 'Average sleep',
            gridPos: { x: 0, y: 0, w: 12, h: 4 },
            datasource: { type: 'modelform-local' },
            targets: [{ refId: 'A', metric: 'sleep' }],
            fieldConfig: { defaults: { unit: 's' } },
            options: { reduceOptions: { calcs: ['mean'] } },
          },
          {
            id: 2,
            type: 'stat',
            title: 'Water today',
            gridPos: { x: 12, y: 0, w: 12, h: 4 },
            datasource: { type: 'modelform-local' },
            targets: [{ refId: 'A', metric: 'water', aggregate: 'sum', bucket: '1d' }],
            fieldConfig: { defaults: { unit: 'suffix: glasses', decimals: 0 } },
            options: { reduceOptions: { calcs: ['lastNotNull'] } },
          },
          {
            id: 3,
            type: 'barchart',
            title: 'Water per day',
            gridPos: { x: 0, y: 4, w: 24, h: 7 },
            datasource: { type: 'modelform-local' },
            targets: [{ refId: 'A', metric: 'water', alias: 'Glasses', aggregate: 'sum', bucket: '1d' }],
            fieldConfig: { defaults: { min: 0, decimals: 0 } },
          },
          {
            id: 4,
            type: 'timeseries',
            title: 'Sleep quality',
            gridPos: { x: 0, y: 11, w: 24, h: 7 },
            datasource: { type: 'modelform-local' },
            targets: [{ refId: 'A', metric: 'sleep-quality', alias: 'Quality', aggregate: 'avg', bucket: '1d', fillZero: false }],
            fieldConfig: { defaults: { min: 1, max: 5 } },
          },
        ],
      },
    },
  ],
  tabs: [
    { id: 'today', title: 'Today', icon: 'edit', screen: { type: 'forms', forms: ['today'] } },
    { id: 'by-day', title: 'By day', icon: 'chart', screen: { type: 'dashboard', dashboard: 'by-day' } },
  ],
  metrics: ['water', 'sleep', 'sleep-quality'],
};

/** The example the guide ends with, for tests and editors. */
export const EXAMPLE_TEMPLATE: AppTemplate = EXAMPLE;

export interface PromptContext {
  /** Metrics the app already records, so new charts can read them and new forms don't clash with them. */
  recorded?: string[];
  /** Icon names tabs can use. */
  icons?: string[];
}

/**
 * A prompt asking an assistant for a template that does what `request` describes, with the
 * guide, an example, and what the app already has.
 */
export function templatePrompt(request: string, { recorded = [], icons = [] }: PromptContext = {}): string {
  const context = [
    recorded.length
      ? `The app already records these metrics: ${recorded.map((m) => `\`${m}\``).join(', ')}. Charts can read them. A new form should only record one of them if it's for the same thing; otherwise pick new names.`
      : 'The app doesn’t record anything yet.',
    icons.length ? `Tab icons can be: ${icons.map((i) => `\`${i}\``).join(', ')}.` : '',
  ].filter(Boolean);
  return [
    'I’m building an app with modelform studio. Make me a modelform template for this:',
    '',
    request.trim().replace(/^/gm, '> '),
    '',
    ...context,
    '',
    'Reply with the template as one ```json code block. A sentence before it is fine; nothing after it.',
    '',
    AUTHORING_GUIDE,
    '## Example',
    '',
    '```json',
    JSON.stringify(EXAMPLE),
    '```',
  ].join('\n');
}

/** The JSON in an assistant's reply: its last ```json block that parses, else the outermost braces. */
export function jsonFromAnswer(text: string): unknown {
  const blocks = [...text.matchAll(/```(?:json|JSON)?[ \t]*\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) blocks.push(text.slice(start, end + 1));
  for (const block of blocks.reverse()) {
    try {
      return JSON.parse(block);
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error('There’s no JSON in that answer');
}

/**
 * Reads a template out of an assistant's reply. Warnings are things that were dropped or look
 * wrong but don't stop it being used, worth sending back with fixTemplatePrompt.
 */
export function readTemplateAnswer(text: string): { template: AppTemplate; warnings: string[] } | { error: string } {
  let json: unknown;
  try {
    json = jsonFromAnswer(text);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const parsed = parseTemplate(JSON.stringify(json));
  if ('error' in parsed) return parsed;
  const { template } = parsed;
  const raw = json as { documents: { id: string; dashboard: unknown }[]; tabs?: unknown };
  const warnings = raw.documents.flatMap((d) =>
    prepareDashboard(d.dashboard, d.id)
      .issues.filter((i) => i.severity === 'warning')
      .map((i) => `${i.path}: ${i.message}`),
  );
  // parseTemplate leaves out tabs it can't read or that show something outside the template.
  const kept = new Set(template.tabs.map((t) => t.id));
  for (const [i, tab] of (Array.isArray(raw.tabs) ? raw.tabs : []).entries()) {
    const id = (tab as { id?: unknown })?.id;
    if (typeof id !== 'string' || !kept.has(id)) warnings.push(`tabs[${i}] was left out: it needs an id, a title and a screen showing only this template’s documents`);
  }
  const kinds = new Map(template.documents.map((d) => [d.id, d.kind]));
  for (const tab of template.tabs)
    for (const ref of screenDocuments(tab.screen)) {
      const kind = kinds.get(ref.id);
      if (kind && kind !== ref.kind) warnings.push(`tab "${tab.id}" shows "${ref.id}" as a ${ref.kind}, but it’s a ${kind}`);
    }
  return { template, warnings };
}

/** A follow-up asking the assistant to fix what was wrong with its template. */
export function fixTemplatePrompt(problems: string[]): string {
  return [
    'modelform couldn’t use that template as it was:',
    '',
    ...problems.map((p) => `- ${p}`),
    '',
    'Fix these and reply with the whole corrected template as one ```json code block.',
  ].join('\n');
}

export interface DocumentPromptContext {
  /** Metrics the app records, so charts can read them and new inputs don't clash with them. */
  recorded?: string[];
}

/** A prompt asking an assistant to change `document` as `request` says and send the whole document back. */
export function documentPrompt(request: string, document: Dashboard, { recorded = [] }: DocumentPromptContext = {}): string {
  const kind = document.kind ?? 'dashboard';
  return [
    `I’m building an app with modelform studio. Change this ${kind} for me:`,
    '',
    request.trim().replace(/^/gm, '> '),
    '',
    recorded.length ? `The app records these metrics: ${recorded.map((m) => `\`${m}\``).join(', ')}. Charts can read any of them.` : '',
    'Keep the ids of panels you keep and give new panels ids not used yet. Don’t change an existing input’s metric unless I asked: entries saved under the old name would stop showing up.',
    `Keep \`"kind": "${kind}"\`. Reply with the whole changed ${kind} as one \`\`\`json code block, not just the parts that changed. A sentence before it is fine; nothing after it.`,
    '',
    `## The ${kind} now`,
    '',
    '```json',
    JSON.stringify(document, null, 2),
    '```',
    '',
    DOCUMENT_GUIDE,
  ]
    .filter((line, i, all) => line !== '' || all[i - 1] !== '')
    .join('\n');
}

/**
 * Reads a changed document out of an assistant's reply: a document, or a template holding just
 * one. It must be the same kind as the one asked about. Warnings are values that will be ignored.
 */
export function readDocumentAnswer(text: string, kind: DocumentKind): { document: Dashboard; warnings: string[] } | { error: string } {
  let json: unknown;
  try {
    json = jsonFromAnswer(text);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const wrapper = json as { $modelform?: unknown; documents?: { dashboard?: unknown }[] };
  if (wrapper?.$modelform === 'template') {
    if (!Array.isArray(wrapper.documents) || wrapper.documents.length !== 1) return { error: `That’s a template, not one ${kind}` };
    json = wrapper.documents[0]?.dashboard;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { error: `That isn’t a ${kind}` };
  const raw = json as Record<string, unknown>;
  if (raw.kind !== undefined && raw.kind !== kind) return { error: `That’s a ${String(raw.kind)}, not a ${kind}` };
  const { dashboard, issues } = prepareDashboard(raw, kind);
  if (!dashboard) return { error: issues.filter((i) => i.severity === 'error').map((i) => `${i.path}: ${i.message}`).join('; ') || `That isn’t a ${kind}` };
  const document = { kind, ...raw } as unknown as Dashboard;
  return { document, warnings: issues.filter((i) => i.severity === 'warning').map((i) => `${i.path}: ${i.message}`) };
}

/** A follow-up asking the assistant to fix what was wrong with the form or dashboard it sent. */
export function fixDocumentPrompt(problems: string[], kind: DocumentKind): string {
  return [
    `modelform couldn’t use that ${kind} as it was:`,
    '',
    ...problems.map((p) => `- ${p}`),
    '',
    `Fix these and reply with the whole corrected ${kind} as one \`\`\`json code block.`,
  ].join('\n');
}

export interface PanelChange {
  change: 'added' | 'removed' | 'changed';
  id: number;
  title: string;
  type: string;
  /** For a changed panel, what changed: "title", "type", "position", "size", "options", "queries", "field config", "other". */
  what: string[];
}

export interface DocumentChanges {
  /** Settings of the document itself that changed, e.g. "title", "time range". */
  document: string[];
  panels: PanelChange[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const flat = (d: Dashboard) => (d.panels ?? []).flatMap((p) => (p.type === 'row' && p.panels ? [p, ...p.panels] : [p]));

/** What changing `before` into `after` does, panel by panel (matched by id), for a person to check. */
export function documentChanges(before: Dashboard, after: Dashboard): DocumentChanges {
  const labels: [keyof Dashboard, string][] = [['kind', 'kind'], ['title', 'title'], ['description', 'description'], ['time', 'time range'], ['templating', 'variables'], ['timezone', 'time zone'], ['refresh', 'refresh']];
  const document = labels.filter(([key]) => !same(before[key], after[key])).map(([, label]) => label);
  const old = new Map(flat(before).map((p) => [p.id, p]));
  const now = new Map(flat(after).map((p) => [p.id, p]));
  const info = (p: Panel) => ({ id: p.id!, title: p.title || p.type, type: p.type });
  const panels: PanelChange[] = [];
  for (const p of flat(after)) {
    const was = old.get(p.id);
    if (!was) {
      panels.push({ change: 'added', ...info(p), what: [] });
      continue;
    }
    const what: string[] = [];
    if (was.title !== p.title) what.push('title');
    if (was.type !== p.type) what.push('type');
    if (was.gridPos?.x !== p.gridPos?.x || was.gridPos?.y !== p.gridPos?.y) what.push('position');
    if (was.gridPos?.w !== p.gridPos?.w || was.gridPos?.h !== p.gridPos?.h) what.push('size');
    if (!same(was.options, p.options)) what.push('options');
    if (!same(was.targets, p.targets) || !same(was.datasource, p.datasource) || !same(was.transformations, p.transformations)) what.push('queries');
    if (!same(was.fieldConfig, p.fieldConfig)) what.push('field config');
    const known = new Set(['id', 'title', 'type', 'gridPos', 'options', 'targets', 'datasource', 'transformations', 'fieldConfig', 'panels']);
    const rest = (q: Panel) => Object.fromEntries(Object.entries(q).filter(([k]) => !known.has(k)).sort(([a], [b]) => a.localeCompare(b)));
    if (!same(rest(was), rest(p))) what.push('other');
    if (what.length) panels.push({ change: 'changed', ...info(p), what });
  }
  for (const p of flat(before)) if (!now.has(p.id)) panels.push({ change: 'removed', ...info(p), what: [] });
  return { document, panels };
}
