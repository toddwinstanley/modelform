// @vitest-environment jsdom
import './render/dom';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { InputForm, MemoryEntryStore, type Dashboard, type DictationOptions, type FormFiller, type InputPanel, type SpeechRecognizer } from '../src';
import { render, settle } from './render/render';

/** A recognizer the test speaks into; `stop` ends listening and delivers what was heard. */
function fakeRecognizer() {
  const started: DictationOptions[] = [];
  let current: DictationOptions | null = null;
  let heard = '';
  const end = (deliver: boolean) => {
    const o = current;
    current = null;
    if (deliver && heard) o?.onText(heard, true);
    heard = '';
    o?.onEnd();
  };
  const speech: SpeechRecognizer = {
    start(o) {
      started.push(o);
      current = o;
      return { stop: () => end(true), abort: () => end(false) };
    },
  };
  const hear = async (text: string) => {
    await act(async () => {
      heard = text;
      current?.onText(text, false);
    });
    await settle();
  };
  return { speech, started, hear, listening: () => current != null };
}

const at = (y: number, p: Omit<InputPanel, 'gridPos'>): InputPanel => ({ ...p, gridPos: { x: 0, y, w: 24, h: 3 } }) as InputPanel;

const form: Dashboard = {
  title: 'Daily',
  panels: [
    at(0, { type: 'input-number', title: 'Weight', options: { metric: 'weight', step: 0.1, unit: 'kg' } }),
    at(3, { type: 'input-rating', title: 'Mood', options: { metric: 'mood', min: 1, max: 5 } }),
    at(6, { type: 'input-text', title: 'Notes', options: { metric: 'notes' } }),
  ],
};

const button = (el: HTMLElement, name: string) =>
  ([...el.querySelectorAll('[role="button"]')].find((b) => b.getAttribute('aria-label') === name || b.textContent === name) as HTMLElement | undefined) ?? null;
const tap = async (b: HTMLElement) => {
  await act(async () => b.click());
  await settle();
};

describe('filling the whole form by voice', () => {
  it('listens until stopped, fills what was said for review, and saves on Save', async () => {
    const store = new MemoryEntryStore();
    const { speech, started, hear } = fakeRecognizer();
    const view = await render(<InputForm dashboard={form} store={store} speech={speech} speechLang="en-GB" />);

    await tap(button(view.el, 'Fill the form by voice')!);
    expect(started.at(-1)).toMatchObject({ lang: 'en-GB', continuous: true, hints: ['Weight', 'kg', 'Mood', 'Notes'] });
    expect(view.el.textContent).toContain('Listening…');
    await hear('weight seventy two point five, mood four');
    expect(view.el.textContent).toContain('“weight seventy two point five, mood four”');

    await tap(button(view.el, 'Stop dictating')!);
    expect((view.el.querySelector('input') as HTMLInputElement).value).toBe('72.5');
    expect(view.el.textContent).toContain('Filled 2 fields. Check, then Save');
    // Filled inputs are marked for review; the others aren't.
    expect(view.el.textContent!.match(/From voice/g)).toHaveLength(2);
    // Nothing is recorded until Save.
    expect(await store.list({ metrics: ['weight', 'mood'] })).toEqual([]);

    await tap(button(view.el, 'Save')!);
    const saved = await store.list({ metrics: ['weight', 'mood'] });
    expect(Object.fromEntries(saved.map((e) => [e.metric, e.value]))).toEqual({ weight: 72.5, mood: 4 });
    expect(view.el.textContent).not.toContain('From voice');
    await view.unmount();
  });

  it('undoes a fill, keeping edits made before it', async () => {
    const { speech, hear } = fakeRecognizer();
    const view = await render(<InputForm dashboard={form} store={new MemoryEntryStore()} speech={speech} />);
    const notes = view.el.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      set.call(notes, 'typed first');
      notes.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle();

    await tap(button(view.el, 'Fill the form by voice')!);
    await hear('weight 80, notes said instead');
    await tap(button(view.el, 'Stop dictating')!);
    expect((view.el.querySelector('textarea') as HTMLTextAreaElement).value).toBe('said instead');

    await tap(button(view.el, 'Undo')!);
    expect((view.el.querySelector('input') as HTMLInputElement).value).toBe('');
    expect((view.el.querySelector('textarea') as HTMLTextAreaElement).value).toBe('typed first');
    expect(view.el.textContent).not.toContain('From voice');
    await view.unmount();
  });

  it('says so when nothing could be filled', async () => {
    const { speech, hear } = fakeRecognizer();
    const view = await render(<InputForm dashboard={form} store={new MemoryEntryStore()} speech={speech} />);
    await tap(button(view.el, 'Fill the form by voice')!);
    await hear('banana');
    await tap(button(view.el, 'Stop dictating')!);
    expect(view.el.textContent).toContain('Didn’t catch any fields in “banana”');
    await view.unmount();
  });

  it('takes another filler, and turns off with filler={null}', async () => {
    const { speech, hear } = fakeRecognizer();
    const said: string[] = [];
    const filler: FormFiller = async (_form, text) => {
      said.push(text);
      return { values: { mood: 2 }, problems: [{ key: 'weight', problem: 'Heard “heavy”, not a number' }] };
    };
    const view = await render(<InputForm dashboard={form} store={new MemoryEntryStore()} speech={speech} filler={filler} />);
    await tap(button(view.el, 'Fill the form by voice')!);
    await hear('heavy and a bit down');
    await tap(button(view.el, 'Stop dictating')!);
    expect(said).toEqual(['heavy and a bit down']);
    expect(view.el.textContent).toContain('Filled 1 field. Check, then Save. Weight: heard “heavy”, not a number');
    await view.unmount();

    const off = await render(<InputForm dashboard={form} store={new MemoryEntryStore()} speech={speech} filler={null} />);
    expect(button(off.el, 'Fill the form by voice')).toBeNull();
    await off.unmount();
    // No recognizer, no whole-form microphone either.
    const none = await render(<InputForm dashboard={form} store={new MemoryEntryStore()} speech={null} />);
    expect(button(none.el, 'Fill the form by voice')).toBeNull();
    await none.unmount();
  });

  it('shares the microphone with the fields: starting one stops the other', async () => {
    const { speech, started, listening } = fakeRecognizer();
    const view = await render(<InputForm dashboard={form} store={new MemoryEntryStore()} speech={speech} />);
    await tap(button(view.el, 'Dictate Weight')!);
    await tap(button(view.el, 'Fill the form by voice')!);
    expect(started).toHaveLength(2);
    expect(listening()).toBe(true);
    expect(view.el.querySelectorAll('[aria-label="Stop dictating"]')).toHaveLength(1);
    expect(button(view.el, 'Dictate Weight')).not.toBeNull();
    await view.unmount();
  });
});
