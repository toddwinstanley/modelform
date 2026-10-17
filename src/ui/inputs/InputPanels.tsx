import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { InputPanel, InputValue } from '../../core/inputs';
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
      return <FreeTextInput {...props} />;
    case 'input-counter':
      return <CounterInput panel={panel} />;
    default:
      return null;
  }
}

const decimalsOf = (step: number) => (String(step).split('.')[1] ?? '').length;

function NumberInput({ panel, value, onChange }: InputProps) {
  const theme = useDashTheme();
  const { step = 1, min, max, unit, placeholder } = panel.options;
  const [text, setText] = useState(value == null ? '' : String(value));
  // Sync from outside changes (stepper, defaults, reset) without clobbering partial input like "72."
  useEffect(() => {
    setText((t) => (value == null ? '' : Number(t.replace(',', '.')) === value && t.trim() ? t : String(value)));
  }, [value]);

  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const bump = (dir: number) => {
    const base = typeof value === 'number' ? value : Number(text) || 0;
    onChange(Number(clamp(base + dir * step).toFixed(decimalsOf(step))));
  };

  return (
    <View style={styles.numberRow}>
      <StepButton label="−" onPress={() => bump(-1)} />
      <View style={[styles.numberField, { borderColor: theme.border }]}>
        <TextInput
          value={text}
          onChangeText={(t) => {
            setText(t);
            const n = Number(t.replace(',', '.'));
            if (t.trim() && !Number.isNaN(n)) onChange(clamp(n));
            else if (!t.trim()) onChange(null);
          }}
          keyboardType="decimal-pad"
          placeholder={placeholder ?? '—'}
          placeholderTextColor={theme.textMuted}
          style={[styles.numberText, { color: theme.text }]}
          selectTextOnFocus
        />
        {unit ? <Text style={[styles.unit, { color: theme.textMuted }]}>{unit}</Text> : null}
      </View>
      <StepButton label="+" onPress={() => bump(1)} />
    </View>
  );
}

function StepButton({ label, onPress }: { label: string; onPress(): void }) {
  const theme = useDashTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label === '+' ? 'Increase' : 'Decrease'}
      style={({ pressed }) => [styles.stepBtn, { borderColor: theme.border, backgroundColor: pressed ? theme.grid : theme.surface }]}
    >
      <Text style={[styles.stepText, { color: theme.text }]}>{label}</Text>
    </Pressable>
  );
}

function SliderInput({ panel, value, onChange }: InputProps) {
  const theme = useDashTheme();
  const [size, onLayout] = useLayout();
  const { min = 0, max = 10, step = 1, unit } = panel.options;
  const v = typeof value === 'number' ? value : null;
  const frac = v == null ? 0 : (v - min) / (max - min || 1);

  const set = (x: number) => {
    if (!size.width) return;
    const raw = min + Math.min(1, Math.max(0, x / size.width)) * (max - min);
    onChange(Number((Math.round((raw - min) / step) * step + min).toFixed(decimalsOf(step))));
  };

  return (
    <View style={styles.sliderWrap}>
      <View style={styles.sliderLabels}>
        <Text style={[styles.minmax, { color: theme.textMuted }]}>{min}</Text>
        <Text style={[styles.sliderValue, { color: theme.text }]}>
          {v == null ? 'Drag to set' : `${v}${unit ? ` ${unit}` : ''}`}
        </Text>
        <Text style={[styles.minmax, { color: theme.textMuted }]}>{max}</Text>
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
        accessibilityValue={{ min, max, now: v ?? undefined }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) =>
          onChange(Math.min(max, Math.max(min, (v ?? min) + (e.nativeEvent.actionName === 'increment' ? step : -step))))
        }
      >
        <View pointerEvents="none" style={[styles.track, { backgroundColor: theme.grid }]}>
          <View style={[styles.trackFill, { width: `${frac * 100}%`, backgroundColor: theme.accent }]} />
        </View>
        {v != null && (
          <View
            pointerEvents="none"
            style={[styles.thumb, { left: frac * size.width - 11, backgroundColor: theme.accent, borderColor: theme.surface }]}
          />
        )}
      </View>
    </View>
  );
}

function SelectInput({ panel, value, onChange }: InputProps) {
  const { choices = [], multi } = panel.options;
  const selected = Array.isArray(value) ? value : value == null ? [] : [value as string | number];
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

function RatingInput({ panel, value, onChange }: InputProps) {
  const theme = useDashTheme();
  const { min = 1, max = 5 } = panel.options;
  const levels = Array.from({ length: max - min + 1 }, (_, i) => min + i);
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
  numberText: { flex: 1, minWidth: 0, width: '100%', fontSize: 20, fontWeight: '600', fontVariant: ['tabular-nums'], textAlign: 'center' },
  unit: { fontSize: 14 },
  stepBtn: { width: 44, height: 44, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 22, fontWeight: '500' },
  sliderWrap: { flex: 1, justifyContent: 'center', gap: 6 },
  sliderLabels: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  minmax: { fontSize: 11 },
  sliderValue: { fontSize: 16, fontWeight: '600' },
  sliderHit: { height: 32, justifyContent: 'center' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  trackFill: { height: '100%' },
  thumb: { position: 'absolute', width: 22, height: 22, borderRadius: 11, borderWidth: 2, top: 5 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  toggleRow: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  rating: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  ratingDot: { flex: 1, maxWidth: 52, aspectRatio: 1, borderRadius: 26, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  textArea: { flex: 1, borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 15, textAlignVertical: 'top' },
  counter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  counterValue: { fontSize: 28, fontWeight: '600', fontVariant: ['tabular-nums'] },
  counterBtn: { paddingHorizontal: 20, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  counterBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
