/**
 * Speech recognition as the forms use it. modelform doesn't depend on a native speech module:
 * the app passes a SpeechRecognizer to InputForm (an adapter over expo-speech-recognition, say),
 * and on the web the browser's Web Speech API is used when there is one.
 */

export interface DictationOptions {
  /** BCP-47 language tag; the recognizer's default (usually the device's) when missing. */
  lang?: string;
  /** Words likely to be said, such as choice labels, for recognizers that take hints. */
  hints?: string[];
  /**
   * Keep listening through pauses until stopped, for a long phrase (filling a whole form).
   * `onText` is still called with `final` only once, when listening stops.
   */
  continuous?: boolean;
  /** What's been heard so far. Called with `final` once, when the phrase is done. */
  onText(text: string, final: boolean): void;
  /** Something went wrong, in words to show the user. Not called when stopped or aborted. */
  onError(message: string): void;
  /** Listening has stopped, for any reason. Always called last. */
  onEnd(): void;
}

export interface DictationSession {
  /** Stop listening and deliver what was heard. */
  stop(): void;
  /** Stop listening and drop what was heard. */
  abort(): void;
}

export interface SpeechRecognizer {
  /** Listen for one phrase. Asks for microphone and speech permission first where needed. */
  start(options: DictationOptions): DictationSession;
}

interface WebSpeechResultList {
  length: number;
  [i: number]: { isFinal: boolean; 0: { transcript: string } };
}

interface WebSpeechRecognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: WebSpeechResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type WebSpeechConstructor = new () => WebSpeechRecognition;

const WEB_ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked for this site',
  'service-not-allowed': 'Speech recognition isn’t allowed in this browser',
  'audio-capture': 'No microphone found',
  network: 'Speech recognition needs an internet connection',
  'no-speech': 'Didn’t hear anything',
  'language-not-supported': 'Speech recognition doesn’t support this language',
};

/** The browser's speech recognition, or null where there's none (Firefox, and outside browsers). */
export function webSpeechRecognizer(): SpeechRecognizer | null {
  const g = globalThis as { SpeechRecognition?: WebSpeechConstructor; webkitSpeechRecognition?: WebSpeechConstructor };
  const Recognition = g.SpeechRecognition ?? g.webkitSpeechRecognition;
  if (!Recognition) return null;
  return {
    start(o) {
      const r = new Recognition();
      if (o.lang) r.lang = o.lang;
      r.interimResults = true;
      r.continuous = !!o.continuous;
      r.maxAlternatives = 1;
      let delivered = false;
      let aborted = false;
      let lastText = '';
      r.onresult = (e) => {
        let text = '';
        let final = true;
        for (let i = 0; i < e.results.length; i++) {
          text += e.results[i][0].transcript;
          if (!e.results[i].isFinal) final = false;
        }
        lastText = text.trim();
        // Continuous: phrases finish one by one; the whole is final only when listening ends.
        if (o.continuous) final = false;
        if (final) delivered = true;
        o.onText(lastText, final);
      };
      r.onerror = (e) => {
        if (e.error === 'aborted') return;
        o.onError(WEB_ERRORS[e.error] ?? 'Speech recognition stopped');
      };
      r.onend = () => {
        // Some browsers end without a final result when stopped early; deliver what was heard.
        if (!delivered && !aborted && lastText) o.onText(lastText, true);
        o.onEnd();
      };
      try {
        r.start();
      } catch {
        queueMicrotask(() => {
          o.onError('Speech recognition couldn’t start');
          o.onEnd();
        });
      }
      return {
        stop: () => r.stop(),
        abort: () => {
          aborted = true;
          r.abort();
        },
      };
    },
  };
}
