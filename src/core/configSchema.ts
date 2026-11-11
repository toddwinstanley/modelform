/**
 * JSON Schema checks for app configs, from schemas generated off modelform's own types
 * (tools/schema.js). Editors use the same schemas for completions and inline errors.
 */
import appSchemaJson from '../../schema/app.schema.json';
import dashboardSchemaJson from '../../schema/dashboard.schema.json';
import { validateApp, validateDashboard, type SchemaError, type Validator } from './generated/validators';

export const appSchema: object = appSchemaJson;
export const dashboardSchema: object = dashboardSchemaJson;

export interface SchemaIssue {
  /** Like `tabs[0].screen.forms`, or `(root)`. */
  path: string;
  message: string;
}

/** `/tabs/0/screen` → `tabs[0].screen` */
export function pointerToPath(pointer: string): string {
  if (!pointer) return '(root)';
  return pointer
    .split('/')
    .slice(1)
    .map((seg) => seg.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((out, seg) => (/^\d+$/.test(seg) ? `${out}[${seg}]` : out ? `${out}.${seg}` : seg), '');
}

const join = (pointer: string, key: string) => `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
const typeList = (types: string[]) => (types.length > 1 ? `${types.slice(0, -1).join(', ')} or ${types.at(-1)}` : types[0]);

/**
 * Ajv reports every branch of an anyOf. Replace each failed anyOf with what a person would
 * want to hear: the errors of the branch they evidently meant (the one whose `type` const
 * matched, for tagged unions like screens), or "must be string or null" for plain unions.
 * Innermost unions first, so nested ones are already simplified when outer ones look at them.
 */
function collapseUnions(errors: SchemaError[]): SchemaError[] {
  let list = errors;
  const unions = list.filter((e) => e.keyword === 'anyOf' || e.keyword === 'oneOf').sort((a, b) => b.schemaPath.length - a.schemaPath.length);
  for (const union of unions) {
    if (!list.includes(union)) continue;
    const prefix = `${union.schemaPath}/`;
    const at = union.instancePath;
    // Errors from inline branches carry the union's schema path; errors from $ref branches don't.
    // Schema paths are relative to each definition, so match the instance too.
    const within = (e: SchemaError) => e.instancePath === at || e.instancePath.startsWith(`${at}/`);
    const inline = list.filter((e) => e.schemaPath.startsWith(prefix) && within(e));
    const typeAlts = list.filter((e) => e.instancePath === at && e.keyword === 'type' && !inline.includes(e));
    const deeper = list.filter((e) => e.instancePath.startsWith(`${at}/`) && !inline.includes(e) && e !== union);
    const branches = new Map<string, SchemaError[]>();
    for (const e of inline) {
      const branch = e.schemaPath.slice(prefix.length).split('/')[0];
      branches.set(branch, [...(branches.get(branch) ?? []), e]);
    }
    const tagged = [...branches.values()].some((errs) => errs.some((e) => e.keyword === 'const'));
    const viable = [...branches.values()].filter((errs) => !errs.some((e) => e.keyword === 'const'));
    let replacement: SchemaError[];
    if (tagged && viable.length === 1) replacement = viable[0];
    else if (deeper.length) replacement = []; // an object branch matched in shape; its own errors (kept) say what's wrong
    else {
      const types = [...new Set([...typeAlts, ...inline.filter((e) => e.keyword === 'type' && e.instancePath === at)].flatMap((e) => String(e.params.type).split(',')))];
      const tags = [...new Set(inline.filter((e) => e.keyword === 'const').map((e) => JSON.stringify(e.params.allowedValue)))];
      replacement = tagged
        ? [{ ...union, instancePath: `${at}/type`, keyword: 'union', message: `must be ${typeList(tags)}` }]
        : [{ ...union, keyword: 'union', message: types.length ? `must be ${typeList(types)}` : 'does not match any of the allowed forms' }];
    }
    const drop = new Set<SchemaError>([union, ...inline, ...typeAlts]);
    list = [...list.filter((e) => !drop.has(e)), ...replacement];
  }
  return list;
}

function toIssue(e: SchemaError): SchemaIssue {
  switch (e.keyword) {
    case 'required':
      return { path: pointerToPath(join(e.instancePath, e.params.missingProperty)), message: 'is required' };
    case 'additionalProperties':
      return { path: pointerToPath(join(e.instancePath, e.params.additionalProperty)), message: 'is not a known key' };
    case 'const':
      return { path: pointerToPath(e.instancePath), message: `must be ${JSON.stringify(e.params.allowedValue)}` };
    case 'minLength':
    case 'minItems':
      return { path: pointerToPath(e.instancePath), message: e.params.limit === 1 ? 'must not be empty' : (e.message ?? e.keyword) };
    case 'pattern':
      return { path: pointerToPath(e.instancePath), message: `must match ${e.params.pattern}` };
    case 'enum':
      return { path: pointerToPath(e.instancePath), message: `must be one of ${e.params.allowedValues.map((v: unknown) => JSON.stringify(v)).join(', ')}` };
    default:
      return { path: pointerToPath(e.instancePath), message: e.message ?? e.keyword };
  }
}

/** Ajv's `if` adds a summary error alongside the `then` errors that explain it. */
const noise = (e: SchemaError) => e.keyword === 'if';

function run(validate: Validator, json: unknown): SchemaIssue[] {
  if (validate(json)) return [];
  const issues = collapseUnions((validate.errors ?? []).filter((e) => !noise(e))).map(toIssue);
  const seen = new Set<string>();
  return issues
    .filter((i) => {
      const key = `${i.path}\n${i.message}`;
      return !seen.has(key) && seen.add(key);
    })
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}

/** Problems with an app manifest, per schema/app.schema.json. */
export const manifestSchemaIssues = (json: unknown) => run(validateApp, json);

/** Problems with a dashboard or form, per schema/dashboard.schema.json. */
export const dashboardSchemaIssues = (json: unknown) => run(validateDashboard, json);

/** Schema findings about a value itself (wrong type, out of range), as opposed to missing or unknown keys. */
const BAD_VALUE = new Set([
  'type',
  'union',
  'enum',
  'const',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'pattern',
  'format',
]);

const parentOf = (pointer: string) => pointer.slice(0, pointer.lastIndexOf('/'));

/**
 * Removing item `index` of the array at `array` moves the later items down one: rewrites
 * remembered pointers to match, and forgets those inside the removed item.
 */
function shiftPointers(pointers: Set<string>, array: string, index: number) {
  for (const p of [...pointers]) {
    if (!p.startsWith(`${array}/`)) continue;
    const [first, ...rest] = p.slice(array.length + 1).split('/');
    const n = Number(first);
    if (!Number.isInteger(n) || n < index) continue;
    pointers.delete(p);
    if (n > index) pointers.add([array, n - 1, ...rest].join('/'));
  }
}

/** Removes the value at `pointer`; returns the array and index if it was an array item. */
function removeAt(root: unknown, pointer: string): { array: string; index: number } | null {
  const segs = pointer
    .split('/')
    .slice(1)
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  const last = segs.pop()!;
  let parent = root as Record<string, unknown>;
  for (const s of segs) parent = parent?.[s] as Record<string, unknown>;
  if (Array.isArray(parent)) {
    parent.splice(Number(last), 1);
    return { array: parentOf(pointer), index: Number(last) };
  }
  if (parent && typeof parent === 'object') delete parent[last];
  return null;
}

export interface RemovedValue {
  /** Like `panels[0].title`. */
  path: string;
  /** Why, e.g. "must be string". */
  message: string;
}

/**
 * A copy of a dashboard without the values that don't fit the schema: anything of the wrong
 * type or out of range is removed, so the renderer only ever sees what it was written for, and
 * an object left without something it requires goes too. Unknown keys stay (they're ignored),
 * and so do objects that were missing a required key to begin with, as Grafana exports often are.
 */
export function cleanDashboard<T>(json: T): { value: T; removed: RemovedValue[] } {
  const value = structuredClone(json);
  const removed: RemovedValue[] = [];
  const deletedKeys = new Set<string>();
  for (let round = 0; round < 10 && !validateDashboard(value); round++) {
    const errors = collapseUnions((validateDashboard.errors ?? []).filter((e) => !noise(e)));
    const targets = new Map<string, string>();
    for (const e of errors) {
      if (BAD_VALUE.has(e.keyword)) {
        // A tagged object (e.g. a transformation) with a tag it doesn't know: the whole object goes.
        const pointer = e.keyword === 'union' && e.instancePath.endsWith('/type') ? parentOf(e.instancePath) : e.instancePath;
        if (pointer && !targets.has(pointer)) targets.set(pointer, toIssue(e).message);
      } else if (e.keyword === 'required' && e.instancePath && deletedKeys.has(join(e.instancePath, e.params.missingProperty))) {
        targets.set(e.instancePath, `was left without ${e.params.missingProperty}`);
      }
    }
    // Skip anything inside another target; remove later array items first so indices hold.
    const pointers = [...targets.keys()]
      .filter((p) => ![...targets.keys()].some((q) => q !== p && p.startsWith(`${q}/`)))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    if (!pointers.length) break;
    for (const p of pointers) {
      const item = removeAt(value, p);
      if (item) shiftPointers(deletedKeys, item.array, item.index);
      else deletedKeys.add(p);
      removed.push({ path: pointerToPath(p), message: targets.get(p)! });
    }
  }
  removed.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  return { value, removed };
}
