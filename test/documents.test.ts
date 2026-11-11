import { describe, expect, it } from 'vitest';
import { documentIdFor, metricChanges, removeDocumentFromManifest, renameDocumentInManifest } from '../src';

const manifest = `{
  "version": 1,
  "title": "T",
  "tabs": [
    { "id": "log", "title": "Log", "screen": { "type": "forms", "forms": ["daily", "walk"] } },
    { "id": "walks", "title": "Walks", "screen": { "type": "forms", "forms": ["walk"] } },
    { "id": "trends", "title": "Trends", "screen": { "type": "dashboard", "dashboard": "trends" } },
    { "id": "more", "title": "More", "screen": { "type": "menu", "items": [{ "form": "walk", "title": "Walk" }, { "dashboard": "trends" }] } }
  ],
  "documents": {
    "daily": "forms/daily.json",
    "walk": "forms/walk.json",
    "trends": "dashboards/trends.json"
  }
}
`;

const form = (metrics: Record<number, string>, title = 'F') =>
  JSON.stringify({ title, panels: Object.entries(metrics).map(([id, metric]) => ({ id: Number(id), type: 'input-number', title: `In ${id}`, options: { metric } })) });

describe('document ids', () => {
  it('slugs titles', () => {
    expect(documentIdFor(' Dog Walk! ')).toBe('dog-walk');
    expect(documentIdFor('!!')).toBe('');
  });
});

describe('removing a document', () => {
  it('drops it from documents, forms, menus, and tabs that showed only it', () => {
    const { text, removedTabs } = removeDocumentFromManifest(manifest, 'walk');
    const m = JSON.parse(text);
    expect(removedTabs).toEqual(['Walks']);
    expect(m.tabs.map((t: { id: string }) => t.id)).toEqual(['log', 'trends', 'more']);
    expect(m.tabs[0].screen.forms).toEqual(['daily']);
    expect(m.tabs[2].screen.items).toEqual([{ dashboard: 'trends' }]);
    expect(m.documents).toEqual({ daily: 'forms/daily.json', trends: 'dashboards/trends.json' });
    // Formatting elsewhere is kept.
    expect(text).toContain('{ "id": "trends", "title": "Trends", "screen": { "type": "dashboard", "dashboard": "trends" } }');
  });

  it('removes a dashboard tab', () => {
    const m = JSON.parse(removeDocumentFromManifest(manifest, 'trends').text);
    expect(m.tabs.map((t: { id: string }) => t.id)).toEqual(['log', 'walks', 'more']);
    expect(m.tabs[2].screen.items).toEqual([{ form: 'walk', title: 'Walk' }]);
  });

  it('refuses to leave no tabs', () => {
    const only = JSON.stringify({ version: 1, title: 'T', tabs: [{ id: 'a', title: 'A', screen: { type: 'dashboard', dashboard: 'd' } }], documents: { d: 'd.json' } });
    expect(() => removeDocumentFromManifest(only, 'd')).toThrow(/Add another tab/);
  });
});

describe('renaming a document', () => {
  it('updates every reference and keeps its place in documents', () => {
    const text = renameDocumentInManifest(manifest, 'walk', 'dog-walk', 'forms/dog-walk.json');
    const m = JSON.parse(text);
    expect(Object.entries(m.documents)).toEqual([
      ['daily', 'forms/daily.json'],
      ['dog-walk', 'forms/dog-walk.json'],
      ['trends', 'dashboards/trends.json'],
    ]);
    expect(m.tabs[0].screen.forms).toEqual(['daily', 'dog-walk']);
    expect(m.tabs[1].screen.forms).toEqual(['dog-walk']);
    expect(m.tabs[3].screen.items[0]).toEqual({ form: 'dog-walk', title: 'Walk' });
  });

  it('refuses a taken id', () => {
    expect(() => renameDocumentInManifest(manifest, 'walk', 'daily', 'forms/daily.json')).toThrow(/already/);
  });
});

describe('metric changes', () => {
  const before = { 'forms/a.json': form({ 1: 'weight', 2: 'sleep' }), 'forms/b.json': form({ 1: 'mood' }), 'app.json': manifest };

  it('spots a renamed input', () => {
    expect(metricChanges(before, { 'forms/a.json': form({ 1: 'weight_lb', 2: 'sleep' }) })).toEqual([
      { metric: 'weight', renamedTo: 'weight_lb', file: 'forms/a.json', input: 'In 1', readBy: [] },
    ]);
  });

  it('lists charts that still read the old metric', () => {
    const chart = JSON.stringify({ title: 'C', panels: [{ id: 1, type: 'timeseries', targets: [{ refId: 'A', metric: 'weight' }] }] });
    expect(metricChanges({ ...before, 'dashboards/c.json': chart }, { 'forms/a.json': form({ 1: 'weight_lb', 2: 'sleep' }) })[0].readBy).toEqual(['dashboards/c.json']);
  });

  it('spots metrics no form records any more', () => {
    expect(metricChanges(before, { 'forms/b.json': null })).toEqual([{ metric: 'mood', readBy: [] }]);
  });

  it('ignores a metric another form still records', () => {
    expect(metricChanges({ ...before, 'forms/c.json': form({ 4: 'mood' }) }, { 'forms/b.json': null })).toEqual([]);
  });

  it('counts a file that does not parse as recording nothing', () => {
    expect(metricChanges(before, { 'forms/a.json': '{' })).toEqual([{ metric: 'sleep', readBy: [] }, { metric: 'weight', readBy: [] }]);
  });
});
