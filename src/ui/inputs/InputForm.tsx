import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { entryToInputValue, inputPanels, toEntries, type InputValue } from '../../core/inputs';
import type { EntryStore } from '../../core/local';
import type { Dashboard } from '../../core/schema';
import { DashboardProvider } from '../context';
import { DashboardView } from '../DashboardView';
import { useDashTheme } from '../theme';
import { InputFormContext, type InputFormState } from './formContext';

export interface InputFormProps {
  dashboard: Dashboard;
  store: EntryStore;
  onSaved?(count: number): void;
}

/**
 * A data entry form laid out from dashboard JSON with input-* panels. Edited values are
 * staged until Save, then recorded together at the chosen timestamp. Counters record
 * immediately on tap.
 */
export function InputForm({ dashboard, store, onSaved }: InputFormProps) {
  const theme = useDashTheme();
  const panels = useMemo(() => inputPanels(dashboard), [dashboard]);
  const [defaults, setDefaults] = useState<Record<string, InputValue>>({});
  const [edits, setEdits] = useState<Record<string, InputValue>>({});
  const [offsetMs, setOffsetMs] = useState(0);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, InputValue> = {};
      for (const p of panels) {
        const d = p.options.default;
        if (d === 'last') next[p.options.metric] = entryToInputValue(p, await store.latest(p.options.metric));
        else if (d !== undefined) next[p.options.metric] = d;
      }
      if (!cancelled) setDefaults(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [panels, store]);

  const state = useMemo<InputFormState>(
    () => ({
      value: (m) => (m in edits ? edits[m] : defaults[m] ?? null),
      setValue: (m, v) => {
        setStatus(null);
        setEdits((e) => ({ ...e, [m]: v }));
      },
      isDirty: (m) => m in edits,
      store,
    }),
    [edits, defaults, store],
  );

  const dirty = Object.keys(edits).length;

  const save = useCallback(async () => {
    const ts = Date.now() + offsetMs;
    const entries = panels.filter((p) => p.options.metric in edits).flatMap((p) => toEntries(p, edits[p.options.metric], ts));
    if (!entries.length) return;
    await store.add(entries);
    setEdits({});
    setOffsetMs(0);
    setStatus(`Saved ${entries.length} ${entries.length === 1 ? 'value' : 'values'}`);
    onSaved?.(entries.length);
  }, [panels, edits, offsetMs, store, onSaved]);

  return (
    <InputFormContext.Provider value={state}>
      <DashboardProvider dashboard={dashboard}>
        <DashboardView
          header={<TimestampPicker offsetMs={offsetMs} onChange={setOffsetMs} />}
          footer={
            <View style={[styles.footer, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
              <Text style={[styles.status, { color: theme.textSecondary }]}>
                {status ?? (dirty ? `${dirty} unsaved ${dirty === 1 ? 'change' : 'changes'}` : 'Nothing to save')}
              </Text>
              {dirty > 0 && (
                <Pressable onPress={() => setEdits({})} style={styles.secondary} accessibilityRole="button">
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

const HOUR = 3_600_000;

function TimestampPicker({ offsetMs, onChange }: { offsetMs: number; onChange(ms: number): void }) {
  const theme = useDashTheme();
  const [now, setNow] = useState(Date.now());
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
