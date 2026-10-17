import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { TIME_PRESETS } from '../core/time';
import { variableOptions, visibleVariables } from '../core/variables';
import { useDashboard } from './context';
import { useDashTheme } from './theme';

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress(): void }) {
  const theme = useDashTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        { borderColor: selected ? theme.accent : theme.border, backgroundColor: selected ? theme.accent : theme.surface },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.chipText, { color: selected ? '#fff' : theme.text }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Time range presets and template variable pickers, laid out in one row above the panels. */
export function DashboardToolbar({ presets = TIME_PRESETS }: { presets?: typeof TIME_PRESETS }) {
  const theme = useDashTheme();
  const { dashboard, rawRange, setRawRange, variables, setVariable } = useDashboard();
  const [open, setOpen] = useState<string | null>(null);
  const vars = visibleVariables(dashboard);
  const openVar = vars.find((v) => v.name === open);
  const label = (name: string) => {
    const v = variables[name];
    return Array.isArray(v) ? (v.length > 1 ? `${v.length} selected` : v[0] ?? '') : v ?? '';
  };

  return (
    <View style={styles.toolbar}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {presets.map((p) => (
          <Chip key={p.label} label={p.label} selected={rawRange.from === p.from && rawRange.to === p.to} onPress={() => setRawRange(p)} />
        ))}
      </ScrollView>
      {vars.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {vars.map((v) => (
            <Chip
              key={v.name}
              label={`${v.label ?? v.name}: ${label(v.name) === '$__all' ? 'All' : label(v.name)}`}
              selected={open === v.name}
              onPress={() => setOpen(open === v.name ? null : v.name)}
            />
          ))}
        </ScrollView>
      )}
      {openVar && (
        <View style={[styles.options, { borderColor: theme.border, backgroundColor: theme.surface }]}>
          {[...(openVar.includeAll ? [{ text: 'All', value: '$__all' }] : []), ...variableOptions(openVar)].map((o) => {
            const current = variables[openVar.name];
            const selected = Array.isArray(current) ? current.includes(o.value) : current === o.value;
            return (
              <Chip
                key={o.value}
                label={o.text}
                selected={selected}
                onPress={() => {
                  if (openVar.multi && o.value !== '$__all') {
                    const cur = (Array.isArray(current) ? current : [current]).filter((c) => c && c !== '$__all');
                    const next = selected ? cur.filter((c) => c !== o.value) : [...cur, o.value];
                    setVariable(openVar.name, next.length ? next : ['$__all']);
                  } else {
                    setVariable(openVar.name, openVar.multi ? [o.value] : o.value);
                    setOpen(null);
                  }
                }}
              />
            );
          })}
          {openVar.type === 'query' && (
            <Text style={[styles.hint, { color: theme.textMuted }]}>Query variables show the options saved in the dashboard JSON.</Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { gap: 8, marginBottom: 4 },
  chips: { gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, maxWidth: 240 },
  chipText: { fontSize: 13, fontWeight: '500' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 8, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  hint: { fontSize: 11, width: '100%' },
});
