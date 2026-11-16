import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { formatClock, groupFields, isEmptyItem, type InputGroupPanel, type InputPanel, type InputValue } from '../../core/inputs';
import { useDashTheme } from '../theme';
import { InputFormContext, useInputForm, type FormGroup, type InputFormState } from './formContext';
import { InputPanelBody } from './InputPanels';

/** Text a value shows as in an item's title. */
function titleText(v: InputValue | undefined): string | undefined {
  if (v == null || v === '') return undefined;
  if (Array.isArray(v)) return v.length ? v.join(', ') : undefined;
  return typeof v === 'boolean' ? undefined : String(v);
}

/** A field's value as a collapsed card's summary shows it: "100 kg", "Yes", "01:32.45". */
function summaryText(f: InputPanel, v: InputValue | undefined): string | undefined {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return undefined;
  if (f.type === 'input-toggle') return v ? f.title || 'Yes' : undefined;
  if (f.type === 'input-duration' && typeof v === 'number') return formatClock(v);
  if (f.type === 'input-select' && f.options.choices) {
    const label = (x: number | string) => f.options.choices!.find((c) => c.value === x)?.label ?? String(x);
    return Array.isArray(v) ? v.map(label).join(', ') : label(v as number | string);
  }
  const text = Array.isArray(v) ? v.join(', ') : String(v);
  return f.options.unit ? `${text} ${f.options.unit}` : text;
}

/** Space between cards, which a dragged card has to cross along with its neighbour's height. */
const GAP = 8;

/** The card being dragged: which item, where it started, and how far the pointer has moved. */
interface Drag {
  key: string;
  from: number;
  startY: number;
  dy: number;
}

/**
 * Where a card dragged `dy` from position `from` would land: past half of each neighbour it
 * crosses, it takes that neighbour's place.
 */
function dropIndex(from: number, dy: number, keys: string[], span: (key: string) => number): number {
  let to = from;
  let left = dy;
  while (left > 0 && to < keys.length - 1 && left > span(keys[to + 1]) / 2) left -= span(keys[++to]);
  while (left < 0 && to > 0 && -left > span(keys[to - 1]) / 2) left += span(keys[--to]);
  return to;
}

/**
 * An input-group panel: a card per item with the group's fields, and buttons to add,
 * duplicate, move and remove items. Each item's fields are the ordinary input components,
 * reading and writing that item through a form context of their own.
 *
 * A card's title collapses it to a one-line summary; adding or duplicating an item
 * collapses the other filled ones, and a card with a problem stays open. The handle (≡)
 * drags a card past its neighbours to reorder.
 */
export function InputGroupBody({ panel }: { panel: InputGroupPanel }) {
  const theme = useDashTheme();
  const form = useInputForm();
  const group = form.group?.(panel);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [drag, setDrag] = useState<Drag | null>(null);
  const [heights, setHeights] = useState<Record<string, number>>({});
  // The drag as the responder handlers see it, updated as events arrive rather than on render.
  const dragging = useRef<Drag | null>(null);
  // A save or discard starts the group afresh, with every card open.
  const [wasEdited, setWasEdited] = useState(group?.edited);
  if (group && group.edited !== wasEdited) {
    setWasEdited(group.edited);
    if (!group.edited) setCollapsed(new Set());
  }
  if (!group) return null;
  const label = panel.options.itemTitle || 'Item';

  const collapseFilled = (except?: string) =>
    setCollapsed(new Set(group.items.filter((i) => i.key !== except && !isEmptyItem(panel, i.values)).map((i) => i.key)));
  const toggle = (key: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const setDragging = (d: Drag | null) => {
    dragging.current = d;
    setDrag(d);
  };
  const span = (key: string) => (heights[key] ?? 0) + GAP;
  const keys = group.items.map((i) => i.key);
  // The list keeps its order while a card is dragged (reordering it mid-gesture can end the
  // gesture on the web); the card and the ones it passes are shifted, and the move is made on release.
  const startDrag = (key: string, e: GestureResponderEvent) => setDragging({ key, from: keys.indexOf(key), startY: e.nativeEvent.pageY, dy: 0 });
  const moveDrag = (e: GestureResponderEvent) => {
    const d = dragging.current;
    if (d) setDragging({ ...d, dy: e.nativeEvent.pageY - d.startY });
  };
  const dropDrag = () => {
    const d = dragging.current;
    setDragging(null);
    if (!d) return;
    const to = dropIndex(d.from, d.dy, keys, span);
    for (let i = d.from; i !== to; i += to > i ? 1 : -1) group.move(i, to > i ? 1 : -1);
  };
  const endDrag = () => setDragging(null);
  const to = drag ? dropIndex(drag.from, drag.dy, keys, span) : -1;
  /** How far a card is shifted while another is dragged: the dragged card follows the pointer, the ones it passes make room. */
  const shift = (i: number, key: string): number | undefined => {
    if (!drag) return undefined;
    if (key === drag.key) return drag.dy;
    const room = span(drag.key);
    if (drag.from < i && i <= to) return -room;
    if (to <= i && i < drag.from) return room;
    return 0;
  };

  return (
    <ScrollView style={styles.fill} contentContainerStyle={styles.list} nestedScrollEnabled keyboardShouldPersistTaps="handled" scrollEnabled={!drag}>
      {group.items.map((item, i) => {
        const named = panel.options.titleFrom ? titleText(item.values[panel.options.titleFrom]) : undefined;
        const title = named ?? `${label} ${i + 1}`;
        const troubled = groupFields(panel).some((f) => group.fieldProblem(i, f.options.metric));
        return (
          <ItemCard
            key={item.key}
            panel={panel}
            group={group}
            form={form}
            index={i}
            title={title}
            last={i === group.items.length - 1}
            collapsed={collapsed.has(item.key) && !troubled}
            onToggle={() => toggle(item.key)}
            onDuplicate={() => {
              collapseFilled();
              group.duplicate(i);
            }}
            dragOffset={shift(i, item.key)}
            lifted={drag?.key === item.key}
            onLayout={(h) => setHeights((all) => (all[item.key] === h ? all : { ...all, [item.key]: h }))}
            handle={{
              onStartShouldSetResponder: () => true,
              onMoveShouldSetResponder: () => true,
              onResponderTerminationRequest: () => false,
              onResponderGrant: (e) => startDrag(item.key, e),
              onResponderMove: moveDrag,
              onResponderRelease: dropDrag,
              onResponderTerminate: endDrag,
            }}
          />
        );
      })}
      {group.canAdd && (
        <Pressable
          onPress={() => {
            collapseFilled();
            group.add();
          }}
          accessibilityRole="button"
          style={({ pressed }) => [styles.add, { borderColor: theme.accent, opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={{ color: theme.accent, fontWeight: '600' }}>+ {panel.options.addLabel || `Add ${label.toLowerCase()}`}</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

/** Responder props for a card's drag handle. */
interface HandleProps {
  onStartShouldSetResponder(): boolean;
  onMoveShouldSetResponder(): boolean;
  onResponderTerminationRequest(): boolean;
  onResponderGrant(e: GestureResponderEvent): void;
  onResponderMove(e: GestureResponderEvent): void;
  onResponderRelease(): void;
  onResponderTerminate(): void;
}

interface ItemCardProps {
  panel: InputGroupPanel;
  group: FormGroup;
  form: InputFormState;
  index: number;
  title: string;
  last: boolean;
  collapsed: boolean;
  onToggle(): void;
  onDuplicate(): void;
  /** How far the card is shifted from its place while a card is dragged. */
  dragOffset?: number;
  /** Whether this is the card being dragged. */
  lifted?: boolean;
  onLayout(height: number): void;
  handle: HandleProps;
}

function ItemCard({ panel, group, form, index, title, last, collapsed, onToggle, onDuplicate, dragOffset, lifted, onLayout, handle }: ItemCardProps) {
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
  const summary = collapsed
    ? fields
        .filter((f) => f.options.metric !== panel.options.titleFrom)
        .map((f) => summaryText(f, item.values[f.options.metric]))
        .filter(Boolean)
        .join(' · ')
    : '';
  return (
    <View
      onLayout={(e) => onLayout(e.nativeEvent.layout.height)}
      style={[
        styles.item,
        { borderColor: lifted ? theme.accent : theme.border, backgroundColor: theme.surface },
        !!dragOffset && { transform: [{ translateY: dragOffset }] },
        lifted && { zIndex: 1, opacity: 0.95 },
      ]}
    >
      <View style={styles.itemHeader}>
        <View {...handle} style={styles.handle} accessibilityLabel={`Drag ${title} to reorder`}>
          <Text style={{ color: theme.textMuted, fontSize: 16 }}>≡</Text>
        </View>
        <Pressable onPress={onToggle} style={styles.titleArea} accessibilityRole="button" accessibilityLabel={`${collapsed ? 'Expand' : 'Collapse'} ${title}`} accessibilityState={{ expanded: !collapsed }}>
          <Text style={[styles.itemTitle, { color: theme.text }]} numberOfLines={1}>
            {collapsed ? '▸ ' : '▾ '}
            {title}
          </Text>
          {!!summary && (
            <Text style={[styles.summary, { color: theme.textSecondary }]} numberOfLines={1}>
              {summary}
            </Text>
          )}
        </Pressable>
        {button('↑', () => group.move(index, -1), `Move ${title} up`, index === 0)}
        {button('↓', () => group.move(index, 1), `Move ${title} down`, last)}
        {button('⧉', onDuplicate, `Duplicate ${title}`, !group.canAdd)}
        {button('✕', () => group.remove(index), `Remove ${title}`)}
      </View>
      {!collapsed && (
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
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { gap: 8, paddingBottom: 4 },
  item: { borderWidth: 1, borderRadius: 8, padding: 8, gap: 6 },
  itemHeader: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  titleArea: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 8, minHeight: 28, paddingVertical: 4 },
  itemTitle: { fontSize: 14, fontWeight: '600', flexShrink: 0, maxWidth: '60%' },
  summary: { flex: 1, fontSize: 13 },
  // Web: no text selection or page scroll from dragging the handle.
  handle: { width: 24, height: 28, alignItems: 'center', justifyContent: 'center', cursor: 'grab', userSelect: 'none', touchAction: 'none' } as object,
  iconBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  fields: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  field: { paddingHorizontal: 4, paddingVertical: 4, gap: 4 },
  fieldHeader: { flexDirection: 'row', gap: 6, alignItems: 'baseline' },
  fieldTitle: { flex: 1, fontSize: 12, fontWeight: '600' },
  problem: { fontSize: 11, fontWeight: '600', flexShrink: 1 },
  fieldBody: { minHeight: 44 },
  add: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
});
