import { useCallback, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Text as SvgText } from 'react-native-svg';
import { resolveFieldConfig } from '../../core/fieldconfig';
import { fieldDisplayName, toMillis, type DataFrame } from '../../core/frame';
import { formatDisplay, formatValue } from '../../core/format';
import type { LinkData, ResolvedLink } from '../../core/links';
import type { DataLink, FieldConfig, Panel } from '../../core/schema';
import { formatTooltipTime, type ReducedValue } from '../chart';
import { mergeLinks, TooltipLinks } from '../links';
import { useDashTheme } from '../theme';

export interface PanelProps {
  panel: Panel;
  frames: DataFrame[];
  width: number;
  height: number;
}

export function useLayout(): [{ width: number; height: number }, (e: LayoutChangeEvent) => void] {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
  }, []);
  return [size, onLayout];
}

export function Legend({ items }: { items: { key: string; name: string; color: string; value?: string }[] }) {
  const theme = useDashTheme();
  return (
    <View style={styles.legend}>
      {items.map((i) => (
        <View key={i.key} style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: i.color }]} />
          <Text style={[styles.legendText, { color: theme.textSecondary }]} numberOfLines={1}>
            {i.name}
            {i.value != null ? <Text style={{ color: theme.text }}>{`  ${i.value}`}</Text> : null}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Room an axis title takes beside the left axis or below the x tick labels. */
export const AXIS_TITLE_SPACE = 14;

/** A field's `custom.axisLabel`, if it has a non-empty one. */
export const axisTitle = (config: FieldConfig | undefined): string | undefined => (config?.custom?.axisLabel as string | undefined) || undefined;

/**
 * Axis titles for an SVG chart, as Grafana draws them: the y title turned to read upwards along the left edge,
 * the x title centred under the tick labels. `plot` is the plotting area inside the padding.
 */
export function AxisTitles({ x, y, plot, height }: { x?: string; y?: string; plot: { left: number; top: number; width: number; height: number }; height: number }) {
  const theme = useDashTheme();
  const cy = plot.top + plot.height / 2;
  return (
    <>
      {y && (
        <SvgText x={9} y={cy} fontSize={10} fill={theme.textMuted} textAnchor="middle" transform={`rotate(-90 9 ${cy})`}>
          {y}
        </SvgText>
      )}
      {x && (
        <SvgText x={plot.left + plot.width / 2} y={height - 3} fontSize={10} fill={theme.textMuted} textAnchor="middle">
          {x}
        </SvgText>
      )}
    </>
  );
}

export function NoData({ message = 'No data' }: { message?: string }) {
  const theme = useDashTheme();
  return (
    <View style={styles.center}>
      <Text style={{ color: theme.textMuted, fontSize: 13 }}>{message}</Text>
    </View>
  );
}

/** Every field of a row, as Grafana's single-point tooltip shows it, except fields hidden from tooltips. */
export function rowTooltipItems(panel: Panel, frame: DataFrame, row: number, multiple: boolean): { name: string; value: string }[] {
  return frame.fields.flatMap((f) => {
    const name = fieldDisplayName(f, frame, multiple);
    const config = resolveFieldConfig(panel, f, frame, name);
    if ((config.custom?.hideFrom as { tooltip?: boolean } | undefined)?.tooltip) return [];
    const v = f.values[row];
    const value =
      v == null ? '—' : f.type === 'number' ? formatDisplay(Number(v), config) : f.type === 'time' ? formatTooltipTime(toMillis(v)) : String(v);
    return [{ name: config.displayName ?? name, value }];
  });
}

/** Data links of every field in a row, each resolved against that field and row. */
export function rowLinks(
  panel: Panel,
  frame: DataFrame,
  row: number,
  multiple: boolean,
  resolve: (links: DataLink[] | undefined, data?: LinkData) => ResolvedLink[],
): ResolvedLink[] {
  return mergeLinks(
    frame.fields.flatMap((f) => {
      const name = fieldDisplayName(f, frame, multiple);
      const config = resolveFieldConfig(panel, f, frame, name);
      if (!config.links?.length) return [];
      const v = f.values[row];
      const text = v == null ? undefined : f.type === 'number' ? formatDisplay(Number(v), config) : String(v);
      return [{ name: config.displayName ?? name, links: resolve(config.links, { frame, row, field: f, fieldName: config.displayName ?? name, value: v, text }) }];
    }),
  );
}

/** Data links of a stat, gauge or bar gauge value. */
export function valueLinks(panel: Panel, v: ReducedValue, resolve: (links: DataLink[] | undefined, data?: LinkData) => ResolvedLink[]): ResolvedLink[] {
  if (!v.config.links?.length) return [];
  return resolve(v.config.links, {
    frame: v.frame,
    field: v.field,
    fieldName: v.name,
    seriesName: v.name,
    value: v.value,
    text: formatValue(v.value, v.config),
    calc: panel.options?.reduceOptions?.calcs?.[0] ?? 'lastNotNull',
  });
}

/**
 * A tooltip beside the point `at` (panel px), on whichever side has more room in a panel of `size`:
 * a colored dot and title, then name/value rows.
 */
export function RowTooltip({
  at,
  size,
  color,
  title,
  rows,
  links,
  onOpenLink,
}: {
  at: { x: number; y: number };
  size: { width: number; height: number };
  color: string;
  title: string;
  rows: { name: string; value: string }[];
  /** Shown, and tappable, when the tooltip is pinned. */
  links?: ResolvedLink[];
  onOpenLink?(l: ResolvedLink): void;
}) {
  const theme = useDashTheme();
  const tappable = !!links?.length && !!onOpenLink;
  return (
    <View
      pointerEvents={tappable ? 'auto' : 'none'}
      // Taps between the links stay on the tooltip rather than reaching the chart beneath.
      onStartShouldSetResponder={() => tappable}
      style={[
        styles.tooltip,
        { backgroundColor: theme.surface, borderColor: theme.border },
        at.x > size.width / 2 ? { right: size.width - at.x + 12 } : { left: at.x + 12 },
        at.y > size.height / 2 ? { bottom: size.height - at.y } : { top: at.y },
      ]}
    >
      <View style={styles.tooltipHead}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text style={[styles.tooltipTitle, { color: theme.text }]} numberOfLines={1}>
          {title}
        </Text>
      </View>
      {rows.map((r) => (
        <View key={r.name} style={styles.tooltipRow}>
          <Text style={[styles.tooltipName, { color: theme.textSecondary }]} numberOfLines={1}>
            {r.name}
          </Text>
          <Text style={[styles.tooltipValue, { color: theme.text }]}>{r.value}</Text>
        </View>
      ))}
      {tappable && <TooltipLinks links={links!} onOpen={onOpenLink!} />}
    </View>
  );
}

export const showLegend = (panel: Panel, seriesCount: number) =>
  seriesCount >= 2 && panel.options?.legend?.showLegend !== false && panel.options?.legend?.displayMode !== 'hidden';

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingTop: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '100%' },
  swatch: { width: 12, height: 3, borderRadius: 2 },
  legendText: { fontSize: 11, flexShrink: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tooltip: {
    position: 'absolute',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 220,
    minWidth: 140,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  tooltipHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  tooltipTitle: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  tooltipRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tooltipName: { fontSize: 12, flexShrink: 1 },
  tooltipValue: { fontSize: 12, fontWeight: '600', marginLeft: 'auto', paddingLeft: 8 },
});
