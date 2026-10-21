import type { DataFrame, Field } from './frame';

/** A panel's `transformations` entry. */
export interface Transformation {
  id: string;
  options?: Record<string, any>;
  disabled?: boolean;
}

type Transformer = (frames: DataFrame[], options: Record<string, any>) => DataFrame[];

const mapFields = (frames: DataFrame[], fn: (fields: Field[]) => Field[]) => frames.map((f) => ({ ...f, fields: fn(f.fields) }));

/** `/pattern/flags` or a bare pattern, as Grafana's regex options accept. */
function toRegExp(pattern: string): RegExp | undefined {
  const m = /^\/(.*)\/([a-z]*)$/.exec(pattern);
  try {
    return m ? new RegExp(m[1], m[2]) : new RegExp(pattern);
  } catch {
    return undefined;
  }
}

function nameMatcher(spec: { names?: string[]; pattern?: string } | undefined): ((name: string) => boolean) | undefined {
  if (!spec || (!spec.names?.length && !spec.pattern)) return undefined;
  const re = spec.pattern ? toRegExp(spec.pattern) : undefined;
  return (name) => !!spec.names?.includes(name) || !!re?.test(name);
}

const TRANSFORMERS: Record<string, Transformer> = {
  filterFieldsByName: (frames, { include, exclude }) => {
    const inc = nameMatcher(include);
    const exc = nameMatcher(exclude);
    return mapFields(frames, (fields) => fields.filter((f) => (!inc || inc(f.name)) && !exc?.(f.name)));
  },
  organize: (frames, { excludeByName = {}, indexByName = {}, renameByName = {} }) =>
    mapFields(frames, (fields) =>
      fields
        .filter((f) => !excludeByName[f.name])
        .map((f, i) => ({ f, i, at: indexByName[f.name] ?? Infinity }))
        .sort((a, b) => a.at - b.at || a.i - b.i)
        // Grafana renames through displayName and keeps the name, so byName overrides still match.
        .map(({ f }) => (renameByName[f.name] ? { ...f, config: { ...f.config, displayName: renameByName[f.name] } } : f)),
    ),
};

/**
 * Applies a panel's transformations in order. Ones dashkit doesn't implement are skipped,
 * so their panels render the untransformed data as they did before transformations were supported.
 */
export function applyTransformations(frames: DataFrame[], transformations: Transformation[] | undefined): DataFrame[] {
  let out = frames;
  for (const t of transformations ?? []) {
    const fn = !t.disabled && TRANSFORMERS[t.id];
    if (fn) out = fn(out, t.options ?? {});
  }
  return out;
}
