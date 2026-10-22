import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { TIME_PRESETS, describeRange } from '../core/time';
import type { TemplateVariable } from '../core/schema';
import { ALL, valueText, visibleVariables } from '../core/variables';
import { useDashboard } from './context';
import { TimeRangeSheet } from './TimeRangeSheet';
import { useDashTheme } from './theme';

export { Chip } from './Chip';

const FilterIcon = ({ color }: { color: string }) => (
  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M3 5h18l-7 8.5V19l-4 2v-7.5L3 5z" />
  </Svg>
);

const CalendarIcon = ({ color }: { color: string }) => (
  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 10h16M8 3v4M16 3v4" />
  </Svg>
);

const ChevronIcon = ({ color, open }: { color: string; open: boolean }) => (
  <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <Path d={open ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
  </Svg>
);

const CheckIcon = ({ color }: { color: string }) => (
  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M5 12.5l4.5 4.5L19 7" />
  </Svg>
);

/** Time range presets as a segmented control, a button for a custom range, and a filter button that opens the template variables in a sheet. */
export function DashboardToolbar({ presets = TIME_PRESETS }: { presets?: typeof TIME_PRESETS }) {
  const theme = useDashTheme();
  const { dashboard, rawRange, setRawRange, variables, variableErrors } = useDashboard();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [rangeKey, setRangeKey] = useState(0);
  const custom = !presets.some((p) => rawRange.from === p.from && rawRange.to === p.to);
  const vars = visibleVariables(dashboard);
  const active = vars.filter((v) => {
    const cur = variables[v.name];
    return v.includeAll && cur != null && !(Array.isArray(cur) ? cur.includes(ALL) : cur === ALL);
  }).length;
  const hasError = vars.some((v) => variableErrors[v.name]);

  return (
    <View style={styles.toolbar}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.segmentScroll}>
        <View style={[styles.segments, { borderColor: theme.border, backgroundColor: theme.surface }]}>
          {presets.map((p) => {
            const selected = rawRange.from === p.from && rawRange.to === p.to;
            return (
              <Pressable
                key={p.label}
                onPress={() => setRawRange(p)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={({ pressed }) => [styles.segment, selected && { backgroundColor: theme.accent }, pressed && { opacity: 0.7 }]}
              >
                <Text style={[styles.segmentText, { color: selected ? '#fff' : theme.textSecondary }]}>{p.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <Pressable
        onPress={() => {
          setRangeKey((k) => k + 1);
          setRangeOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={custom ? `Time range, ${describeRange(rawRange)}` : 'Custom time range'}
        style={({ pressed }) => [
          custom ? styles.rangeButton : styles.iconButton,
          { borderColor: custom ? theme.accent : theme.border, backgroundColor: theme.surface },
          pressed && { opacity: 0.7 },
        ]}
      >
        <CalendarIcon color={custom ? theme.accent : theme.textSecondary} />
        {custom && (
          <Text style={[styles.rangeLabel, { color: theme.accent }]} numberOfLines={1}>
            {describeRange(rawRange)}
          </Text>
        )}
      </Pressable>
      {vars.length > 0 && (
        <Pressable
          onPress={() => setFiltersOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Filters${active ? `, ${active} active` : ''}`}
          style={({ pressed }) => [styles.iconButton, { borderColor: theme.border, backgroundColor: theme.surface }, pressed && { opacity: 0.7 }]}
        >
          <FilterIcon color={active ? theme.accent : theme.textSecondary} />
          {(active > 0 || hasError) && (
            <View style={[styles.badge, { backgroundColor: hasError ? theme.danger : theme.accent, borderColor: theme.background }]}>
              <Text style={styles.badgeText}>{hasError ? '!' : active}</Text>
            </View>
          )}
        </Pressable>
      )}
      <TimeRangeSheet key={rangeKey} visible={rangeOpen} value={rawRange} onApply={setRawRange} onClose={() => setRangeOpen(false)} />
      <FilterSheet vars={vars} visible={filtersOpen} onClose={() => setFiltersOpen(false)} />
    </View>
  );
}

function FilterSheet({ vars, visible, onClose }: { vars: TemplateVariable[]; visible: boolean; onClose(): void }) {
  const theme = useDashTheme();
  const [expanded, setExpanded] = useState<string | null>(vars.length === 1 ? vars[0].name : null);
  // In landscape the sheet goes full screen, so keep clear of the notch and home indicator.
  const insets = useSafeAreaInsets();
  const sides = { paddingLeft: insets.left, paddingRight: insets.right };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      // iOS otherwise forces portrait while the sheet is open.
      supportedOrientations={['portrait', 'landscape']}
      onRequestClose={onClose}
    >
      <View style={[styles.sheet, sides, { backgroundColor: theme.background }]}>
        <View style={[styles.sheetHeader, { borderColor: theme.border }]}>
          <Text style={[styles.sheetTitle, { color: theme.text }]}>Filters</Text>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={8}>
            <Text style={[styles.done, { color: theme.accent }]}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={[styles.sheetBody, { paddingBottom: Math.max(12, insets.bottom) }]}>
          {vars.map((v) => (
            <FilterSection
              key={v.name}
              variable={v}
              open={expanded === v.name}
              onToggle={() => setExpanded(expanded === v.name ? null : v.name)}
            />
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

function FilterSection({ variable: v, open, onToggle }: { variable: TemplateVariable; open: boolean; onToggle(): void }) {
  const theme = useDashTheme();
  const { variables, variableInfo, variableErrors, variablesReady, setVariable } = useDashboard();
  const current = variables[v.name];
  const summary = valueText(current, variableInfo[v.name]) || (variablesReady ? 'None' : '…');
  const options = [...(v.includeAll ? [{ text: 'All', value: ALL }] : []), ...(variableInfo[v.name]?.options ?? [])];
  const error = variableErrors[v.name];

  const choose = (value: string, selected: boolean) => {
    if (v.multi && value !== ALL) {
      const cur = (Array.isArray(current) ? current : [current]).filter((c) => c && c !== ALL);
      const next = selected ? cur.filter((c) => c !== value) : [...cur, value];
      setVariable(v.name, next.length ? next : [ALL]);
    } else {
      setVariable(v.name, v.multi ? [value] : value);
      if (!v.multi) onToggle();
    }
  };

  return (
    <View style={[styles.section, { borderColor: theme.border, backgroundColor: theme.surface }]}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.sectionHeader, pressed && { opacity: 0.7 }]}
      >
        <View style={styles.sectionLabels}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>{v.label ?? v.name}</Text>
          {!open && (
            <Text style={[styles.sectionValue, { color: error ? theme.danger : theme.textMuted }]} numberOfLines={1}>
              {error ? `⚠ ${summary}` : summary}
            </Text>
          )}
        </View>
        <ChevronIcon color={theme.textMuted} open={open} />
      </Pressable>
      {open && (
        <View style={[styles.optionList, { borderColor: theme.border }]}>
          {error && <Text style={[styles.hint, { color: theme.danger }]}>Couldn’t load options: {error}</Text>}
          {!error && !options.length && (
            <Text style={[styles.hint, { color: theme.textMuted }]}>{variablesReady ? 'No options' : 'Loading…'}</Text>
          )}
          {options.map((o, i) => {
            const selected = Array.isArray(current) ? current.includes(o.value) : current === o.value;
            return (
              <Pressable
                key={o.value}
                onPress={() => choose(o.value, selected)}
                accessibilityRole={v.multi ? 'checkbox' : 'radio'}
                accessibilityState={{ checked: selected }}
                style={({ pressed }) => [
                  styles.option,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
                  pressed && { backgroundColor: theme.grid },
                ]}
              >
                <Text style={[styles.optionText, { color: selected ? theme.accent : theme.text }, selected && styles.optionSelected]}>
                  {o.text}
                </Text>
                <View style={styles.check}>{selected && <CheckIcon color={theme.accent} />}</View>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  rangeButton: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 9, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, maxWidth: 200 },
  rangeLabel: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  segmentScroll: { flexGrow: 1, flexShrink: 1 },
  segments: { flexDirection: 'row', padding: 2, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  segment: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, minWidth: 36, alignItems: 'center' },
  segmentText: { fontSize: 13, fontWeight: '600' },
  iconButton: { width: 36, height: 34, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  sheet: { flex: 1 },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: { fontSize: 17, fontWeight: '600' },
  done: { fontSize: 16, fontWeight: '600' },
  sheetBody: { padding: 12, gap: 10 },
  section: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  sectionLabels: { flex: 1, gap: 2 },
  sectionTitle: { fontSize: 15, fontWeight: '600' },
  sectionValue: { fontSize: 13 },
  optionList: { borderTopWidth: StyleSheet.hairlineWidth },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  optionText: { flex: 1, fontSize: 15 },
  optionSelected: { fontWeight: '600' },
  check: { width: 18 },
  hint: { fontSize: 12, paddingHorizontal: 14, paddingVertical: 10 },
});
