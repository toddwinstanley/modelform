// @vitest-environment jsdom
import './render/dom';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { InputForm, MemoryEntryStore, type Dashboard, type DictationOptions, type InputPanel, type SpeechRecognizer } from '../src';
import { render, settle } from './render/render';

/** A recognizer the test speaks into: `say` delivers a phrase to whoever is listening. */
function fakeRecognizer() {
  const started: DictationOptions[] = [];
  let current: DictationOptions | null = null;
  const end = () => {
    const o = current;
    current = null;
    o?.onEnd();
  };
  const speech: SpeechRecognizer = {
    start(o) {
      started.push(o);
      current = o;
      return { stop: end, abort: end };
    },
  };
  const say = async (text: string, final = true) => {
    await act(async () => {
      current?.onText(text, final);
      if (final) end();
    });
    await settle();
  };
  return { speech, started, say, listening: () => current != null };
}

const at = (y: number, p: Omit<InputPanel, 'gridPos'>): InputPanel => ({ ...p, gridPos: { x: 0, y, w: 24, h: 3 } }) as InputPanel;

const form: Dashboard = {
  title: 'Workout',
  panels: [
    at(0, { type: 'input-number', title: 'Weight', options: { metric: 'weight', step: 0.1, unit: 'kg' } }),
    at(3, { type: 'input-select', title: 'Activity', options: { metric: 'activity', choices: [{ label: 'Run', value: 'run' }, { label: 'Swim', value: 'swim' }] } }),
    at(6, { type: 'input-text', title: 'Notes', options: { metric: 'notes' } }),
    at(9, { type: 'input-slider', title: 'Effort', options: { metric: 'effort' } }),
  ],
};

const mic = (el: HTMLElement, title: string) => el.querySelector(`[aria-label="Dictate ${title}"]`) as HTMLElement | null;
const tap = async (b: HTMLElement) => {
  await act(async () => b.click());
  await settle();
};

describe('dictation', () => {
  it('shows a microphone on text, number and choice inputs only when there is a recognizer', async () => {
    const without = await render(<InputForm dashboard={form} store={new MemoryEntryStore()} />);
    // jsdom has no Web Speech API, so the web default finds nothing.
    expect(without.el.querySelector('[aria-label^="Dictate"]')).toBeNull();
    await without.unmount();

    const { speech } = fakeRecognizer();
    const view = await render(<InputForm dashboard={form} store={new MemoryEntryStore()} speech={speech} />);
    expect(mic(view.el, 'Weight')).not.toBeNull();
    expect(mic(view.el, 'Activity')).not.toBeNull();
    expect(mic(view.el, 'Notes')).not.toBeNull();
    // A slider is one drag already.
    expect(mic(view.el, 'Effort')).toBeNull();
    await view.unmount();
  });

  it('fills inputs from what was said, and saves them', async () => {
    const store = new MemoryEntryStore();
    const { speech, started, say } = fakeRecognizer();
    const view = await render(<InputForm dashboard={form} store={store} speech={speech} speechLang="en-GB" />);

    await tap(mic(view.el, 'Weight')!);
    expect(started.at(-1)).toMatchObject({ lang: 'en-GB', hints: ['kg'] });
    // While listening, the button stops instead, and what's heard so far shows.
    expect(view.el.querySelector('[aria-label="Stop dictating"]')).not.toBeNull();
    await say('seventy two', false);
    expect(view.el.textContent).toContain('“seventy two”');
    await say('seventy two point five');
    expect((view.el.querySelector('input') as HTMLInputElement).value).toBe('72.5');

    await tap(mic(view.el, 'Activity')!);
    expect(started.at(-1)?.hints).toEqual(['Run', 'Swim']);
    await say('went for a swim');

    await tap(mic(view.el, 'Notes')!);
    await say('felt strong');
    await tap(mic(view.el, 'Notes')!);
    await say('left knee sore');
    expect((view.el.querySelector('textarea') as HTMLTextAreaElement).value).toBe('felt strong left knee sore');

    const save = [...view.el.querySelectorAll('[role="button"]')].find((b) => b.textContent === 'Save') as HTMLElement;
    await tap(save);
    const saved = await store.list({ metrics: ['weight', 'activity', 'notes'] });
    expect(Object.fromEntries(saved.map((e) => [e.metric, e.value ?? e.text]))).toEqual({ weight: 72.5, activity: 'swim', notes: 'felt strong left knee sore' });
    await view.unmount();
  });

  it('says what it heard when it can’t use it, and leaves the value alone', async () => {
    const { speech, say } = fakeRecognizer();
    const view = await render(<InputForm dashboard={form} store={new MemoryEntryStore()} speech={speech} />);
    await tap(mic(view.el, 'Weight')!);
    await say('banana');
    expect(view.el.textContent).toContain('Heard “banana”, not a number');
    expect((view.el.querySelector('input') as HTMLInputElement).value).toBe('');
    await view.unmount();
  });

  it('listens on one input at a time', async () => {
    const { speech, started, listening } = fakeRecognizer();
    const view = await render(<InputForm dashboard={form} store={new MemoryEntryStore()} speech={speech} />);
    await tap(mic(view.el, 'Weight')!);
    await tap(mic(view.el, 'Notes')!);
    expect(started).toHaveLength(2);
    expect(listening()).toBe(true);
    // Only Notes is still listening.
    expect(view.el.querySelectorAll('[aria-label="Stop dictating"]')).toHaveLength(1);
    expect(mic(view.el, 'Weight')).not.toBeNull();
    await view.unmount();
  });

  it('turns off with speech={null}', async () => {
    const view = await render(<InputForm dashboard={form} store={new MemoryEntryStore()} speech={null} />);
    expect(view.el.querySelector('[aria-label^="Dictate"]')).toBeNull();
    await view.unmount();
  });
});
