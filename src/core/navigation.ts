/**
 * Editing a manifest's navigation: ids for new tabs, what a tab shows when its screen type
 * changes, and where each document is shown.
 */
import type { AppManifest, Screen } from './manifest';

/** A URL-safe tab id from a title, unlike any of `taken`. */
export function tabIdFor(title: string, taken: string[]): string {
  const base =
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'tab';
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

/** A screen of another type, showing what the old one did where it can (a dashboard, or a form, becomes a menu item). */
export function screenOfType(type: Screen['type'], from: Screen | undefined, docs: { forms: string[]; dashboards: string[] }): Screen {
  const shown = from ? screenDocuments(from) : [];
  const firstOf = (ids: string[]) => shown.find((d) => ids.includes(d.id))?.id ?? ids[0] ?? '';
  switch (type) {
    case 'dashboard':
      return { type, dashboard: firstOf(docs.dashboards) };
    case 'forms': {
      const forms = shown.filter((d) => d.kind === 'form').map((d) => d.id);
      return { type, forms: forms.length ? forms : docs.forms.slice(0, 1) };
    }
    case 'menu':
      return { type, items: shown.map((d) => (d.kind === 'form' ? { form: d.id } : { dashboard: d.id })) };
  }
}

/** The documents a screen shows, in order. */
export function screenDocuments(screen: Screen): { id: string; kind: 'form' | 'dashboard' }[] {
  switch (screen?.type) {
    case 'dashboard':
      return [{ id: screen.dashboard, kind: 'dashboard' }];
    case 'forms':
      return (screen.forms ?? []).map((id) => ({ id, kind: 'form' as const }));
    case 'menu':
      return (screen.items ?? []).flatMap((i): { id: string; kind: 'form' | 'dashboard' }[] => (i.dashboard ? [{ id: i.dashboard, kind: 'dashboard' }] : i.form ? [{ id: i.form, kind: 'form' }] : []));
    default:
      return [];
  }
}

/** For each document, the titles of the tabs that show it, directly or from their menu. */
export function documentUses(manifest: Pick<AppManifest, 'tabs'>): Record<string, string[]> {
  const uses: Record<string, string[]> = {};
  for (const tab of manifest.tabs ?? [])
    for (const { id } of screenDocuments(tab.screen)) {
      const where = tab.screen.type === 'menu' ? `${tab.title} (menu)` : tab.title;
      if (!(uses[id] ??= []).includes(where)) uses[id].push(where);
    }
  return uses;
}
