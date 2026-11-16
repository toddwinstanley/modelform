import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  entriesToItems,
  entryToInputValue,
  groupFields,
  groupProblems,
  groupToEntries,
  inputGroups,
  inputProblem,
  isEmptyItem,
  newSaveId,
  plainInputPanels,
  sameSave,
  toEntries,
  type Entry,
  type GroupItem,
  type InputChoice,
  type InputGroupPanel,
  type InputPanel,
  type InputValue,
  type NewEntry,
} from '../../core/inputs';
import type { EntryStore } from '../../core/local';
import type { Dashboard } from '../../core/schema';
import { DashboardProvider } from '../context';
import { DashboardView } from '../DashboardView';
import { useDashTheme } from '../theme';
import { groupKey, InputFormContext, type FormGroup, type InputFormState } from './formContext';

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

/** An item as the form holds it: a stable key for the list, its values, and which of them were edited. */
interface HeldItem {
  key: string;
  values: GroupItem;
  edited: string[];
}

/** The items of each group's latest Save, keyed by groupKey. */
async function lastItems(store: EntryStore, group: InputGroupPanel): Promise<GroupItem[]> {
  const metrics = groupFields(group).map((f) => f.options.metric);
  const latest = (await Promise.all(metrics.map((m) => store.latest(m)))).filter((e): e is Entry => !!e).sort((a, b) => b.ts - a.ts)[0];
  if (!latest) return [];
  return entriesToItems(group, sameSave(latest, await store.list({ metrics, from: latest.ts, to: latest.ts })));
}

/** A new item at `position`: fields' literal defaults, and "last" defaults from the item at that position last time. */
function freshItem(group: InputGroupPanel, position: number, last: GroupItem[] | undefined): GroupItem {
  const item: GroupItem = {};
  for (const f of groupFields(group)) {
    const d = f.options.default;
    const v = d === 'last' ? last?.[position]?.[f.options.metric] : d;
    if (v !== undefined && v !== null) item[f.options.metric] = v;
  }
  return item;
}

/** What a group shows before it's edited. */
function baseItems(group: InputGroupPanel, editing: Entry[] | undefined, last: GroupItem[] | undefined): HeldItem[] {
  const start = group.options.start;
  const values = editing
    ? entriesToItems(group, editing)
    : start === 'last' && last?.length
      ? last
      : Array.from({ length: typeof start === 'number' ? Math.max(0, start) : 1 }, (_, i) => freshItem(group, i, last));
  return values.map((v, i) => ({ key: `b${i}`, values: v, edited: [] }));
}

let nextItemKey = 1;

/**
 * A data entry form laid out from dashboard JSON with input-* panels. Edited values are
 * staged until Save, then recorded together at the chosen timestamp, along with any
 * `record: "always"` inputs. Counters record immediately on tap.
 */
export function InputForm({ dashboard, store, onSaved, choices = NO_CHOICES, header, timestamp, defaults: given = NO_DEFAULTS, beforeSave, editing }: InputFormProps) {
  const theme = useDashTheme();
  const panels = useMemo(() => plainInputPanels(dashboard), [dashboard]);
  const groups = useMemo(() => inputGroups(dashboard), [dashboard]);
  const saved = useMemo(() => (editing ? savedValues(panels, editing) : NO_DEFAULTS), [panels, editing]);
  const [defaults, setDefaults] = useState<Record<string, InputValue>>({});
  const [edits, setEdits] = useState<Record<string, InputValue>>({});
  // Items each group's latest Save had, for `start: "last"` and fields' "last" defaults.
  const [last, setLast] = useState<Record<string, GroupItem[]>>({});
  // Groups the user has changed, keyed by groupKey. Untouched groups show their base items.
  const [groupEdits, setGroupEdits] = useState<Record<string, HeldItem[]>>({});
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
      const lastNext: Record<string, GroupItem[]> = {};
      for (const g of groups) {
        const wanted = g.options.start === 'last' || groupFields(g).some((f) => f.options.default === 'last');
        if (wanted) lastNext[groupKey(g)] = await lastItems(store, g);
      }
      if (mine === run) {
        setDefaults(next);
        setLast(lastNext);
      }
    };
    load();
    const unsubscribe = store.subscribe(load);
    return () => {
      run = -1;
      unsubscribe();
    };
  }, [panels, groups, store]);

  const base = useMemo(() => Object.fromEntries(groups.map((g) => [groupKey(g), baseItems(g, editing, last[groupKey(g)])])), [groups, editing, last]);
  const itemsOf = useCallback((g: InputGroupPanel) => groupEdits[groupKey(g)] ?? base[groupKey(g)] ?? [], [groupEdits, base]);

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
      group: (g) => groupState(g, itemsOf(g), last[groupKey(g)], checked || groupKey(g) in groupEdits, (update) => {
        setStatus(null);
        setGroupEdits((all) => ({ ...all, [groupKey(g)]: update(all[groupKey(g)] ?? base[groupKey(g)] ?? []) }));
      }),
    };
  }, [edits, saved, defaults, given, store, choices, panels, checked, itemsOf, last, groupEdits, base]);

  const dirty = Object.keys(edits).length + groups.reduce((n, g) => n + groupChanges(base[groupKey(g)] ?? [], groupEdits[groupKey(g)]), 0);

  // Groups that record on this Save: all of them when editing, else those changed or with a field that always records.
  const recordedGroups = useCallback(
    () => groups.filter((g) => editing || groupKey(g) in groupEdits || groupFields(g).some((f) => f.options.record === 'always')),
    [groups, editing, groupEdits],
  );

  const save = useCallback(async () => {
    const problems = panels.flatMap((p) => {
      const problem = inputProblem(p, state.value(p.options.metric));
      return problem ? [`${p.title || p.options.metric}: ${problem.toLowerCase()}`] : [];
    });
    for (const g of recordedGroups()) problems.push(...groupProblems(g, itemsOf(g).map((i) => i.values)));
    if (problems.length) {
      setChecked(true);
      setStatus(problems.length === 1 ? `Can’t save. ${problems[0]}` : `Can’t save: ${problems.length} fields need fixing`);
      return;
    }
    const ts = editing?.[0]?.ts ?? (header !== undefined ? (timestamp?.() ?? Date.now()) : Date.now() + offsetMs);
    const saveId = editing?.find((e) => e.save)?.save ?? newSaveId();
    const entries = [
      ...panels
        .filter((p) => editing || p.options.metric in edits || p.options.record === 'always')
        .flatMap((p) => toEntries(p, state.value(p.options.metric), ts, { save: saveId })),
      ...recordedGroups().flatMap((g) => groupToEntries(g, itemsOf(g).map((i) => i.values), ts, saveId)),
    ];
    if (!entries.length) return;
    const extra = beforeSave ? await beforeSave(ts) : [];
    if (!extra) return;
    const added = editing ? await replace(store, editing.map((e) => e.id), [...entries, ...extra]) : await store.add([...entries, ...extra]);
    setEdits({});
    setGroupEdits({});
    setChecked(false);
    setOffsetMs(0);
    setStatus(`Saved ${added.length} ${added.length === 1 ? 'value' : 'values'}`);
    onSaved?.(added.length, added);
  }, [panels, edits, state, offsetMs, store, onSaved, header, timestamp, beforeSave, editing, recordedGroups, itemsOf]);

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
                    setGroupEdits({});
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

/** Edited fields, plus items added and removed, compared with what the group started from. */
function groupChanges(base: HeldItem[], items: HeldItem[] | undefined): number {
  if (!items) return 0;
  const baseKeys = new Set(base.map((i) => i.key));
  const keys = new Set(items.map((i) => i.key));
  const edited = items.reduce((n, i) => n + (baseKeys.has(i.key) ? i.edited.length : 0), 0);
  const added = items.filter((i) => !baseKeys.has(i.key)).length;
  const removed = base.filter((i) => !keys.has(i.key)).length;
  const moved = edited + added + removed === 0 && items.some((i, n) => base[n]?.key !== i.key) ? 1 : 0;
  return edited + added + removed + moved;
}

/** What an input-group panel gets from the form: its items and the changes it can make to them. */
function groupState(
  group: InputGroupPanel,
  items: HeldItem[],
  last: GroupItem[] | undefined,
  showProblems: boolean,
  update: (change: (items: HeldItem[]) => HeldItem[]) => void,
): FormGroup {
  const fields = groupFields(group);
  const { max } = group.options;
  const fresh = (position: number): HeldItem => ({ key: `n${nextItemKey++}`, values: freshItem(group, position, last), edited: [] });
  const filled = items.filter((i) => !isEmptyItem(group, i.values)).length;
  const { min } = group.options;
  return {
    items: items.map((i) => ({ key: i.key, values: i.values, edited: i.edited })),
    canAdd: typeof max !== 'number' || items.length < max,
    problem: showProblems && typeof min === 'number' && filled < min ? `At least ${min}` : undefined,
    add: () => update((all) => (typeof max === 'number' && all.length >= max ? all : [...all, fresh(all.length)])),
    duplicate: (index) =>
      update((all) =>
        typeof max === 'number' && all.length >= max
          ? all
          : [...all.slice(0, index + 1), { key: `n${nextItemKey++}`, values: { ...all[index].values }, edited: Object.keys(all[index].values) }, ...all.slice(index + 1)],
      ),
    remove: (index) => update((all) => all.filter((_, i) => i !== index)),
    move: (index, by) =>
      update((all) => {
        const to = index + by;
        if (to < 0 || to >= all.length) return all;
        const next = [...all];
        [next[index], next[to]] = [next[to], next[index]];
        return next;
      }),
    setValue: (index, metric, v) =>
      update((all) =>
        all.map((item, i) => (i === index ? { ...item, values: { ...item.values, [metric]: v }, edited: item.edited.includes(metric) ? item.edited : [...item.edited, metric] } : item)),
      ),
    fieldProblem: (index, metric) => {
      const item = items[index];
      const field = fields.find((f) => f.options.metric === metric);
      if (!item || !field || isEmptyItem(group, item.values)) return undefined;
      return showProblems || item.edited.includes(metric) ? inputProblem(field, item.values[metric] ?? null) : undefined;
    },
  };
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
