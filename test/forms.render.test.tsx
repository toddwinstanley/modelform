// @vitest-environment jsdom
import './render/dom';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { InputForm, inputProblem, MemoryEntryStore, type Dashboard, type InputPanel } from '../src';
import { render, settle } from './render/render';

const input = (type: InputPanel['type'], options: Partial<InputPanel['options']>, title = 'Weight'): InputPanel => ({
  type,
  title,
  gridPos: { x: 0, y: 0, w: 24, h: 3 },
  options: { metric: 'weight', ...options },
});

describe('form validation', () => {
  it('finds required inputs left empty, and numbers outside min and max', () => {
    expect(inputProblem(input('input-number', { required: true }), null)).toBe('Required');
    expect(inputProblem(input('input-select', { required: true, multi: true }), [])).toBe('Required');
    expect(inputProblem(input('input-text', { required: true }), '')).toBe('Required');
    expect(inputProblem(input('input-number', {}), null)).toBeUndefined();
    expect(inputProblem(input('input-number', { min: 30, max: 200, unit: 'kg' }), 250)).toBe('At most 200 kg');
    expect(inputProblem(input('input-slider', { min: 1 }), 0)).toBe('At least 1');
    expect(inputProblem(input('input-number', { min: 30, max: 200 }), 80)).toBeUndefined();
    // Toggles always have a value, and counters record on tap; neither can be required.
    expect(inputProblem(input('input-toggle', { required: true }), null)).toBeUndefined();
  });

  it('refuses to save until the problems are fixed, and says which', async () => {
    const store = new MemoryEntryStore();
    const form: Dashboard = {
      title: 'F',
      panels: [input('input-number', { required: true }), { ...input('input-text', { metric: 'notes', required: true }, 'Notes'), gridPos: { x: 0, y: 3, w: 24, h: 3 } }],
    };
    const view = await render(<InputForm dashboard={form} store={store} />);
    const [weight, notes] = [...view.el.querySelectorAll('input, textarea')] as HTMLInputElement[];
    const type = async (el: HTMLInputElement, text: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!.call(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await settle();
    };
    const save = async () => {
      const button = [...view.el.querySelectorAll('[role="button"]')].find((b) => b.textContent === 'Save') as HTMLElement;
      await act(async () => button.click());
      await settle();
    };

    await type(notes, 'ok');
    // Nothing to complain about until a Save is tried.
    expect(view.el.textContent).not.toContain('Required');
    await save();
    expect(view.el.textContent).toContain('Can’t save. Weight: required');
    expect(view.el.textContent).toContain('Required');
    expect(await store.list({ metrics: ['weight', 'notes'] })).toEqual([]);

    await type(weight, '80');
    await save();
    expect(view.el.textContent).toContain('Saved 2 values');
    expect((await store.list({ metrics: ['weight', 'notes'] })).map((e) => e.value ?? e.text).sort()).toEqual([80, 'ok']);
    await view.unmount();
  });
});

describe('editing a save', () => {
  it('starts from its values and replaces it at its timestamp', async () => {
    const store = new MemoryEntryStore([
      { metric: 'weight', ts: 1000, value: 80, text: null },
      { metric: 'reps', ts: 2000, value: 5, text: null },
    ]);
    const form: Dashboard = {
      title: 'F',
      panels: [
        input('input-number', {}),
        { ...input('input-number', { metric: 'reps', default: 'last' }, 'Reps'), gridPos: { x: 0, y: 3, w: 24, h: 3 } },
      ],
    };
    const editing = await store.list({ metrics: ['weight'] });
    const view = await render(<InputForm dashboard={form} store={store} editing={editing} />);
    const [weight, reps] = [...view.el.querySelectorAll('input')] as HTMLInputElement[];
    expect(weight.value).toBe('80');
    // Reps wasn't part of that save, so it doesn't pick up the latest reps either.
    expect(reps.value).toBe('');

    await act(async () => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(weight), 'value')!.set!.call(weight, '82');
      weight.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle();
    const button = [...view.el.querySelectorAll('[role="button"]')].find((b) => b.textContent === 'Save') as HTMLElement;
    await act(async () => button.click());
    await settle();

    expect((await store.list({ metrics: ['weight'] })).map(({ ts, value }) => ({ ts, value }))).toEqual([{ ts: 1000, value: 82 }]);
    expect((await store.list({ metrics: ['reps'] })).map((e) => e.ts)).toEqual([2000]);
    await view.unmount();
  });
});
