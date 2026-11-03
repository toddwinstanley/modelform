import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { entryToInputValue, inputPanels, inputProblem, toEntries, type Entry, type InputChoice, type InputPanel, type InputValue, type NewEntry } from '../../core/inputs';
import type { EntryStore } from '../../core/local';
import type { Dashboard } from '../../core/schema';
import { DashboardProvider } from '../context';
import { DashboardView } from '../DashboardView';
import { useDashTheme } from '../theme';
import { InputFormContext, type InputFormState } from './formContext';

export interface InputFormProps {
  dashboard: Dashboard;
  store: EntryStore;
  /** Called after Save with the entries just recorded. */
  onSaved?(count: number, entries: Entry[]): void;
  /** Choice lists for input-select panels that set `choicesFrom`, keyed by that name. */
  choices?: Record<string, InputChoice[]>;
  /** Shown above the panels in place of the "Recording for" time picker. */
  header?: ReactNode;
  /** With `header`: the time to record a Save at (default now). */
  timestamp?(): number;
  /** Initial values supplied by the app, keyed by metric. They take the place of the panels' own `default`. */
  defaults?: Record<string, InputValue>;
  /**
   * Called on Save before anything is recorded, with the time it will be recorded at.
   * Resolve with entries to record alongside the form's (e.g. asked for in a dialog), or
   * null to cancel the save and keep the edits.
   */
  beforeSave?(ts: number): Promise<NewEntry[] | null>;
  /**
   * The entries of an earlier Save, to edit it. The form starts from their values (inputs
   * without one start empty, not from defaults), and Save records every input again at
   * their timestamp in place of them.
   */
  editing?: Entry[];
}

const NO_CHOICES: Record<string, InputChoice[]> = {};
const NO_DEFAULTS: Record<string, InputValue> = {};

/** The value each input had in `entries`, null where it had none. */
function savedValues(panels: InputPanel[], entries: Entry[]): Record<string, InputValue> {
  const values: Record<string, InputValue> = {};
  for (const p of panels) {
    const mine = entries.filter((e) => e.metric === p.options.metric);
    values[p.options.metric] = p.options.multi ? (mine.length ? mine.map((e) => (e.text ?? e.value)!) : null) : entryToInputValue(p, mine[0]);
  }
  return values;
}

/**
 * A data entry form laid out from dashboard JSON with input-* panels. Edited values are
 * staged until Save, then recorded together at the chosen timestamp, along with any
 * `record: "always"` inputs. Counters record immediately on tap.
 */
export function InputForm({ dashboard, store, onSaved, choices = NO_CHOICES, header, timestamp, defaults: given = NO_DEFAULTS, beforeSave, editing }: InputFormProps) {
  const theme = useDashTheme();
  const panels = useMemo(() => inputPanels(dashboard), [dashboard]);
  const saved = useMemo(() => (editing ? savedValues(panels, editing) : NO_DEFAULTS), [panels, editing]);
  const [defaults, setDefaults] = useState<Record<string, InputValue>>({});
  const [edits, setEdits] = useState<Record<string, InputValue>>({});
  const [offsetMs, setOffsetMs] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  // After a Save is refused, every problem shows; before it, only those of values being edited.
  const [checked, setChecked] = useState(false);

  // Reloads as the store changes, so "last" follows each save.
  useEffect(() => {
    let run = 0;
    const load = async () => {
      const mine = ++run;
      const next: Record<string, InputValue> = {};
      for (const p of panels) {
        const d = p.options.default;
        if (d === 'last') next[p.options.metric] = entryToInputValue(p, await store.latest(p.options.metric));
        else if (d !== undefined) next[p.options.metric] = d;
      }
      if (mine === run) setDefaults(next);
    };
    load();
    const unsubscribe = store.subscribe(load);
    return () => {
      run = -1;
      unsubscribe();
    };
  }, [panels, store]);

  const state = useMemo<InputFormState>(() => {
    const value = (m: string) => (m in edits ? edits[m] : m in saved ? saved[m] : m in given ? given[m] : defaults[m] ?? null);
    return {
      value,
      setValue: (m, v) => {
        setStatus(null);
        setEdits((e) => ({ ...e, [m]: v }));
      },
      isDirty: (m) => m in edits,
      store,
      choices,
      problem: (m) => {
        const p = panels.find((x) => x.options.metric === m);
        return p && (checked || m in edits) ? inputProblem(p, value(m)) : undefined;
      },
    };
  }, [edits, saved, defaults, given, store, choices, panels, checked]);

  const dirty = Object.keys(edits).length;

  const save = useCallback(async () => {
    const problems = panels.flatMap((p) => {
      const problem = inputProblem(p, state.value(p.options.metric));
      return problem ? [`${p.title || p.options.metric}: ${problem.toLowerCase()}`] : [];
    });
    if (problems.length) {
      setChecked(true);
      setStatus(problems.length === 1 ? `Can’t save. ${problems[0]}` : `Can’t save: ${problems.length} fields need fixing`);
      return;
    }
    const ts = editing?.[0]?.ts ?? (header !== undefined ? (timestamp?.() ?? Date.now()) : Date.now() + offsetMs);
    const entries = panels
      .filter((p) => editing || p.options.metric in edits || p.options.record === 'always')
      .flatMap((p) => toEntries(p, state.value(p.options.metric), ts));
    if (!entries.length) return;
    const extra = beforeSave ? await beforeSave(ts) : [];
    if (!extra) return;
    const added = editing ? await replace(store, editing.map((e) => e.id), [...entries, ...extra]) : await store.add([...entries, ...extra]);
    setEdits({});
    setChecked(false);
    setOffsetMs(0);
    setStatus(`Saved ${added.length} ${added.length === 1 ? 'value' : 'values'}`);
    onSaved?.(added.length, added);
  }, [panels, edits, state, offsetMs, store, onSaved, header, timestamp, beforeSave, editing]);

  return (
    <InputFormContext.Provider value={state}>
      <DashboardProvider dashboard={dashboard}>
        <DashboardView
          header={header !== undefined ? header : <TimestampPicker offsetMs={offsetMs} onChange={setOffsetMs} />}
          footer={
            <View style={[styles.footer, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
              <Text style={[styles.status, { color: status?.startsWith('Can’t') ? theme.danger : theme.textSecondary }]}>
                {status ?? (dirty ? `${dirty} unsaved ${dirty === 1 ? 'change' : 'changes'}` : 'Nothing to save')}
              </Text>
              {dirty > 0 && (
                <Pressable
                  onPress={() => {
                    setEdits({});
                    setChecked(false);
                    setStatus(null);
                  }}
                  style={styles.secondary}
                  accessibilityRole="button"
                >
                  <Text style={{ color: theme.textSecondary, fontWeight: '500' }}>Discard</Text>
                </Pressable>
              )}
              <Pressable
                onPress={save}
                disabled={!dirty}
                accessibilityRole="button"
                style={({ pressed }) => [styles.save, { backgroundColor: theme.accent, opacity: !dirty ? 0.4 : pressed ? 0.8 : 1 }]}
              >
                <Text style={styles.saveText}>Save</Text>
              </Pressable>
            </View>
          }
        />
      </DashboardProvider>
    </InputFormContext.Provider>
  );
}

async function replace(store: EntryStore, ids: string[], entries: NewEntry[]): Promise<Entry[]> {
  if (store.replace) return store.replace(ids, entries);
  for (const id of ids) await store.remove(id);
  return store.add(entries);
}

const HOUR = 3_600_000;

function TimestampPicker({ offsetMs, onChange }: { offsetMs: number; onChange(ms: number): void }) {
  const theme = useDashTheme();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const when = new Date(now + offsetMs);
  const step = (ms: number) => () => onChange(Math.min(0, offsetMs + ms));

  return (
    <View style={[styles.when, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.whenLabel, { color: theme.textMuted }]}>Recording for</Text>
        <Text style={[styles.whenValue, { color: theme.text }]}>
          {offsetMs === 0
            ? 'Now'
            : when.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </Text>
      </View>
      {[
        ['−1d', -24 * HOUR],
        ['−1h', -HOUR],
        ['+1h', HOUR],
      ].map(([label, ms]) => (
        <Pressable key={label} onPress={step(ms as number)} style={[styles.stepBtn, { borderColor: theme.border }]} accessibilityRole="button">
          <Text style={{ color: theme.text, fontSize: 13 }}>{label}</Text>
        </Pressable>
      ))}
      {offsetMs !== 0 && (
        <Pressable onPress={() => onChange(0)} style={[styles.stepBtn, { borderColor: theme.accent }]} accessibilityRole="button">
          <Text style={{ color: theme.accent, fontSize: 13, fontWeight: '600' }}>Now</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  status: { flex: 1, fontSize: 13 },
  secondary: { paddingHorizontal: 8, paddingVertical: 10 },
  save: { paddingHorizontal: 22, paddingVertical: 10, borderRadius: 8 },
  saveText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  when: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 12, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  whenLabel: { fontSize: 11 },
  whenValue: { fontSize: 15, fontWeight: '600' },
  stepBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1 },
});
