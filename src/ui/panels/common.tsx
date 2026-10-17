import { useCallback, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import type { DataFrame } from '../../core/frame';
import type { Panel } from '../../core/schema';
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

export function Legend({ items }: { items: Array<{ key: string; name: string; color: string; value?: string }> }) {
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

export function NoData({ message = 'No data' }: { message?: string }) {
  const theme = useDashTheme();
  return (
    <View style={styles.center}>
      <Text style={{ color: theme.textMuted, fontSize: 13 }}>{message}</Text>
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
});
