// @vitest-environment jsdom
import './render/dom';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import {
  entriesSavedWith,
  entriesToItems,
  groupProblems,
  groupToEntries,
  InputForm,
  inputPanels,
  MemoryEntryStore,
  prepareDashboard,
  renameMetrics,
  type Dashboard,
  type Entry,
  type InputGroupPanel,
} from '../src';
import { render, settle } from './render/render';

const sets = (options: Partial<InputGroupPanel['options']> = {}): InputGroupPanel => ({
  id: 2,
  type: 'input-group',
  title: 'Sets',
  gridPos: { x: 0, y: 0, w: 24, h: 12 },
  options: {
    itemTitle: 'Set',
    titleFrom: 'exercise',
    fields: [
      { type: 'input-text', title: 'Exercise', options: { metric: 'exercise', required: true } },
      { type: 'input-number', title: 'Weight', span: 12, options: { metric: 'weight', unit: 'kg' } },
      { type: 'input-number', title: 'Reps', span: 12, options: { metric: 'reps', required: true } },
    ],
    ...options,
  },
});

const form = (group: InputGroupPanel, extra: Dashboard['panels'] = []): Dashboard => ({ title: 'Strength', panels: [...extra, group] });

describe('input-group entries', () => {
  it('records each field of each filled item, numbered, with the save id', () => {
    const items = [{ exercise: 'Squat', weight: 100, reps: 5 }, {}, { exercise: 'Squat', reps: 3 }];
    const entries = groupToEntries(sets(), items, 1000, 's1');
    expect(entries).toEqual([
      { metric: 'exercise', ts: 1000, value: null, text: 'Squat', save: 's1', item: 0 },
      { metric: 'weight', ts: 1000, value: 100, text: null, save: 's1', item: 0 },
      { metric: 'reps', ts: 1000, value: 5, text: null, save: 's1', item: 0 },
      // The empty item is skipped, so the next one is item 1.
      { metric: 'exercise', ts: 1000, value: null, text: 'Squat', save: 's1', item: 1 },
      { metric: 'reps', ts: 1000, value: 3, text: null, save: 's1', item: 1 },
    ]);
  });

  it('rebuilds items from entries in order', () => {
    const entries = groupToEntries(sets(), [{ exercise: 'Bench', reps: 8 }, { exercise: 'Row', weight: 60, reps: 10 }], 1, 's').map((e, i) => ({ ...e, id: String(i) }));
    expect(entriesToItems(sets(), entries.reverse())).toEqual([{ exercise: 'Bench', reps: 8 }, { exercise: 'Row', weight: 60, reps: 10 }]);
  });

  it('says which item has a problem, and when there are too few', () => {
    expect(groupProblems(sets(), [{ exercise: 'Squat', reps: 5 }, { exercise: 'Squat' }, {}])).toEqual(['Set 2: Reps is required']);
    expect(groupProblems(sets({ min: 2 }), [{ exercise: 'Squat', reps: 5 }, {}])).toEqual(['Sets: at least 2 sets']);
  });

  it('counts group fields as inputs the form records', () => {
    expect(inputPanels(form(sets())).map((p) => p.options.metric)).toEqual(['exercise', 'weight', 'reps']);
  });

  it('tells saves apart by id even at the same time', () => {
    const e = (metric: string, text: string, save: string): Entry => ({ id: metric + save, metric, ts: 5, value: null, text, save });
    const all = [e('track', 'Spa', 'a'), e('config', 'GP', 'a'), e('track', 'Monza', 'b'), e('config', 'Junior', 'b')];
    expect(entriesSavedWith(all, 'config', 'track', 'Monza').map((x) => x.text)).toEqual(['Junior']);
  });
});

describe('input-group validation', () => {
  it('warns about groups without fields, counters, repeated metrics and a stray titleFrom', () => {
    const doc = form(
      sets({
        titleFrom: 'nope',
        fields: [
          { type: 'input-counter', options: { metric: 'taps' } },
          { type: 'input-number', options: { metric: 'mood' } },
        ],
      }),
      [{ id: 1, type: 'input-rating', title: 'Mood', gridPos: { x: 0, y: 0, w: 24, h: 3 }, options: { metric: 'mood' } }],
    );
    const messages = prepareDashboard(doc, 'f.json').issues.map((i) => `${i.path} ${i.message}`);
    expect(messages).toContain('f.json: panels[1].options.fields[0].type counters record on tap, so they can’t be in a group');
    expect(messages).toContain('f.json: panels[1].options.fields[1].options.metric "mood" is also recorded by panels[0]');
    expect(messages).toContain('f.json: panels[1].options.titleFrom must be the metric of one of the group’s fields');
    const empty = prepareDashboard(form(sets({ fields: [] })), 'f.json').issues.map((i) => i.message);
    expect(empty).toContain('a group needs at least one field');
  });

  it('passes the schema as written', () => {
    expect(prepareDashboard(form(sets({ min: 1, max: 10, start: 'last', addLabel: 'Add a set' })), 'f.json').issues).toEqual([]);
  });

  it('renames group field metrics, and titleFrom with them', () => {
    const [g] = renameMetrics([sets()], { exercise: 'lift' }) as InputGroupPanel[];
    expect(g.options.fields.map((f) => f.options.metric)).toEqual(['lift', 'weight', 'reps']);
    expect(g.options.titleFrom).toBe('lift');
  });
});

describe('input-group in a form', () => {
  const setup = async (dashboard: Dashboard, store = new MemoryEntryStore(), editing?: Entry[]) => {
    const view = await render(<InputForm dashboard={dashboard} store={store} editing={editing} />);
    const fields = () => [...view.el.querySelectorAll('input, textarea')] as HTMLInputElement[];
    const type = async (el: HTMLInputElement, text: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!.call(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await settle();
    };
    const press = async (match: (b: HTMLElement) => boolean) => {
      const button = ([...view.el.querySelectorAll('[role="button"]')] as HTMLElement[]).find(match);
      if (!button) throw new Error('no such button');
      await act(async () => button.click());
      await settle();
    };
    const byText = (t: string) => (b: HTMLElement) => b.textContent === t;
    const byLabel = (l: string) => (b: HTMLElement) => b.getAttribute('aria-label') === l;
    return { view, store, fields, type, press, byText, byLabel };
  };

  it('adds, fills and saves items, then starts from them with start "last"', async () => {
    const f = await setup(form(sets({ start: 'last' })));
    expect(f.view.el.textContent).toContain('Set 1');
    let [exercise, weight, reps] = f.fields();
    await f.type(exercise, 'Squat');
    await f.type(weight, '100');
    await f.type(reps, '5');
    // The card takes its title from the exercise.
    expect(f.view.el.textContent).toContain('Squat');
    await f.press(f.byLabel('Duplicate Squat'));
    expect(f.fields()).toHaveLength(6);
    await f.press(f.byText('+ Add set'));
    expect(f.view.el.textContent).toContain('Set 3');
    expect(f.fields()).toHaveLength(9);
    [, , , , , reps] = f.fields();
    await f.type(reps, '3');
    await f.type(f.fields()[6], 'Lunge');
    await f.type(f.fields()[8], '12');
    await f.press(f.byText('Save'));
    expect(f.view.el.textContent).toContain('Saved 8 values');

    const saved = await f.store.list({ metrics: ['exercise', 'weight', 'reps'] });
    expect(new Set(saved.map((e) => e.save)).size).toBe(1);
    expect(saved.filter((e) => e.item === 1).map((e) => e.value ?? e.text)).toEqual(['Squat', 100, 3]);
    expect(saved.filter((e) => e.item === 2).map((e) => e.value ?? e.text)).toEqual(['Lunge', 12]);

    // A new form starts from those three sets.
    exercise = f.fields()[0];
    expect(f.fields().map((x) => x.value)).toEqual(['Squat', '100', '5', 'Squat', '100', '3', 'Lunge', '', '12']);
    expect(exercise.value).toBe('Squat');
  });

  it('refuses a save with an item missing a required field, naming the item', async () => {
    const f = await setup(form(sets()));
    const [exercise] = f.fields();
    await f.type(exercise, 'Bench');
    await f.press(f.byText('Save'));
    expect(f.view.el.textContent).toContain('Can’t save. Set 1: Reps is required');
    expect(await f.store.list({ metrics: ['exercise', 'reps'] })).toEqual([]);
  });

  it('removes and reorders items', async () => {
    const f = await setup(form(sets()));
    await f.type(f.fields()[0], 'A');
    await f.press(f.byText('+ Add set'));
    await f.type(f.fields()[3], 'B');
    await f.press(f.byLabel('Move B up'));
    expect(f.fields()[0].value).toBe('B');
    await f.press(f.byLabel('Remove A'));
    expect(f.fields()).toHaveLength(3);
    // B was added and A removed.
    expect(f.view.el.textContent).toContain('2 unsaved changes');
  });

  it('edits an earlier save, keeping its items and save id', async () => {
    const store = new MemoryEntryStore();
    const added = await store.add(groupToEntries(sets(), [{ exercise: 'Row', reps: 10 }, { exercise: 'Row', reps: 8 }], 50, 'old'));
    const f = await setup(form(sets()), store, added);
    expect(f.fields().map((x) => x.value)).toEqual(['Row', '', '10', 'Row', '', '8']);
    await f.type(f.fields()[5], '9');
    await f.press(f.byText('Save'));
    const now = await store.list({ metrics: ['exercise', 'reps'] });
    expect(now.filter((e) => e.metric === 'reps').map((e) => [e.item, e.value])).toEqual([[0, 10], [1, 9]]);
    expect(now.every((e) => e.save === 'old' && e.ts === 50)).toBe(true);
  });
});
