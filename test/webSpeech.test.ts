import { afterEach, describe, expect, it } from 'vitest';
import { webSpeechRecognizer } from '../src';

/** A stand-in for the browser's SpeechRecognition; the last one made is `rec`. */
class FakeRecognition {
  static last: FakeRecognition;
  lang = '';
  interimResults = false;
  continuous = false;
  maxAlternatives = 0;
  onresult: ((e: { results: unknown }) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {}
  stop() {
    this.onend?.();
  }
  abort() {
    this.onerror?.({ error: 'aborted' });
    this.onend?.();
  }
  /** Results so far: [text, isFinal] per phrase. */
  results(...phrases: [string, boolean][]) {
    const list = Object.assign(phrases.map(([t, isFinal]) => ({ isFinal, 0: { transcript: t } })), { length: phrases.length });
    this.onresult?.({ results: list });
  }
}

const g = globalThis as { SpeechRecognition?: unknown };
afterEach(() => {
  delete g.SpeechRecognition;
});

describe('webSpeechRecognizer', () => {
  it('is null without a browser recognizer', () => {
    expect(webSpeechRecognizer()).toBeNull();
  });

  it('delivers one final phrase', () => {
    g.SpeechRecognition = FakeRecognition;
    const heard: [string, boolean][] = [];
    webSpeechRecognizer()!.start({ lang: 'en-GB', onText: (t, f) => heard.push([t, f]), onError() {}, onEnd() {} });
    const r = FakeRecognition.last;
    expect([r.lang, r.continuous]).toEqual(['en-GB', false]);
    r.results(['mood', false]);
    r.results(['mood four', true]);
    expect(heard).toEqual([
      ['mood', false],
      ['mood four', true],
    ]);
  });

  it('keeps listening through pauses when continuous, and delivers everything once stopped', () => {
    g.SpeechRecognition = FakeRecognition;
    const heard: [string, boolean][] = [];
    let ended = 0;
    const session = webSpeechRecognizer()!.start({ continuous: true, onText: (t, f) => heard.push([t, f]), onError() {}, onEnd: () => ended++ });
    const r = FakeRecognition.last;
    expect(r.continuous).toBe(true);
    r.results(['weight seventy', true]);
    r.results(['weight seventy', true], [' mood four', true]);
    expect(heard.every(([, f]) => !f)).toBe(true);
    session.stop();
    expect(heard.at(-1)).toEqual(['weight seventy mood four', true]);
    expect(heard.filter(([, f]) => f)).toHaveLength(1);
    expect(ended).toBe(1);
  });

  it('drops what was heard when aborted', () => {
    g.SpeechRecognition = FakeRecognition;
    const heard: [string, boolean][] = [];
    const session = webSpeechRecognizer()!.start({ continuous: true, onText: (t, f) => heard.push([t, f]), onError() {}, onEnd() {} });
    FakeRecognition.last.results(['weight seventy', true]);
    session.abort();
    expect(heard.filter(([, f]) => f)).toEqual([]);
  });
});
