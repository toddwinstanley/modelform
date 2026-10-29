/**
 * Editing an app config as text: parse with positions, check a set of draft files together
 * exactly as the app would load them, point each issue at a spot in its file, and read and
 * write the files where the config is served.
 */
import { applyEdits, findNodeAtLocation, format, parseTree, printParseErrorCode, type Node, type ParseError } from 'jsonc-parser';
import { isInputType } from './inputs';
import { applyJsonEdits } from './jsonEdit';
import { LOCAL_DATASOURCE_TYPE } from './local';
import type { Panel } from './schema';
import { assembleBundle, resolveUrl, type ConfigIssue } from './manifest';

export interface Located {
  /** Character offset and length of the text the issue is about. */
  offset: number;
  length: number;
  /** 1-based. */
  line: number;
  column: number;
}

/** An issue within one file, positioned in that file's text when it can be. */
export interface FileIssue extends Partial<Located> {
  severity: 'error' | 'warning';
  /** Path inside the file, like `tabs[0].screen`, or `(root)`. */
  at: string;
  message: string;
}

const PARSE_MESSAGES: Record<string, string> = {
  InvalidSymbol: 'unexpected character',
  InvalidNumberFormat: 'not a valid number',
  PropertyNameExpected: 'expected a "key" in double quotes',
  ValueExpected: 'expected a value',
  ColonExpected: 'expected a colon',
  CommaExpected: 'expected a comma',
  CloseBraceExpected: 'expected }',
  CloseBracketExpected: 'expected ]',
  EndOfFileExpected: 'unexpected text after the end',
  InvalidCommentToken: 'comments are not allowed',
  UnexpectedEndOfComment: 'comments are not allowed',
  UnexpectedEndOfString: 'unterminated string',
  UnexpectedEndOfNumber: 'unterminated number',
  InvalidUnicode: 'invalid \\u escape',
  InvalidEscapeCharacter: 'invalid escape character',
  InvalidCharacter: 'invalid character in string',
};

export function lineColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let start = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) {
    line++;
    start = i + 1;
  }
  return { line, column: offset - start + 1 };
}

const located = (text: string, offset: number, length: number): Located => ({ offset, length, ...lineColumn(text, offset) });

export interface ParsedText {
  value?: unknown;
  tree?: Node;
  /** Syntax errors; `value` is only set when there are none. */
  errors: FileIssue[];
}

/** Strict JSON (no comments or trailing commas), with positions for syntax errors on every JS engine. */
export function parseJsonText(text: string): ParsedText {
  const raw: ParseError[] = [];
  const tree = parseTree(text, raw, { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false });
  // Only the first: later ones are usually knock-on effects of it.
  const errors: FileIssue[] = raw.slice(0, 1).map((e) => ({
    severity: 'error',
    at: '(root)',
    message: PARSE_MESSAGES[printParseErrorCode(e.error)] ?? printParseErrorCode(e.error),
    ...located(text, e.offset, Math.max(e.length, 1)),
  }));
  if (!tree && !errors.length) errors.push({ severity: 'error', at: '(root)', message: 'the file is empty', ...located(text, 0, 0) });
  if (errors.length) return { tree, errors };
  return { value: JSON.parse(text), tree, errors };
}

/** `tabs[0].screen` → ['tabs', 0, 'screen'] */
export function splitPath(path: string): (string | number)[] {
  if (path === '(root)' || !path) return [];
  const out: (string | number)[] = [];
  for (const m of path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)) out.push(m[2] !== undefined ? Number(m[2]) : m[1]);
  return out;
}

/**
 * Where a path is in the text. Objects and arrays point at their key rather than their whole
 * body; a path that doesn't exist (a missing key) points at its nearest ancestor.
 */
export function locate(text: string, tree: Node | undefined, path: string): Located | undefined {
  if (!tree) return undefined;
  const segs = splitPath(path);
  for (let n = segs.length; n >= 0; n--) {
    const node = findNodeAtLocation(tree, segs.slice(0, n));
    if (!node) continue;
    const key = node.parent?.type === 'property' ? node.parent.children?.[0] : undefined;
    if ((node.type === 'object' || node.type === 'array') && key) return located(text, key.offset, key.length);
    if (node.type === 'object' || node.type === 'array') return located(text, node.offset, 1);
    return located(text, node.offset, node.length);
  }
  return undefined;
}

const NOT_FOUND = 'file not found';
const UNPARSED = '\u0000unparsed';

/**
 * Checks draft files (path → text) the way the app checks a fetched config, and files each
 * issue under the file it's about, positioned in its text. `manifestPath` is the manifest's
 * own key in `files`; documents are keyed by the path the manifest gives them.
 */
export async function checkFiles(files: Record<string, string>, manifestPath: string): Promise<Record<string, FileIssue[]>> {
  const out: Record<string, FileIssue[]> = Object.fromEntries(Object.keys(files).map((p) => [p, []]));
  const parsed = Object.fromEntries(Object.entries(files).map(([p, text]) => [p, parseJsonText(text)]));
  for (const [p, r] of Object.entries(parsed)) out[p].push(...r.errors);
  const manifest = parsed[manifestPath];
  if (!manifest || manifest.errors.length) return out;

  const { issues } = await assembleBundle(
    manifest.value,
    async (path) => {
      if (!(path in files)) throw new Error(NOT_FOUND);
      // Already reported with positions above.
      if (parsed[path].errors.length) throw new Error(UNPARSED);
      return parsed[path].value;
    },
    manifestPath,
  );
  const documents = (manifest.value as { documents?: Record<string, unknown> }).documents ?? {};
  for (const issue of issues) {
    if (issue.message === UNPARSED) continue;
    const { file, at } = splitIssuePath(issue, manifestPath, documents);
    const target = file in out ? file : manifestPath;
    const r = parsed[target];
    out[target].push({ severity: issue.severity, at, message: issue.message, ...locate(files[target], r.tree, at) });
  }
  return out;
}

/** `forms/daily.json: panels[0]` → file and path. A bare document path is a fetch failure: file it under the manifest's reference to it. */
function splitIssuePath(issue: ConfigIssue, manifestPath: string, documents: Record<string, unknown>) {
  const sep = issue.path.indexOf(': ');
  // Inline documents nest: `app.json: documents.x: panels[0]`.
  if (sep !== -1) return { file: issue.path.slice(0, sep), at: issue.path.slice(sep + 2).replaceAll(': ', '.') };
  const id = Object.keys(documents).find((k) => documents[k] === issue.path);
  return { file: manifestPath, at: id ? `documents.${id}` : '(root)' };
}

/** Pretty-prints JSON text with 2-space indents, keeping key order. Text that doesn't parse comes back unchanged. */
export function formatJsonText(text: string): string {
  if (parseJsonText(text).errors.length) return text;
  return applyEdits(text, format(text, undefined, { insertSpaces: true, tabSize: 2, eol: '\n' }));
}

/** Sets a value at a path in JSON text, touching only that spot so the rest keeps its formatting. */
export function setJsonValue(text: string, path: (string | number)[], value: unknown): string {
  return applyJsonEdits(text, [{ path, value }]);
}

/** Panel types an editor offers to add, by what they're for. */
export const PANEL_TYPES = {
  form: ['input-number', 'input-slider', 'input-select', 'input-toggle', 'input-rating', 'input-text', 'input-counter', 'input-duration', 'text', 'row'],
  dashboard: ['timeseries', 'barchart', 'stat', 'gauge', 'bargauge', 'piechart', 'table', 'text', 'row'],
};

/** A panel of `type` to start from. Inputs record to `metric`; charts read it from the local datasource. */
export function newPanel(type: string, metric = 'value'): Panel {
  const title = type === 'row' ? 'Section' : metric.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
  if (type === 'row') return { type, title, gridPos: { x: 0, y: 0, w: 24, h: 1 } };
  if (isInputType(type)) {
    const options: Record<string, unknown> = { metric };
    if (type === 'input-select') options.choices = [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }];
    if (type === 'input-slider') Object.assign(options, { min: 0, max: 10, step: 1 });
    return { type, title, gridPos: { x: 0, y: 0, w: 24, h: 3 }, options };
  }
  if (type === 'text') return { type, title: '', gridPos: { x: 0, y: 0, w: 24, h: 3 }, options: { mode: 'markdown', content: 'Text' } };
  const small = type === 'stat' || type === 'gauge';
  return {
    type,
    title,
    gridPos: { x: 0, y: 0, w: small ? 6 : 24, h: small ? 4 : 8 },
    datasource: { type: LOCAL_DATASOURCE_TYPE },
    targets: [{ refId: 'A', metric, ...(type === 'barchart' && { aggregate: 'sum', bucket: '1d' }) }],
  };
}

/** Starting points for a new document. */
export function newDocument(kind: 'form' | 'dashboard', title: string): string {
  const doc =
    kind === 'form'
      ? {
          title,
          panels: [{ id: 1, type: 'input-number', title: 'Value', gridPos: { x: 0, y: 0, w: 24, h: 3 }, options: { metric: 'value', step: 1 } }],
        }
      : {
          title,
          time: { from: 'now-30d', to: 'now' },
          panels: [
            {
              id: 1,
              type: 'timeseries',
              title: 'Value',
              gridPos: { x: 0, y: 0, w: 24, h: 8 },
              datasource: { type: 'dashkit-local' },
              targets: [{ refId: 'A', metric: 'value' }],
            },
          ],
        };
  return JSON.stringify(doc, null, 2) + '\n';
}

/** Where a config's files are read from and saved to, by path relative to the manifest. */
export interface ConfigFiles {
  /** The manifest's own path, e.g. "app.json". */
  readonly manifestPath: string;
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
}

/**
 * Files served over HTTP next to the manifest: GET to read, PUT to save. The dev config
 * server (tools/config-server.mjs) speaks this; so should the config backend.
 */
export class HttpConfigFiles implements ConfigFiles {
  readonly manifestPath: string;

  constructor(
    private manifestUrl: string,
    private token?: string,
  ) {
    this.manifestPath = manifestUrl.replace(/[?#].*$/, '').split('/').pop() || 'app.json';
  }

  private headers(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  async read(path: string) {
    const res = await fetch(resolveUrl(this.manifestUrl, path), { headers: this.headers(), cache: 'no-store' });
    if (!res.ok) throw new Error(res.status === 404 ? NOT_FOUND : `HTTP ${res.status}`);
    return res.text();
  }

  async write(path: string, text: string) {
    const res = await fetch(resolveUrl(this.manifestUrl, path), {
      method: 'PUT',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: text,
    });
    if (!res.ok) throw new Error(`Couldn’t save ${path}: ${(await res.text()) || `HTTP ${res.status}`}`);
  }
}

/** Reads the manifest and every document it gives a path for. Files that can't be read are left out (checkFiles then reports them). */
export async function readConfigFiles(source: ConfigFiles): Promise<Record<string, string>> {
  const files: Record<string, string> = { [source.manifestPath]: await source.read(source.manifestPath) };
  const { value } = parseJsonText(files[source.manifestPath]);
  const documents = (value as { documents?: Record<string, unknown> } | undefined)?.documents ?? {};
  const paths = [...new Set(Object.values(documents).filter((d): d is string => typeof d === 'string'))];
  await Promise.all(
    paths.map(async (p) => {
      try {
        files[p] = await source.read(p);
      } catch {}
    }),
  );
  return files;
}
