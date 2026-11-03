import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { resolveColor } from '../../core/format';
import { reducedValues, type ReducedValue } from '../chart';
import { usePanelLinks } from '../context';
import { useDashTheme } from '../theme';
import { NoData, useLayout, valueLinks, type PanelProps } from './common';
import { withAlpha } from './StatPanel';

const SWEEP = 240;

/** Grafana "gauge": an arc per series, filled to the value and colored by threshold. */
export function GaugePanel({ panel, frames }: PanelProps) {
  const theme = useDashTheme();
  const values = useMemo(() => reducedValues(panel, frames, theme.scheme), [panel, frames, theme.scheme]);
  if (!values.length) return <NoData />;
  return (
    <View style={styles.row}>
      {values.map((v) => (
        <Gauge key={v.key} v={v} showName={values.length > 1} panel={panel} />
      ))}
    </View>
  );
}

function Gauge({ v, showName, panel }: { v: ReducedValue; showName: boolean; panel: PanelProps['panel'] }) {
  const theme = useDashTheme();
  const [size, onLayout] = useLayout();
  const { resolve, openLinks } = usePanelLinks(panel);
  const hasLinks = !!v.config.links?.length;
  const min = v.config.min ?? 0;
  const max = v.config.max ?? 100;
  const frac = v.value == null ? 0 : Math.min(1, Math.max(0, (v.value - min) / (max - min || 1)));
  const d = Math.min(size.width, size.height * 1.15);
  const stroke = Math.max(6, d * 0.09);
  const r = d / 2 - stroke;
  const cx = size.width / 2;
  const cy = size.height / 2 + d * 0.08;

  return (
    <Pressable
      style={({ pressed }) => [styles.fill, pressed && { opacity: 0.7 }]}
      onLayout={onLayout}
      disabled={!hasLinks}
      onPress={() => openLinks(valueLinks(panel, v, resolve), v.name)}
      accessibilityRole={hasLinks ? 'link' : undefined}
    >
      {size.width > 0 && r > 0 && (
        <Svg width={size.width} height={size.height}>
          <Path d={arc(cx, cy, r, 0, 1)} stroke={withAlpha(v.stateColor, 0.18)} strokeWidth={stroke} fill="none" strokeLinecap="round" />
          {frac > 0 && <Path d={arc(cx, cy, r, 0, frac)} stroke={v.stateColor} strokeWidth={stroke} fill="none" strokeLinecap="round" />}
        </Svg>
      )}
      <View style={[StyleSheet.absoluteFill, styles.center, { top: d * 0.12 }]} pointerEvents="none">
        <Text style={[styles.value, { color: theme.text, fontSize: Math.max(14, d * 0.18) }]} numberOfLines={1} adjustsFontSizeToFit>
          {v.text}
        </Text>
        {showName && (
          <Text style={[styles.name, { color: theme.textSecondary }]} numberOfLines={1}>
            {v.name}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

/** Arc from fraction a to b of the gauge sweep, starting at the lower left. */
function arc(cx: number, cy: number, r: number, a: number, b: number): string {
  const start = -90 - SWEEP / 2 + a * SWEEP;
  const end = -90 - SWEEP / 2 + b * SWEEP;
  const p = (deg: number) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
  const [x1, y1] = p(start);
  const [x2, y2] = p(end);
  return `M${x1},${y1}A${r},${r} 0 ${end - start > 180 ? 1 : 0} 1 ${x2},${y2}`;
}

/** Grafana "bargauge": one horizontal meter per series. The track is a lighter step of the fill. */
export function BarGaugePanel({ panel, frames }: PanelProps) {
  const theme = useDashTheme();
  const values = useMemo(() => reducedValues(panel, frames, theme.scheme), [panel, frames, theme.scheme]);
  const { resolve, openLinks } = usePanelLinks(panel);
  if (!values.length) return <NoData />;
  return (
    <View style={styles.bars}>
      {values.map((v) => {
        const min = v.config.min ?? 0;
        const max = v.config.max ?? Math.max(...values.map((o) => o.value ?? 0), 1);
        const frac = v.value == null ? 0 : Math.min(1, Math.max(0, (v.value - min) / (max - min || 1)));
        const color = v.config.thresholds || v.mapped?.color ? v.stateColor : resolveColor(v.config.color?.fixedColor, v.color);
        const hasLinks = !!v.config.links?.length;
        return (
          <Pressable
            key={v.key}
            style={({ pressed }) => [styles.barRow, pressed && { opacity: 0.7 }]}
            disabled={!hasLinks}
            onPress={() => openLinks(valueLinks(panel, v, resolve), v.name)}
            accessibilityRole={hasLinks ? 'link' : undefined}
          >
            <View style={styles.barLabels}>
              <Text style={[styles.name, { color: theme.textSecondary }]} numberOfLines={1}>
                {v.name}
              </Text>
              <Text style={[styles.barValue, { color: theme.text }]}>{v.text}</Text>
            </View>
            <View style={[styles.track, { backgroundColor: withAlpha(color, 0.18) }]}>
              <View style={[styles.meter, { width: `${frac * 100}%`, backgroundColor: color }]} />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flex: 1, flexDirection: 'row', gap: 8 },
  center: { alignItems: 'center', justifyContent: 'center' },
  value: { fontWeight: '600', fontVariant: ['tabular-nums'] },
  name: { fontSize: 12, flexShrink: 1 },
  bars: { flex: 1, justifyContent: 'space-evenly', gap: 6 },
  barRow: { gap: 4 },
  barLabels: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  barValue: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  track: { height: 10, borderRadius: 4, overflow: 'hidden' },
  meter: { height: '100%', borderRadius: 4 },
});
