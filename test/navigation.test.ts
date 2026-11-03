import { describe, expect, it } from 'vitest';
import { bundleFromFiles, documentUses, screenOfType, tabIdFor, type AppManifest } from '../src';

const manifest: AppManifest = {
  version: 1,
  title: 'T',
  tabs: [
    { id: 'log', title: 'Log', screen: { type: 'forms', forms: ['daily', 'workout'] } },
    { id: 'trends', title: 'Trends', screen: { type: 'dashboard', dashboard: 'trends' } },
    { id: 'more', title: 'More', screen: { type: 'menu', items: [{ dashboard: 'trends' }, { form: 'workout' }] } },
  ],
  documents: {},
};

describe('navigation editing', () => {
  it('makes URL-safe tab ids that are not taken', () => {
    expect(tabIdFor('Track days!', [])).toBe('track-days');
    expect(tabIdFor('Log', ['log', 'log-2'])).toBe('log-3');
    expect(tabIdFor('  ', [])).toBe('tab');
  });

  it('lists where each document is shown', () => {
    expect(documentUses(manifest)).toEqual({ daily: ['Log'], workout: ['Log', 'More (menu)'], trends: ['Trends', 'More (menu)'] });
  });

  it('keeps what a screen showed when its type changes', () => {
    const docs = { forms: ['daily', 'workout'], dashboards: ['trends', 'workouts'] };
    const forms = manifest.tabs[0].screen;
    expect(screenOfType('menu', forms, docs)).toEqual({ type: 'menu', items: [{ form: 'daily' }, { form: 'workout' }] });
    expect(screenOfType('dashboard', forms, docs)).toEqual({ type: 'dashboard', dashboard: 'trends' });
    expect(screenOfType('forms', manifest.tabs[2].screen, docs)).toEqual({ type: 'forms', forms: ['workout'] });
    expect(screenOfType('dashboard', manifest.tabs[2].screen, docs)).toEqual({ type: 'dashboard', dashboard: 'trends' });
    expect(screenOfType('forms', undefined, { forms: [], dashboards: [] })).toEqual({ type: 'forms', forms: [] });
  });

  it('assembles draft files as the app would load them', async () => {
    const files = {
      'app.json': JSON.stringify({ ...manifest, tabs: [manifest.tabs[1]], documents: { trends: 'd/trends.json' } }),
      'd/trends.json': JSON.stringify({ title: 'Trends', panels: [] }),
    };
    const ok = await bundleFromFiles(files, 'app.json');
    expect(ok.bundle?.documents.trends.title).toBe('Trends');
    const broken = await bundleFromFiles({ ...files, 'd/trends.json': '{' }, 'app.json');
    expect(broken.bundle).toBeUndefined();
    expect(broken.issues[0].path).toBe('d/trends.json');
  });
});
