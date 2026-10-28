import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { RELATIVE_RANGES, formatLocalDateTime, parseTime, timeExprError } from '../core/time';
import { useDashTheme } from './theme';
import { Chip } from './Chip';

type Raw = { from: string; to: string };
type Field = 'from' | 'to';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const ArrowIcon = ({ color, dir }: { color: string; dir: 'left' | 'right' }) => (
  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <Path d={dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
  </Svg>
);

/** Absolute times show in local "YYYY-MM-DD HH:mm:ss"; relative ones like now-7d stay as typed. */
function displayExpr(expr: string): string {
  if (expr.trim().startsWith('now')) return expr;
  try {
    return formatLocalDateTime(parseTime(expr));
  } catch {
    return expr;
  }
}

function tryParse(expr: string, roundUp: boolean, now = Date.now()): number | null {
  try {
    return parseTime(expr, now, roundUp);
  } catch {
    return null;
  }
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** The last second of the day, by calendar rather than +24h so DST changeover days come out right. */
function endOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - 1000;
}

/** A bare date in "To" means through the end of that day, so 2026-03-01 to 2026-03-05 covers five days. */
function resolveTo(expr: string): string {
  return /^\s*\d{4}-\d{1,2}-\d{1,2}\s*$/.test(expr) ? formatLocalDateTime(endOfDay(parseTime(expr))) : expr;
}

/**
 * Custom time range: From/To fields that take a date or a Grafana relative expression, a month
 * calendar to fill them by tapping days, and more relative ranges than fit in the toolbar.
 */
export function TimeRangeSheet({ visible, value, onApply, onClose }: { visible: boolean; value: Raw; onApply(r: Raw): void; onClose(): void }) {
  const theme = useDashTheme();
  const insets = useSafeAreaInsets();
  // The toolbar remounts the sheet each time it opens, so the fields start from the current range.
  const [from, setFrom] = useState(() => displayExpr(value.from));
  const [to, setTo] = useState(() => displayExpr(value.to));
  const [active, setActive] = useState<Field>('from');
  const [now] = useState(() => Date.now());
  const [month, setMonth] = useState(() => new Date(tryParse(value.from, false) ?? now));

  const fromMs = tryParse(from, false, now);
  const toMs = tryParse(timeExprError(to) ? to : resolveTo(to), true, now);
  const fromError = timeExprError(from);
  const toError = timeExprError(to);
  const orderError = fromMs != null && toMs != null && fromMs >= toMs ? '“To” must be after “From”' : null;
  const valid = !fromError && !toError && !orderError;

  const normalize = (expr: string) => (expr.trim().startsWith('now') ? expr.trim() : formatLocalDateTime(parseTime(expr)));
  const apply = () => {
    if (!valid) return;
    onApply({ from: normalize(from), to: normalize(resolveTo(to)) });
    onClose();
  };

  const pickDay = (day: number) => {
    const end = endOfDay(day);
    if (active === 'from') {
      setFrom(formatLocalDateTime(day));
      // Keep the range valid: a start after the current end collapses it to that one day.
      if (toMs == null || toMs <= day) setTo(formatLocalDateTime(end));
      setActive('to');
    } else if (fromMs != null && day < startOfDay(fromMs)) {
      // Tapping before the start begins a new range there instead of producing an inverted one.
      setFrom(formatLocalDateTime(day));
      setTo(formatLocalDateTime(end));
    } else {
      setTo(formatLocalDateTime(end));
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      supportedOrientations={['portrait', 'landscape']}
      onRequestClose={onClose}
    >
      <View style={[styles.sheet, { paddingLeft: insets.left, paddingRight: insets.right, backgroundColor: theme.background }]}>
        <View style={[styles.header, { borderColor: theme.border }]}>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={8}>
            <Text style={[styles.headerButton, { color: theme.accent }]}>Cancel</Text>
          </Pressable>
          <Text style={[styles.title, { color: theme.text }]}>Time range</Text>
          <Pressable onPress={apply} disabled={!valid} accessibilityRole="button" accessibilityState={{ disabled: !valid }} hitSlop={8}>
            <Text style={[styles.headerButton, styles.apply, { color: valid ? theme.accent : theme.textMuted }]}>Apply</Text>
          </Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.body, { paddingBottom: Math.max(16, insets.bottom) }]}>
          <View style={styles.fields}>
            <TimeField label="From" value={from} onChange={setFrom} active={active === 'from'} onFocus={() => setActive('from')} onBlur={() => fromMs != null && setMonth(new Date(fromMs))} error={fromError} />
            <TimeField label="To" value={to} onChange={setTo} active={active === 'to'} onFocus={() => setActive('to')} onBlur={() => toMs != null && setMonth(new Date(toMs))} error={toError} />
          </View>
          {orderError && <Text style={[styles.error, { color: theme.danger }]}>{orderError}</Text>}
          <Text style={[styles.hint, { color: theme.textMuted }]}>
            Tap days below, or type a date (2026-03-01 14:00) or a relative time (now-7d, now/M).
          </Text>

          <Calendar
            month={month}
            onMonth={setMonth}
            from={fromMs}
            to={toMs}
            today={startOfDay(now)}
            onPick={pickDay}
          />

          <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>Relative ranges</Text>
          <View style={styles.chips}>
            {RELATIVE_RANGES.map((r) => (
              <Chip
                key={r.label}
                label={r.label}
                selected={value.from === r.from && value.to === r.to}
                onPress={() => {
                  onApply({ from: r.from, to: r.to });
                  onClose();
                }}
              />
            ))}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function TimeField({
  label,
  value,
  onChange,
  active,
  onFocus,
  onBlur,
  error,
}: {
  label: string;
  value: string;
  onChange(v: string): void;
  active: boolean;
  onFocus(): void;
  onBlur(): void;
  error: string | null;
}) {
  const theme = useDashTheme();
  const showError = error && value.trim() !== '';
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        onFocus={onFocus}
        onBlur={onBlur}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        placeholder="now-7d"
        placeholderTextColor={theme.textMuted}
        accessibilityLabel={label}
        style={[
          styles.input,
          { color: theme.text, backgroundColor: theme.surface, borderColor: showError ? theme.danger : active ? theme.accent : theme.border },
          active && styles.inputActive,
        ]}
      />
      {showError && <Text style={[styles.error, { color: theme.danger }]}>{error}</Text>}
    </View>
  );
}

/** A month of days to pick from; `from`..`to` are highlighted (pass the same day for one). */
export function Calendar({
  month,
  onMonth,
  from,
  to,
  today,
  onPick,
}: {
  month: Date;
  onMonth(d: Date): void;
  from: number | null;
  to: number | null;
  today: number;
  onPick(dayStart: number): void;
}) {
  const theme = useDashTheme();
  const year = month.getFullYear();
  const m = month.getMonth();
  const first = new Date(year, m, 1);
  const daysInMonth = new Date(year, m + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: first.getDay() }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, m, i + 1).getTime()),
  ];
  while (cells.length % 7) cells.push(null);
  const fromDay = from != null ? startOfDay(from) : null;
  const toDay = to != null ? startOfDay(to) : null;

  return (
    <View style={[styles.calendar, { borderColor: theme.border, backgroundColor: theme.surface }]}>
      <View style={styles.monthRow}>
        <Pressable onPress={() => onMonth(new Date(year, m - 1, 1))} accessibilityRole="button" accessibilityLabel="Previous month" hitSlop={8} style={styles.monthButton}>
          <ArrowIcon color={theme.textSecondary} dir="left" />
        </Pressable>
        <Text style={[styles.monthTitle, { color: theme.text }]}>
          {MONTHS[m]} {year}
        </Text>
        <Pressable onPress={() => onMonth(new Date(year, m + 1, 1))} accessibilityRole="button" accessibilityLabel="Next month" hitSlop={8} style={styles.monthButton}>
          <ArrowIcon color={theme.textSecondary} dir="right" />
        </Pressable>
      </View>
      <View style={styles.week}>
        {WEEKDAYS.map((d, i) => (
          <Text key={i} style={[styles.weekday, { color: theme.textMuted }]}>
            {d}
          </Text>
        ))}
      </View>
      {Array.from({ length: cells.length / 7 }, (_, row) => (
        <View key={row} style={styles.week}>
          {cells.slice(row * 7, row * 7 + 7).map((day, i) => {
            if (day == null) return <View key={i} style={styles.day} />;
            const isEnd = day === fromDay || day === toDay;
            const inRange = fromDay != null && toDay != null && day > fromDay && day < toDay;
            return (
              <Pressable
                key={i}
                onPress={() => onPick(day)}
                accessibilityRole="button"
                accessibilityState={{ selected: isEnd || inRange }}
                accessibilityLabel={new Date(day).toDateString()}
                style={({ pressed }) => [styles.day, inRange && { backgroundColor: theme.grid }, pressed && { opacity: 0.6 }]}
              >
                <View style={[styles.dayInner, isEnd && { backgroundColor: theme.accent }, !isEnd && day === today && { borderColor: theme.accent, borderWidth: 1 }]}>
                  <Text style={[styles.dayText, { color: isEnd ? '#fff' : theme.text }, isEnd && styles.dayTextSelected]}>{new Date(day).getDate()}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 17, fontWeight: '600' },
  headerButton: { fontSize: 16 },
  apply: { fontWeight: '600' },
  body: { padding: 16, gap: 12 },
  fields: { flexDirection: 'row', gap: 10 },
  field: { flex: 1, gap: 4 },
  fieldLabel: { fontSize: 13, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9, fontSize: 14, fontVariant: ['tabular-nums'] },
  inputActive: { borderWidth: 1.5 },
  error: { fontSize: 12 },
  hint: { fontSize: 12 },
  sectionTitle: { fontSize: 13, fontWeight: '600', marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  calendar: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 10, maxWidth: 420, width: '100%', alignSelf: 'center' },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  monthButton: { padding: 6 },
  monthTitle: { fontSize: 15, fontWeight: '600' },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '600', paddingVertical: 4 },
  day: { flex: 1, aspectRatio: 1, maxHeight: 44, alignItems: 'center', justifyContent: 'center' },
  dayInner: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  dayText: { fontSize: 14, fontVariant: ['tabular-nums'] },
  dayTextSelected: { fontWeight: '700' },
});
