import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { groupFields, type InputGroupPanel, type InputValue } from '../../core/inputs';
import { useDashTheme } from '../theme';
import { InputFormContext, useInputForm, type FormGroup, type InputFormState } from './formContext';
import { InputPanelBody } from './InputPanels';

/** Text a value shows as in an item's title. */
function titleText(v: InputValue | undefined): string | undefined {
  if (v == null || v === '') return undefined;
  if (Array.isArray(v)) return v.length ? v.join(', ') : undefined;
  return typeof v === 'boolean' ? undefined : String(v);
}

/**
 * An input-group panel: a card per item with the group's fields, and buttons to add,
 * duplicate, move and remove items. Each item's fields are the ordinary input components,
 * reading and writing that item through a form context of their own.
 */
export function InputGroupBody({ panel }: { panel: InputGroupPanel }) {
  const theme = useDashTheme();
  const form = useInputForm();
  const group = form.group?.(panel);
  if (!group) return null;
  const label = panel.options.itemTitle || 'Item';
  return (
    <ScrollView style={styles.fill} contentContainerStyle={styles.list} nestedScrollEnabled keyboardShouldPersistTaps="handled">
      {group.items.map((item, i) => {
        const named = panel.options.titleFrom ? titleText(item.values[panel.options.titleFrom]) : undefined;
        return <ItemCard key={item.key} panel={panel} group={group} form={form} index={i} title={named ?? `${label} ${i + 1}`} last={i === group.items.length - 1} />;
      })}
      {group.canAdd && (
        <Pressable
          onPress={group.add}
          accessibilityRole="button"
          style={({ pressed }) => [styles.add, { borderColor: theme.accent, opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={{ color: theme.accent, fontWeight: '600' }}>+ {panel.options.addLabel || `Add ${label.toLowerCase()}`}</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

interface ItemCardProps {
  panel: InputGroupPanel;
  group: FormGroup;
  form: InputFormState;
  index: number;
  title: string;
  last: boolean;
}

function ItemCard({ panel, group, form, index, title, last }: ItemCardProps) {
  const theme = useDashTheme();
  const fields = useMemo(() => groupFields(panel), [panel]);
  const item = group.items[index];
  // The item's own form: the input components read and write this item's values.
  const scoped = useMemo<InputFormState>(
    () => ({
      ...form,
      value: (m) => item.values[m] ?? null,
      setValue: (m, v) => group.setValue(index, m, v),
      isDirty: (m) => item.edited.includes(m),
      problem: (m) => group.fieldProblem(index, m),
    }),
    [form, group, index, item],
  );
  const button = (text: string, onPress: () => void, a11y: string, disabled = false) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      hitSlop={6}
      style={({ pressed }) => [styles.iconBtn, { opacity: disabled ? 0.3 : pressed ? 0.6 : 1 }]}
    >
      <Text style={{ color: theme.textSecondary, fontSize: 15 }}>{text}</Text>
    </Pressable>
  );
  return (
    <View style={[styles.item, { borderColor: theme.border }]}>
      <View style={styles.itemHeader}>
        <Text style={[styles.itemTitle, { color: theme.text }]} numberOfLines={1}>
          {title}
        </Text>
        {button('↑', () => group.move(index, -1), `Move ${title} up`, index === 0)}
        {button('↓', () => group.move(index, 1), `Move ${title} down`, last)}
        {button('⧉', () => group.duplicate(index), `Duplicate ${title}`, !group.canAdd)}
        {button('✕', () => group.remove(index), `Remove ${title}`)}
      </View>
      <InputFormContext.Provider value={scoped}>
        <View style={styles.fields}>
          {fields.map((f) => {
            const problem = scoped.problem?.(f.options.metric);
            return (
              <View key={f.options.metric} style={[styles.field, { width: `${(Math.min(24, Math.max(1, f.gridPos.w)) / 24) * 100}%` }]}>
                <View style={styles.fieldHeader}>
                  {!!f.title && (
                    <Text style={[styles.fieldTitle, { color: theme.textSecondary }]} numberOfLines={1}>
                      {f.title}
                    </Text>
                  )}
                  {!!problem && (
                    <Text style={[styles.problem, { color: theme.danger }]} numberOfLines={1} accessibilityRole="alert">
                      {problem}
                    </Text>
                  )}
                </View>
                <View style={styles.fieldBody}>
                  <InputPanelBody panel={f} />
                </View>
              </View>
            );
          })}
        </View>
      </InputFormContext.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { gap: 8, paddingBottom: 4 },
  item: { borderWidth: 1, borderRadius: 8, padding: 8, gap: 6 },
  itemHeader: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  itemTitle: { flex: 1, fontSize: 14, fontWeight: '600' },
  iconBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  fields: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  field: { paddingHorizontal: 4, paddingVertical: 4, gap: 4 },
  fieldHeader: { flexDirection: 'row', gap: 6, alignItems: 'baseline' },
  fieldTitle: { flex: 1, fontSize: 12, fontWeight: '600' },
  problem: { fontSize: 11, fontWeight: '600', flexShrink: 1 },
  fieldBody: { minHeight: 44 },
  add: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
});
