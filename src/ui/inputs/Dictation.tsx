import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { dictationHints, spokenValue, takesDictation } from '../../core/speech';
import type { InputChoice, InputPanel, InputValue } from '../../core/inputs';
import type { DictationSession } from '../speech';
import { useDashTheme } from '../theme';
import { useInputForm } from './formContext';

/** One field listens at a time: starting another drops the first. */
let listening: DictationSession | null = null;

/** How long a "Heard …" message stays once listening has stopped. */
const HINT_MS = 4000;

export interface Dictation {
  /** Whether this input can be dictated into here: it takes dictation and the form has a recognizer. */
  available: boolean;
  listening: boolean;
  /** What's being heard, or why it couldn't be used. */
  hint: string | null;
  toggle(): void;
}

/**
 * Dictation into one input: listens for a phrase, turns it into the input's value with
 * spokenValue, and hands that to `onChange`. Only the final phrase changes the value.
 */
export function useDictation(panel: InputPanel, value: InputValue, onChange: (v: InputValue) => void, choices?: InputChoice[]): Dictation {
  const form = useInputForm();
  const speech = form.speech;
  const [on, setOn] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const session = useRef<DictationSession | null>(null);
  // The latest value and onChange, since the phrase arrives after the render that started listening.
  const latest = useRef({ value, onChange, choices });
  useEffect(() => {
    latest.current = { value, onChange, choices };
  });

  useEffect(
    () => () => {
      session.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (on || !hint) return;
    const t = setTimeout(() => setHint(null), HINT_MS);
    return () => clearTimeout(t);
  }, [on, hint]);

  const toggle = () => {
    if (!speech) return;
    if (session.current) {
      session.current.stop();
      return;
    }
    listening?.abort();
    setHint(null);
    let mine: DictationSession | null = null;
    let ended = false;
    const end = () => {
      ended = true;
      if (session.current === mine) session.current = null;
      if (listening === mine) listening = null;
      setOn(false);
    };
    try {
      mine = speech.start({
        lang: form.speechLang,
        hints: dictationHints(panel, choices),
        onText(text, final) {
          if (!final) return setHint(text ? `“${text}”` : null);
          const result = spokenValue(panel, text, latest.current.value, latest.current.choices);
          if ('value' in result) {
            latest.current.onChange(result.value);
            setHint(null);
          } else setHint(result.problem);
        },
        onError: (message) => setHint(message),
        onEnd: end,
      });
    } catch {
      setHint('Dictation couldn’t start');
      return;
    }
    // onEnd may already have run (a recognizer that fails at once).
    if (!ended) {
      session.current = mine;
      listening = mine;
      setOn(true);
    }
  };

  return { available: !!speech && takesDictation(panel), listening: on, hint, toggle };
}

/** The microphone button beside an input. Filled while listening; tap again to stop. */
export function MicButton({ dictation, title, size = 32 }: { dictation: Dictation; title?: string; size?: number }) {
  const theme = useDashTheme();
  if (!dictation.available) return null;
  const on = dictation.listening;
  return (
    <Pressable
      onPress={dictation.toggle}
      accessibilityRole="button"
      accessibilityLabel={on ? 'Stop dictating' : title ? `Dictate ${title}` : 'Dictate'}
      accessibilityState={{ selected: on }}
      hitSlop={6}
      style={({ pressed }) => [
        styles.mic,
        { width: size, height: size, borderRadius: size / 2, borderColor: on ? theme.accent : theme.border },
        { backgroundColor: on ? theme.accent : pressed ? theme.grid : theme.surface },
      ]}
    >
      <Svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none" stroke={on ? '#fff' : theme.textSecondary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" />
        <Path d="M19 11a7 7 0 0 1-14 0M12 18v3" />
      </Svg>
    </Pressable>
  );
}

/** What's being heard, or why it couldn't be used, under the input. Nothing when there's nothing to say. */
export function DictationHint({ dictation }: { dictation: Dictation }) {
  const theme = useDashTheme();
  if (!dictation.hint) return null;
  return (
    <Text style={[styles.hint, { color: dictation.listening ? theme.textSecondary : theme.textMuted }]} numberOfLines={1} accessibilityLiveRegion="polite">
      {dictation.hint}
    </Text>
  );
}

const styles = StyleSheet.create({
  mic: { borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  hint: { fontSize: 12, fontStyle: 'italic' },
});
