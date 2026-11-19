import { createContext, useContext } from 'react';
import { groupFields, type GroupItem, type InputChoice, type InputGroupPanel, type InputValue } from '../../core/inputs';
import type { EntryStore } from '../../core/local';
import type { SpeechRecognizer } from '../speech';

export interface InputFormState {
  value(metric: string): InputValue;
  setValue(metric: string, v: InputValue): void;
  isDirty(metric: string): boolean;
  store: EntryStore;
  /** Runtime choice lists for input-select panels with `choicesFrom`. */
  choices: Record<string, InputChoice[]>;
  /** Why the input's value can't be saved, once that's worth showing. */
  problem?(metric: string): string | undefined;
  /** Dictation for the inputs that take it; none means no microphone buttons. */
  speech?: SpeechRecognizer | null;
  /** Language to dictate in (BCP-47); the recognizer's default when missing. */
  speechLang?: string;
  /** An input-group's items and what can be done to them. Missing outside an InputForm that supports groups. */
  group?(panel: InputGroupPanel): FormGroup;
}

/** One input-group as the form holds it. Indexes are positions in `items`. */
export interface FormGroup {
  items: { key: string; values: GroupItem; edited: string[] }[];
  canAdd: boolean;
  /** Whether the group has changes since it was last saved or discarded. */
  edited?: boolean;
  /** Why the group as a whole can't be saved (too few items), once that's worth showing. */
  problem?: string;
  add(): void;
  duplicate(index: number): void;
  remove(index: number): void;
  move(index: number, by: number): void;
  setValue(index: number, metric: string, v: InputValue): void;
  fieldProblem(index: number, metric: string): string | undefined;
}

/** Identifies a group within its form: its panel id, or its fields' metrics. */
export const groupKey = (g: InputGroupPanel) => (g.id != null ? `#${g.id}` : groupFields(g).map((f) => f.options.metric).join('|'));

export const InputFormContext = createContext<InputFormState | null>(null);

export function useInputForm(): InputFormState {
  const v = useContext(InputFormContext);
  if (!v) throw new Error('Input panels must be rendered inside <InputForm>');
  return v;
}
