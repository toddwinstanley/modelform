import { createContext, useContext } from 'react';
import type { InputValue } from '../../core/inputs';
import type { EntryStore } from '../../core/local';

export interface InputFormState {
  value(metric: string): InputValue;
  setValue(metric: string, v: InputValue): void;
  isDirty(metric: string): boolean;
  store: EntryStore;
}

export const InputFormContext = createContext<InputFormState | null>(null);

export function useInputForm(): InputFormState {
  const v = useContext(InputFormContext);
  if (!v) throw new Error('Input panels must be rendered inside <InputForm>');
  return v;
}
