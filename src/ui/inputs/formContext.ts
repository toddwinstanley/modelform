import { createContext, useContext } from 'react';
import type { InputChoice, InputValue } from '../../core/inputs';
import type { EntryStore } from '../../core/local';

export interface InputFormState {
  value(metric: string): InputValue;
  setValue(metric: string, v: InputValue): void;
  isDirty(metric: string): boolean;
  store: EntryStore;
  /** Runtime choice lists for input-select panels with `choicesFrom`. */
  choices: Record<string, InputChoice[]>;
  /** Why the input's value can't be saved, once that's worth showing. */
  problem?(metric: string): string | undefined;
}

export const InputFormContext = createContext<InputFormState | null>(null);

export function useInputForm(): InputFormState {
  const v = useContext(InputFormContext);
  if (!v) throw new Error('Input panels must be rendered inside <InputForm>');
  return v;
}
