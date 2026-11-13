import { describe, expect, it } from 'vitest';
import { applyTemplate, makeTemplate, parseTemplate, templateNeeds, type AppManifest, type AppTemplate, type Dashboard } from '../src/core';

const workout: Dashboard = {
  title: 'Workout',
  panels: [
    { id: 1, type: 'input-number', title: 'Minutes', gridPos: { x: 0, y: 0, w: 24, h: 3 }, options: { metric: 'workout-minutes' } },
    { id: 2, type: 'input-rating', title: 'Effort', gridPos: { x: 0, y: 3, w: 24, h: 3 }, options: { metric: 'effort' } },
  ],
};
const progress: Dashboard = {
  title: 'Progress',
  panels: [
    { id: 1, type: 'timeseries', title: 'Minutes', gridPos: { x: 0, y: 0, w: 24, h: 8 }, datasource: { type: 'modelform-local' }, targets: [{ refId: 'A', metric: 'workout-minutes' }] },
    { id: 2, type: 'stat', title: 'Weight', gridPos: { x: 0, y: 8, w: 6, h: 4 }, datasource: { type: 'modelform-local' }, targets: [{ refId: 'A', metric: 'weight' }] },
  ],
};
const daily: Dashboard = { title: 'Daily', panels: [{ id: 1, type: 'input-number', title: 'Weight', gridPos: { x: 0, y: 0, w: 24, h: 3 }, options: { metric: 'weight' } }] };

const manifest: AppManifest = {
  version: 1,
  title: 'Mine',
  tabs: [
    { id: 'log', title: 'Log', screen: { type: 'forms', forms: ['daily', 'workout'] } },
    { id: 'progress', title: 'Progress', icon: 'chart', screen: { type: 'dashboard', dashboard: 'progress' } },
    { id: 'more', title: 'More', screen: { type: 'menu', items: [{ form: 'workout' }] } },
  ],
  documents: { daily: 'forms/daily.json', workout: 'forms/workout.json', progress: 'dashboards/progress.json' },
};
const documents = { daily, workout, progress };

describe('makeTemplate', () => {
  it('takes the chosen documents, knowing forms from dashboards, with the tabs that show only them', () => {
    const t = makeTemplate(manifest, documents, ['workout', 'progress'], { title: 'Workout tracker' });
    expect(t).toMatchObject({ $modelform: 'template', version: 1, title: 'Workout tracker', description: '' });
    expect(t.documents.map((d) => [d.kind, d.id])).toEqual([
      ['form', 'workout'],
      ['dashboard', 'progress'],
    ]);
    // "Log" also shows daily, so it stays behind.
    expect(t.tabs.map((x) => x.id)).toEqual(['progress', 'more']);
    expect(t.metrics).toEqual(['workout-minutes', 'effort', 'weight']);
  });

  it('copies documents rather than sharing them', () => {
    const t = makeTemplate(manifest, documents, ['workout'], { title: 'T' });
    t.documents[0].dashboard.title = 'Changed';
    expect(workout.title).toBe('Workout');
  });
});

describe('parseTemplate', () => {
  const t = makeTemplate(manifest, documents, ['workout', 'progress'], { title: 'Workout tracker', description: 'Log and chart' });

  it('reads one back', () => {
    expect(parseTemplate(JSON.stringify(t))).toEqual({ template: t });
  });

  it('drops tabs that show anything outside it, and works out metrics again', () => {
    const edited = { ...t, metrics: ['nonsense'], tabs: [...t.tabs, manifest.tabs[0]] };
    const read = parseTemplate(JSON.stringify(edited));
    expect('template' in read && read.template.tabs.map((x) => x.id)).toEqual(['progress', 'more']);
    expect('template' in read && read.template.metrics).toEqual(t.metrics);
  });

  it('says why something isn’t a template', () => {
    expect(parseTemplate('x')).toEqual({ error: 'That isn’t JSON' });
    expect(parseTemplate('{"title":"x"}')).toEqual({ error: 'That isn’t a template' });
    expect(parseTemplate(JSON.stringify({ ...t, version: 9 }))).toEqual({ error: 'That template comes from a newer version of modelform' });
    expect(parseTemplate(JSON.stringify({ ...t, title: ' ' }))).toEqual({ error: 'The template has no title' });
    expect(parseTemplate(JSON.stringify({ ...t, documents: [{ kind: 'chart', id: 'a', dashboard: progress }] }))).toMatchObject({ error: expect.stringContaining('needs a kind') });
    expect(parseTemplate(JSON.stringify({ ...t, documents: [t.documents[0], t.documents[0]] }))).toEqual({ error: 'Two documents are called "workout"' });
    expect(parseTemplate(JSON.stringify({ ...t, documents: [{ kind: 'dashboard', id: 'a', dashboard: { title: 'A' } }] }))).toMatchObject({ error: expect.stringContaining('"a" can’t be shown') });
  });

  it('allows a template with no documents of one kind, or none at all', () => {
    const empty = { ...t, documents: [], tabs: [] };
    expect(parseTemplate(JSON.stringify(empty))).toMatchObject({ template: { documents: [], metrics: [] } });
  });
});

describe('templateNeeds', () => {
  const t = makeTemplate(manifest, documents, ['workout', 'progress'], { title: 'T' });

  it('asks about metrics nothing records, not ones the template’s own forms do', () => {
    expect(templateNeeds(t, [])).toEqual({ unknown: ['weight'], covered: [] });
    expect(templateNeeds(t, ['weight'])).toEqual({ unknown: [], covered: [] });
  });

  it('asks again when a form that recorded something is left out', () => {
    expect(templateNeeds(t, [], ['progress']).unknown).toEqual(['workout-minutes', 'weight']);
  });

  it('spots forms whose data the config already records, directly or once mapped', () => {
    expect(templateNeeds(t, ['workout-minutes', 'effort']).covered).toEqual(['workout']);
    expect(templateNeeds(t, ['mins', 'effort'], undefined, { 'workout-minutes': 'mins' }).covered).toEqual(['workout']);
  });
});

describe('applyTemplate', () => {
  const t: AppTemplate = makeTemplate(manifest, documents, ['workout', 'progress'], { title: 'T' });
  const text = JSON.stringify({ version: 1, title: 'Other', tabs: [{ id: 'progress', title: 'Home', screen: { type: 'forms', forms: ['workout'] } }], documents: { workout: 'forms/workout.json' } }, null, 2);

  it('adds the documents as files, renaming ids and paths already used', () => {
    const out = applyTemplate(text, ['app.json', 'forms/workout.json'], t);
    expect(out.ids).toEqual({ workout: 'workout-2', progress: 'progress' });
    expect(Object.keys(out.files)).toEqual(['forms/workout-2.json', 'dashboards/progress.json']);
    expect(JSON.parse(out.files['dashboards/progress.json'])).toEqual(progress);
    expect(JSON.parse(out.manifest).documents).toEqual({ workout: 'forms/workout.json', 'workout-2': 'forms/workout-2.json', progress: 'dashboards/progress.json' });
    expect(out.tabs).toEqual([]);
  });

  it('avoids a path that’s taken even when no document uses it', () => {
    const out = applyTemplate(text, ['dashboards/progress.json'], t, { documents: ['progress'] });
    expect(out.ids).toEqual({ progress: 'progress-2' });
  });

  it('adds only the documents and tabs asked for, pointing tabs at the new ids', () => {
    const out = applyTemplate(text, ['forms/workout.json'], t, { tabs: ['progress', 'more'] });
    const tabs = JSON.parse(out.manifest).tabs;
    expect(out.tabs).toEqual(['progress-2', 'more']);
    expect(tabs[1]).toMatchObject({ id: 'progress-2', screen: { type: 'dashboard', dashboard: 'progress' } });
    expect(tabs[2]).toMatchObject({ id: 'more', screen: { type: 'menu', items: [{ form: 'workout-2' }] } });
    // Without its form, the menu tab would show nothing, so it's skipped.
    const noForm = applyTemplate(text, [], t, { documents: ['progress'], tabs: ['progress', 'more'] });
    expect(noForm.tabs).toEqual(['progress-2']);
  });

  it('maps metrics in what it adds', () => {
    const out = applyTemplate(text, [], t, { documents: ['progress'], metrics: { weight: 'body-weight' } });
    expect(JSON.parse(out.files['dashboards/progress.json']).panels[1].targets[0].metric).toBe('body-weight');
  });

  it('keeps the manifest’s formatting, and copes without documents or tabs lists', () => {
    expect(applyTemplate(text, [], t, { documents: [] }).manifest).toBe(text);
    const bare = applyTemplate('{"version":1,"title":"Bare"}', [], t, { tabs: ['progress'] });
    expect(JSON.parse(bare.manifest)).toMatchObject({ documents: { workout: 'forms/workout.json', progress: 'dashboards/progress.json' }, tabs: [{ id: 'progress' }] });
  });
});
