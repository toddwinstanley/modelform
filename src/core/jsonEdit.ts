/**
 * Small edits to JSON text that keep its formatting: change a value, add or remove a key or
 * array element, everything else untouched. New values are written in the style config files
 * use, with short objects like gridPos on one line.
 */
import { applyEdits, findNodeAtLocation, modify, parseTree, type JSONPath, type Node } from 'jsonc-parser';

export type { JSONPath };

export interface JsonEdit {
  path: JSONPath;
  /** Set (or add) this value. Ignored when `remove` is set. */
  value?: unknown;
  /** Remove the key or array element at `path`. */
  remove?: boolean;
  /** `path` ends in an array index: insert there instead of replacing. */
  insert?: boolean;
}

/** Lines longer than this are broken up. */
const MAX_LINE = 100;
const FORMAT = { insertSpaces: true, tabSize: 2, eol: '\n' };
const PLACEHOLDER = '\u0000dashkit-placeholder\u0000';

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * JSON with short objects and arrays on one line (`{ "x": 0, "y": 0 }`) and longer ones
 * broken up, `indent` spaces in.
 */
export function stringifyCompact(value: unknown, indent = 0): string {
  if (!isPlainObject(value) && !Array.isArray(value)) return JSON.stringify(value) ?? 'null';
  const array = Array.isArray(value);
  const entries: [string | null, unknown][] = array ? value.map((v) => [null, v]) : Object.entries(value).filter(([, v]) => v !== undefined);
  if (!entries.length) return array ? '[]' : '{}';
  const item = (k: string | null, v: unknown, at: number) => (k === null ? '' : `${JSON.stringify(k)}: `) + stringifyCompact(v, at);
  const one = entries.map(([k, v]) => item(k, v, indent));
  const inline = array ? `[${one.join(', ')}]` : `{ ${one.join(', ')} }`;
  if (!inline.includes('\n') && indent + inline.length <= MAX_LINE) return inline;
  const pad = ' '.repeat(indent + 2);
  const lines = entries.map(([k, v]) => pad + item(k, v, indent + 2));
  return `${array ? '[' : '{'}\n${lines.join(',\n')}\n${' '.repeat(indent)}${array ? ']' : '}'}`;
}

/** Removes a property or array element along with the comma that separates it from a neighbour. */
function removeNode(text: string, path: JSONPath): string {
  const tree = parseTree(text);
  const value = tree && findNodeAtLocation(tree, path);
  if (!value) return text;
  const node: Node = value.parent?.type === 'property' ? value.parent : value;
  const siblings = node.parent?.children ?? [];
  const i = siblings.indexOf(node);
  const next = siblings[i + 1];
  const prev = siblings[i - 1];
  if (next) return text.slice(0, node.offset) + text.slice(next.offset);
  if (prev) return text.slice(0, prev.offset + prev.length) + text.slice(node.offset + node.length);
  // The only member: leave the braces, drop what's between them.
  const container = node.parent!;
  return text.slice(0, container.offset + 1) + text.slice(container.offset + container.length - 1);
}

/** Applies edits in order. Text that doesn't parse is returned unchanged. */
export function applyJsonEdits(text: string, edits: JsonEdit[]): string {
  if (!parseTree(text)) return text;
  for (const edit of edits) {
    if (edit.remove) {
      text = removeNode(text, edit.path);
      continue;
    }
    // Let jsonc-parser place a placeholder (commas, new keys, indentation), then swap in the value.
    text = applyEdits(text, modify(text, edit.path, PLACEHOLDER, { formattingOptions: FORMAT, isArrayInsertion: edit.insert }));
    const quoted = JSON.stringify(PLACEHOLDER);
    const at = text.indexOf(quoted);
    if (at === -1) continue;
    const lineStart = text.lastIndexOf('\n', at) + 1;
    const indent = text.slice(lineStart).match(/^ */)![0].length;
    text = text.slice(0, at) + stringifyCompact(edit.value, indent) + text.slice(at + quoted.length);
  }
  return text;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

/**
 * The smallest edits that turn `before` into `after`: changed leaves are set, keys added or
 * removed, and arrays that changed length are replaced whole (except where the caller
 * handles them, as diffPanels does).
 */
export function diffJson(before: unknown, after: unknown, path: JSONPath = []): JsonEdit[] {
  if (deepEqual(before, after)) return [];
  if (isPlainObject(before) && isPlainObject(after)) {
    const edits: JsonEdit[] = [];
    for (const k of Object.keys(before)) if (before[k] !== undefined && after[k] === undefined) edits.push({ path: [...path, k], remove: true });
    for (const k of Object.keys(after)) if (after[k] !== undefined) edits.push(...diffJson(before[k], after[k], [...path, k]));
    return edits;
  }
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) return before.flatMap((v, i) => diffJson(v, after[i], [...path, i]));
  return [{ path, value: after }];
}
