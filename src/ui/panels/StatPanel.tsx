import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { linearScale, reducedValues, type ReducedValue } from '../chart';
import { usePanelLinks } from '../context';
import { useDashTheme } from '../theme';
import { NoData, useLayout, valueLinks, type PanelProps } from './common';

/**
 * Grafana "stat": one big number per series. Threshold color is shown as an accent bar
 * (and a tinted background in colorMode "background") rather than on the text itself,
 * so the value stays legible whatever the threshold color is.
 */
export function StatPanel({ panel, frames }: PanelProps) {
  const theme = useDashTheme();
  const values = useMemo(() => reducedValues(panel, frames, theme.scheme), [panel, frames, theme.scheme]);
  if (!values.length) return <NoData />;
  const horizontal = panel.options?.orientation === 'horizontal';
  return (
    <View style={[styles.grid, { flexDirection: horizontal ? 'column' : 'row' }]}>
      {values.map((v) => (
        <StatTile key={v.key} v={v} showName={values.length > 1} panel={panel} />
      ))}
    </View>
  );
}

function StatTile({ v, showName, panel }: { v: ReducedValue; showName: boolean; panel: PanelProps['panel'] }) {
  const theme = useDashTheme();
  const [size, onLayout] = useLayout();
  const colorMode = panel.options?.colorMode ?? 'value';
  const graph = (panel.options?.graphMode ?? 'area') === 'area' && v.sparkline.filter((x) => x != null).length > 1;
  const fontSize = Math.max(18, Math.min(56, size.height * (graph ? 0.4 : 0.5), size.width / 4.5));
  const { resolve, openLinks } = usePanelLinks(panel);
  const hasLinks = !!v.config.links?.length;

  return (
    <Pressable
      onLayout={onLayout}
      disabled={!hasLinks}
      onPress={() => openLinks(valueLinks(panel, v, resolve), v.name)}
      accessibilityRole={hasLinks ? 'link' : undefined}
      style={({ pressed }) => [
        styles.tile,
        // With a sparkline, the number sits in the top half so the line runs beneath it.
        graph && { justifyContent: 'flex-start', paddingTop: 4 },
        colorMode === 'background' && { backgroundColor: withAlpha(v.stateColor, 0.14) },
        pressed && { opacity: 0.7 },
      ]}
    >
      {colorMode !== 'none' && <View style={[styles.accent, { backgroundColor: v.stateColor }]} />}
      {graph && size.width > 0 && <Sparkline values={v.sparkline} width={size.width} height={size.height * 0.4} color={v.stateColor} />}
      {showName && (
        <Text style={[styles.name, { color: theme.textSecondary }]} numberOfLines={1}>
          {v.name}
        </Text>
      )}
      <Text style={[styles.value, { color: theme.text, fontSize }]} numberOfLines={1} adjustsFontSizeToFit>
        {v.text}
      </Text>
    </Pressable>
  );
}

export function Sparkline({ values, width, height, color }: { values: (number | null)[]; width: number; height: number; color: string }) {
  const nums = values.filter((v): v is number => v != null);
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const x = linearScale(0, Math.max(values.length - 1, 1), 0, width);
  const y = linearScale(min, max === min ? min + 1 : max, height - 2, 2);
  let line = '';
  values.forEach((v, i) => {
    if (v != null) line += `${line ? 'L' : 'M'}${x(i)},${y(v)}`;
  });
  return (
    <Svg width={width} height={height} style={styles.spark}>
      <Path d={`${line}L${width},${height}L0,${height}Z`} fill={color} opacity={0.1} />
      <Path d={line} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" />
    </Svg>
  );
}

export function withAlpha(hex: string, alpha: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  return `${hex}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  grid: { flex: 1, gap: 8 },
  tile: { flex: 1, justifyContent: 'center', paddingLeft: 12, borderRadius: 6, overflow: 'hidden' },
  accent: { position: 'absolute', left: 0, top: 6, bottom: 6, width: 3, borderRadius: 2 },
  name: { fontSize: 12, marginBottom: 2 },
  value: { fontWeight: '600', fontVariant: ['tabular-nums'] },
  spark: { position: 'absolute', bottom: 0, left: 0 },
});
