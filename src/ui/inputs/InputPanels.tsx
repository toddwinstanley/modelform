import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { entriesSavedWith, formatClock, parseClockDigits, textSuggestions, type Entry, type InputPanel, type InputValue } from '../../core/inputs';
import { startOf } from '../../core/time';
import { Chip } from '../Toolbar';
import { useDashTheme } from '../theme';
import { useLayout } from '../panels/common';
import { useInputForm } from './formContext';

interface InputProps {
  panel: InputPanel;
  value: InputValue;
  onChange(v: InputValue): void;
}

export function InputPanelBody({ panel }: { panel: InputPanel }) {
  const form = useInputForm();
  const metric = panel.options.metric;
  const props: InputProps = { panel, value: form.value(metric), onChange: (v) => form.setValue(metric, v) };
  switch (panel.type) {
    case 'input-number':
      return <NumberInput {...props} />;
    case 'input-slider':
      return <SliderInput {...props} />;
    case 'input-select':
      return <SelectInput {...props} />;
    case 'input-toggle':
      return <ToggleInput {...props} />;
    case 'input-rating':
      return <RatingInput {...props} />;
    case 'input-text':
      return panel.options.suggest ? <SuggestTextInput {...props} /> : <FreeTextInput {...props} />;
    case 'input-counter':
      return <CounterInput panel={panel} />;
    case 'input-duration':
      return <DurationInput {...props} />;
    default:
      return null;
  }
}

const COMPACT_NUMBER_WIDTH = 260;

const decimalsOf = (step: number) => (String(step).split('.')[1] ?? '').length;

function NumberInput({ panel, value, onChange }: InputProps) {
  const theme = useDashTheme();
  const { step = 1, min, max, unit, placeholder } = panel.options;
  const [text, setText] = useState(value == null ? '' : String(value));
  // Half-width cards on a phone (~155pt) leave no room for the value at full size.
  const [size, onLayout] = useLayout();
  const compact = size.width > 0 && size.width < COMPACT_NUMBER_WIDTH;
  // Sync from outside changes (stepper, defaults, reset) without clobbering partial input like "72."
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    setText((t) => (value == null ? '' : Number(t.replace(',', '.')) === value && t.trim() ? t : String(value)));
  }

  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const integer = Number.isInteger(step);
  const signed = min == null || min < 0;
  // decimal-pad has no minus key, so signed fields (e.g. camber) need a keyboard that does.
  const keyboardType = signed
    ? Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric'
    : integer ? 'number-pad' : 'decimal-pad';
  const bump = (dir: number) => {
    const base = typeof value === 'number' ? value : Number(text) || 0;
    onChange(Number(clamp(base + dir * step).toFixed(decimalsOf(step))));
  };

  return (
    <View style={[styles.numberRow, compact && styles.numberRowCompact]} onLayout={onLayout}>
      <StepButton label="−" onPress={() => bump(-1)} compact={compact} />
      <View style={[styles.numberField, compact && styles.numberFieldCompact, { borderColor: theme.border }]}>
        <TextInput
          value={text}
          onChangeText={(t) => {
            setText(t);
            const n = Number(t.replace(',', '.'));
            if (t.trim() && !Number.isNaN(n)) onChange(clamp(integer ? Math.round(n) : n));
            else if (!t.trim()) onChange(null);
          }}
          keyboardType={keyboardType}
          placeholder={placeholder ?? '—'}
          placeholderTextColor={theme.textMuted}
          style={[styles.numberText, compact && styles.numberTextCompact, { color: theme.text }]}
          accessibilityLabel={unit ? `${panel.title} (${unit})` : panel.title}
          selectTextOnFocus
        />
        {/* Too narrow for the unit and the value; put the unit in the panel title instead. */}
        {unit && !compact ? <Text style={[styles.unit, { color: theme.textMuted }]}>{unit}</Text> : null}
      </View>
      <StepButton label="+" onPress={() => bump(1)} compact={compact} />
    </View>
  );
}

/** MM:SS.hh typed as digits only, so the number pad works on every platform. */
function DurationInput({ panel, value, onChange }: InputProps) {
  const theme = useDashTheme();
  const toDigits = (v: InputValue) => (typeof v === 'number' ? formatClock(v).replace(/\D/g, '').replace(/^0+/, '') : '');
  const [digits, setDigits] = useState(toDigits(value));
  // Sync from outside changes (defaults, reset) without clobbering what's being typed.
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    setDigits((d) => (value == null ? (parseClockDigits(d) == null ? d : '') : parseClockDigits(d) === value ? d : toDigits(value)));
  }

  const masked = digits ? maskClock(digits) : '';
  const invalid = !!digits && parseClockDigits(digits) == null;

  return (
    <View style={[styles.numberField, { borderColor: invalid ? theme.danger : theme.border }]}>
      <TextInput
        value={masked}
        onChangeText={(t) => {
          const d = t.replace(/\D/g, '').replace(/^0+/, '').slice(0, 6);
          setDigits(d);
          onChange(parseClockDigits(d));
        }}
        keyboardType="number-pad"
        placeholder={panel.options.placeholder ?? '00:00.00'}
        placeholderTextColor={theme.textMuted}
        style={[styles.numberText, { color: invalid ? theme.danger : theme.text }]}
        accessibilityLabel={panel.title}
        accessibilityHint="Type the digits only, for example 13245 for 1 minute 32.45 seconds"
        // Digits fill from the right, so keep the caret at the end; otherwise reformatting
        // can leave the text selected and the next backspace clears everything.
        selection={{ start: masked.length, end: masked.length }}
      />
    </View>
  );
}

/** "13245" → "01:32.45"; always shows the full mask so the field doesn't jump around. */
function maskClock(digits: string): string {
  const p = digits.slice(-6).padStart(6, '0');
  return `${p.slice(0, 2)}:${p.slice(2, 4)}.${p.slice(4, 6)}`;
}

function StepButton({ label, onPress, compact }: { label: string; onPress(): void; compact?: boolean }) {
  const theme = useDashTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label === '+' ? 'Increase' : 'Decrease'}
      style={({ pressed }) => [styles.stepBtn, compact && styles.stepBtnCompact, { borderColor: theme.border, backgroundColor: pressed ? theme.grid : theme.surface }]}
    >
      <Text style={[styles.stepText, { color: theme.text }]}>{label}</Text>
    </Pressable>
  );
}

function SliderInput({ panel, value, onChange }: InputProps) {
  const theme = useDashTheme();
  const [size, onLayout] = useLayout();
  const { min = 0, max = 10, step = 1, unit, labels } = panel.options;
  const v = typeof value === 'number' ? value : null;
  const toFrac = (x: number) => (x - min) / (max - min || 1);
  const frac = v == null ? 0 : toFrac(v);
  // Ranges that straddle zero (e.g. understeer ← 0 → oversteer) fill outward from zero.
  const origin = min < 0 && max > 0 ? toFrac(0) : 0;
  const fillStart = Math.min(origin, frac);
  // With labels, a value sitting exactly on one reads as that label.
  const labelAt = (x: number) => {
    if (!labels?.length) return undefined;
    const i = labels.length === 1 ? 0 : toFrac(x) * (labels.length - 1);
    return Number.isInteger(Math.round(i * 1e6) / 1e6) ? labels[Math.round(i)] : undefined;
  };
  const display = v == null ? 'Drag to set' : labelAt(v) ?? `${v}${unit ? ` ${unit}` : ''}`;

  const set = (x: number) => {
    if (!size.width) return;
    const raw = min + Math.min(1, Math.max(0, x / size.width)) * (max - min);
    onChange(Number((Math.round((raw - min) / step) * step + min).toFixed(decimalsOf(step))));
  };

  return (
    <View style={styles.sliderWrap}>
      <View style={styles.sliderLabels}>
        {!labels?.length && <Text style={[styles.minmax, { color: theme.textMuted }]}>{min}</Text>}
        <Text style={[styles.sliderValue, { color: theme.text }, !!labels?.length && styles.sliderValueCentered]}>{display}</Text>
        {!labels?.length && <Text style={[styles.minmax, { color: theme.textMuted }]}>{max}</Text>}
      </View>
      <View
        onLayout={onLayout}
        style={styles.sliderHit}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => set(e.nativeEvent.locationX)}
        onResponderMove={(e) => set(e.nativeEvent.locationX)}
        accessibilityRole="adjustable"
        accessibilityValue={{ min, max, now: v ?? undefined, text: v == null ? undefined : display }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) =>
          onChange(Math.min(max, Math.max(min, (v ?? min) + (e.nativeEvent.actionName === 'increment' ? step : -step))))
        }
      >
        <View pointerEvents="none" style={[styles.track, { backgroundColor: theme.grid }]}>
          <View
            style={[
              styles.trackFill,
              { left: `${fillStart * 100}%`, width: `${v == null ? 0 : Math.abs(frac - origin) * 100}%`, backgroundColor: theme.accent },
            ]}
          />
        </View>
        {v != null && (
          <View
            pointerEvents="none"
            style={[styles.thumb, { left: frac * size.width - 11, backgroundColor: theme.accent, borderColor: theme.surface }]}
          />
        )}
      </View>
      {!!labels?.length && (
        <View style={styles.tickRow}>
          {labels.map((l, i) => {
            const last = labels.length - 1;
            const edge = i === 0 ? styles.tickStart : i === last ? styles.tickEnd : { left: `${(i / last) * 100}%` as const };
            return (
              <Text key={i} style={[styles.minmax, styles.tick, edge, { color: theme.textMuted }]} numberOfLines={1}>
                {l}
              </Text>
            );
          })}
        </View>
      )}
    </View>
  );
}

function SelectInput({ panel, value, onChange }: InputProps) {
  const theme = useDashTheme();
  const form = useInputForm();
  const { choicesFrom, multi, placeholder } = panel.options;
  const choices = (choicesFrom ? form.choices[choicesFrom] : panel.options.choices) ?? [];
  const selected = Array.isArray(value) ? value : value == null ? [] : [value as string | number];
  if (!choices.length && placeholder) return <Text style={{ color: theme.textMuted }}>{placeholder}</Text>;
  return (
    <View style={styles.wrap}>
      {choices.map((c) => {
        const on = selected.includes(c.value);
        return (
          <Chip
            key={String(c.value)}
            label={c.label}
            selected={on}
            onPress={() => {
              if (!multi) return onChange(on ? null : c.value);
              const next = on ? selected.filter((s) => s !== c.value) : [...selected, c.value];
              onChange(next.length ? next : null);
            }}
          />
        );
      })}
    </View>
  );
}

function ToggleInput({ panel, value, onChange }: InputProps) {
  const theme = useDashTheme();
  return (
    <View style={styles.toggleRow}>
      <Text style={{ color: theme.textSecondary, flex: 1 }}>{value == null ? 'Not set' : value ? 'Yes' : 'No'}</Text>
      <Switch value={!!value} onValueChange={(v) => onChange(v)} trackColor={{ true: theme.accent }} accessibilityLabel={panel.title} />
    </View>
  );
}

/** More dots than this don't fit a phone's width; a config asking for more gets the first ones. */
const MAX_RATING_LEVELS = 10;

function RatingInput({ panel, value, onChange }: InputProps) {
  const theme = useDashTheme();
  const min = Math.round(panel.options.min ?? 1);
  const max = Math.round(panel.options.max ?? 5);
  const levels = Array.from({ length: Math.min(Math.max(0, max - min + 1), MAX_RATING_LEVELS) }, (_, i) => min + i);
  return (
    <View style={styles.rating}>
      {levels.map((n) => {
        const on = typeof value === 'number' && n <= value;
        return (
          <Pressable
            key={n}
            onPress={() => onChange(value === n ? null : n)}
            accessibilityRole="button"
            accessibilityLabel={`${n} of ${max}`}
            accessibilityState={{ selected: value === n }}
            style={[styles.ratingDot, { borderColor: on ? theme.accent : theme.border, backgroundColor: on ? theme.accent : theme.surface }]}
          >
            <Text style={{ color: on ? '#fff' : theme.textSecondary, fontWeight: '600' }}>{n}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function FreeTextInput({ panel, value, onChange }: InputProps) {
  const theme = useDashTheme();
  return (
    <TextInput
      value={typeof value === 'string' ? value : ''}
      onChangeText={(t) => onChange(t || null)}
      placeholder={panel.options.placeholder ?? 'Type here'}
      placeholderTextColor={theme.textMuted}
      multiline
      style={[styles.textArea, { color: theme.text, borderColor: theme.border }]}
    />
  );
}

/**
 * One line of text with earlier values offered as chips underneath: the most recent
 * ones to start with, then those matching what's typed. Tapping one fills the field.
 */
function SuggestTextInput({ panel, value, onChange }: InputProps) {
  const theme = useDashTheme();
  const form = useInputForm();
  const { metric, suggestWith, placeholder } = panel.options;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [typed, setTyped] = useState(false);
  const text = typeof value === 'string' ? value : '';

  const { store } = form;
  useEffect(() => {
    let run = 0;
    const load = () => {
      const mine = ++run;
      store.list({ metrics: suggestWith ? [metric, suggestWith] : [metric] }).then((rows) => mine === run && setEntries(rows));
    };
    load();
    const unsubscribe = store.subscribe(load);
    return () => {
      run = -1;
      unsubscribe();
    };
  }, [store, metric, suggestWith]);

  const withText = suggestWith ? form.value(suggestWith) : null;
  const own = entries.filter((e) => e.metric === metric);
  const scoped = suggestWith && typeof withText === 'string' && withText.trim() ? entriesSavedWith(entries, metric, suggestWith, withText) : [];
  // Until something's typed, offer the other recent values rather than filtering by the default.
  const query = typed ? text : '';
  const fromScoped = textSuggestions(scoped, query);
  const suggestions = (fromScoped.length ? fromScoped : textSuggestions(own, query)).filter((s) => s.toLowerCase() !== text.trim().toLowerCase());

  return (
    <View style={styles.suggest}>
      <TextInput
        value={text}
        onChangeText={(t) => {
          setTyped(!!t);
          onChange(t || null);
        }}
        placeholder={placeholder ?? 'Type here'}
        placeholderTextColor={theme.textMuted}
        style={[styles.textLine, { color: theme.text, borderColor: theme.border }]}
        accessibilityLabel={panel.title}
        autoCorrect={false}
        autoCapitalize="words"
        returnKeyType="done"
        selectTextOnFocus
      />
      <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.wrap}>
        {suggestions.map((s) => (
          <Chip
            key={s}
            label={s}
            onPress={() => {
              setTyped(false);
              onChange(s);
            }}
          />
        ))}
      </ScrollView>
    </View>
  );
}

/** Records immediately on each tap and shows today's total. */
function CounterInput({ panel }: { panel: InputPanel }) {
  const theme = useDashTheme();
  const { store } = useInputForm();
  const { metric, increment = 1, unit } = panel.options;
  const [today, setToday] = useState(0);

  useEffect(() => {
    const load = () =>
      store
        .list({ metrics: [metric], from: startOf(new Date(), 'd').getTime() })
        .then((rows) => setToday(rows.reduce((a, e) => a + (e.value ?? 0), 0)));
    load();
    return store.subscribe(load);
  }, [store, metric]);

  return (
    <View style={styles.counter}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.counterValue, { color: theme.text }]}>
          {today}
          {unit ? <Text style={{ fontSize: 14, color: theme.textMuted }}>{` ${unit}`}</Text> : null}
        </Text>
        <Text style={{ color: theme.textMuted, fontSize: 12 }}>today</Text>
      </View>
      <Pressable
        onPress={() => store.add([{ metric, ts: Date.now(), value: increment, text: null }])}
        accessibilityRole="button"
        accessibilityLabel={`Add ${increment}`}
        style={({ pressed }) => [styles.counterBtn, { backgroundColor: theme.accent, opacity: pressed ? 0.8 : 1 }]}
      >
        <Text style={styles.counterBtnText}>+{increment}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  numberRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  numberField: { flex: 1, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, height: 44 },
  // Android gives TextInput default padding that eats into narrow fields.
  numberText: { flex: 1, minWidth: 0, width: '100%', paddingHorizontal: 0, paddingVertical: 0, fontSize: 20, fontWeight: '600', fontVariant: ['tabular-nums'], textAlign: 'center' },
  unit: { fontSize: 14 },
  numberRowCompact: { gap: 4 },
  numberFieldCompact: { paddingHorizontal: 4 },
  numberTextCompact: { fontSize: 17 },
  stepBtnCompact: { width: 32 },
  stepBtn: { width: 44, height: 44, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 22, fontWeight: '500' },
  sliderWrap: { flex: 1, justifyContent: 'center', gap: 6 },
  sliderLabels: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  minmax: { fontSize: 11 },
  sliderValue: { fontSize: 16, fontWeight: '600' },
  sliderValueCentered: { flex: 1, textAlign: 'center' },
  tickRow: { height: 14 },
  // Middle labels are centred on their point along the track; the ends hug the edges.
  tick: { position: 'absolute', width: 120, marginLeft: -60, textAlign: 'center' },
  tickStart: { left: 0, marginLeft: 0, textAlign: 'left' },
  tickEnd: { right: 0, marginLeft: 0, textAlign: 'right' },
  sliderHit: { height: 32, justifyContent: 'center' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  trackFill: { position: 'absolute', height: '100%' },
  thumb: { position: 'absolute', width: 22, height: 22, borderRadius: 11, borderWidth: 2, top: 5 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  toggleRow: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  rating: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  ratingDot: { flex: 1, maxWidth: 52, aspectRatio: 1, borderRadius: 26, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  suggest: { flex: 1, gap: 8 },
  textLine: { height: 44, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 0, fontSize: 16 },
  textArea: { flex: 1, borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 15, textAlignVertical: 'top' },
  counter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  counterValue: { fontSize: 28, fontWeight: '600', fontVariant: ['tabular-nums'] },
  counterBtn: { paddingHorizontal: 20, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  counterBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
