import type { DataFrame, Field } from './frame';
import type { FieldConfig, Panel } from './schema';

/**
 * Effective config for a field: panel defaults, then config the datasource attached
 * to the field, then any matching panel overrides (byName, byRegexp, byFrameRefID, byType).
 */
export function resolveFieldConfig(panel: Panel, field: Field, frame: DataFrame, displayName: string): FieldConfig {
  let config: FieldConfig = mergeConfig(panel.fieldConfig?.defaults ?? {}, field.config ?? {});
  for (const o of panel.fieldConfig?.overrides ?? []) {
    if (!matches(o.matcher, field, frame, displayName)) continue;
    for (const p of o.properties) config = setPath(config, p.id, p.value);
  }
  return config;
}

function matches(matcher: { id: string; options?: unknown }, field: Field, frame: DataFrame, displayName: string) {
  const opt = matcher.options;
  switch (matcher.id) {
    case 'byName':
      return opt === displayName || opt === field.name;
    case 'byRegexp':
      try {
        return new RegExp(String(opt)).test(displayName);
      } catch {
        return false;
      }
    case 'byFrameRefID':
      return opt === frame.refId;
    case 'byType':
      return opt === field.type;
    default:
      return false;
  }
}

function mergeConfig(a: FieldConfig, b: FieldConfig): FieldConfig {
  return { ...a, ...b, custom: { ...a.custom, ...b.custom } };
}

/** Override property ids are dotted paths, e.g. "custom.lineWidth" or "color". */
function setPath(config: FieldConfig, path: string, value: unknown): FieldConfig {
  const keys = path.split('.');
  const root: Record<string, any> = { ...config };
  let node = root;
  keys.forEach((k, i) => {
    if (i === keys.length - 1) node[k] = value;
    else node = node[k] = { ...(node[k] ?? {}) };
  });
  return root as FieldConfig;
}
