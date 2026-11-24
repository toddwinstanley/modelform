import { useEffect, useRef, useState } from 'react';
import { fillHints, type FillForm, type FillResult, type FormFiller } from '../../core/formFill';
import type { DictationSession, SpeechRecognizer } from '../speech';
import { claimListening, stopListening } from './Dictation';

export interface VoiceFill {
  /** Whether the form can be filled by voice: a recognizer, a filler, and fields to fill. */
  available: boolean;
  listening: boolean;
  /** The filler is working on what was said. */
  filling: boolean;
  /** What's being heard while listening. */
  heard: string | null;
  toggle(): void;
}

interface Options {
  speech: SpeechRecognizer | null | undefined;
  lang?: string;
  filler: FormFiller | null | undefined;
  form: FillForm;
  /** What was said, and what the filler made of it. */
  onFilled(result: FillResult, said: string): void;
  /** Something went wrong (no microphone, say), in words to show the user. */
  onError(message: string): void;
}

/**
 * Filling the whole form from one thing said: listens until stopped (pauses and all), hands the
 * transcript to the filler, and passes its result on for the form to show for review.
 */
export function useVoiceFill({ speech, lang, filler, form, onFilled, onError }: Options): VoiceFill {
  const [on, setOn] = useState(false);
  const [filling, setFilling] = useState(false);
  const [heard, setHeard] = useState<string | null>(null);
  const session = useRef<DictationSession | null>(null);
  const alive = useRef(true);
  // The latest form and callback, since the transcript arrives after the render that started listening.
  const latest = useRef({ form, filler, onFilled, onError });
  useEffect(() => {
    latest.current = { form, filler, onFilled, onError };
  });

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      session.current?.abort();
    };
  }, []);

  const fill = async (said: string) => {
    const { form: f, filler: run } = latest.current;
    if (!run) return;
    setFilling(true);
    let result: FillResult;
    try {
      result = await run(f, said);
    } catch {
      result = { values: {}, problems: [{ key: '', problem: 'Couldn’t fill the form' }] };
    }
    if (!alive.current) return;
    setFilling(false);
    latest.current.onFilled(result, said);
  };

  const toggle = () => {
    if (!speech || !filler) return;
    if (session.current) {
      session.current.stop();
      return;
    }
    stopListening();
    setHeard(null);
    let mine: DictationSession | null = null;
    let ended = false;
    const end = () => {
      ended = true;
      if (session.current === mine) session.current = null;
      claimListening(mine, true);
      if (alive.current) {
        setOn(false);
        setHeard(null);
      }
    };
    try {
      mine = speech.start({
        lang,
        hints: fillHints(form),
        continuous: true,
        onText(text, final) {
          if (!final) return setHeard(text || null);
          if (text.trim()) fill(text.trim());
        },
        onError: (message) => alive.current && latest.current.onError(message),
        onEnd: end,
      });
    } catch {
      onError('Dictation couldn’t start');
      return;
    }
    if (!ended) {
      session.current = mine;
      claimListening(mine);
      setOn(true);
    }
  };

  return { available: !!speech && !!filler && form.fields.length > 0, listening: on, filling, heard, toggle };
}
