import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { formatValue } from '../../core/format';
import { frameLength } from '../../core/frame';
import { reducedValues } from '../chart';
import { useDashTheme } from '../theme';
import { Legend, NoData, useLayout, type PanelProps } from './common';

/** Grafana "piechart": a donut of reduced values. Legend always shows values, so identity never rests on color. */
export function PieChartPanel({ panel, frames }: PanelProps) {
  const theme = useDashTheme();
  const [size, onLayout] = useLayout();
  const values = useMemo(
    () => reducedValues(panel, frames, theme.scheme).filter((v) => (v.value ?? 0) > 0),
    [panel, frames, theme.scheme],
  );
  if (!values.length) return <NoData />;

  const total = values.reduce((a, v) => a + (v.value ?? 0), 0);
  const r = Math.min(size.width, size.height) / 2 - 2;
  const inner = panel.options?.pieType === 'pie' ? 0 : r * 0.62;
  const cx = size.width / 2;
  const cy = size.height / 2;
  let angle = -Math.PI / 2;
  const gap = values.length > 1 ? 0.02 : 0;

  return (
    <View style={styles.fill}>
      <View style={styles.fill} onLayout={onLayout}>
        {r > 0 && (
          <Svg width={size.width} height={size.height}>
            {values.map((v) => {
              const sweep = ((v.value ?? 0) / total) * Math.PI * 2;
              const d = donutSlice(cx, cy, r, inner, angle + gap / 2, angle + sweep - gap / 2);
              angle += sweep;
              return (
<Path key={v.key} d={d} fill={v.color} />
              );
            })}
          </Svg>
        )}
      </View>
      <Legend
        items={values.map((v) => ({
          key: v.key,
          name: v.name,
          color: v.color,
          value: `${formatValue(v.value, v.config)} (${Math.round(((v.value ?? 0) / total) * 100)}%)`,
        }))}
      />
    </View>
  );
}

function donutSlice(cx: number, cy: number, r: number, inner: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (rad: number, a: number) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
  if (a1 - a0 >= Math.PI * 2 - 0.001) a1 = a0 + Math.PI * 2 - 0.001;
  if (inner <= 0) return `M${cx},${cy}L${p(r, a0)}A${r},${r} 0 ${large} 1 ${p(r, a1)}Z`;
  return `M${p(r, a0)}A${r},${r} 0 ${large} 1 ${p(r, a1)}L${p(inner, a1)}A${inner},${inner} 0 ${large} 0 ${p(inner, a0)}Z`;
}

/** Grafana "table": the first frame, scrollable both ways. */
export function TablePanel({ frames }: PanelProps) {
  const theme = useDashTheme();
  const frame = frames[0];
  if (!frame || !frameLength(frame)) return <NoData />;
  const rows = Math.min(frameLength(frame), 500);
  const cell = (v: unknown, type: string) =>
    v == null ? '' : type === 'time' ? new Date(Number(v)).toLocaleString() : type === 'number' ? formatValue(Number(v)) : String(v);

  return (
    <ScrollView horizontal>
      <ScrollView nestedScrollEnabled>
        <View style={[styles.tr, { borderBottomColor: theme.border }]}>
          {frame.fields.map((f) => (
            <Text key={f.name} style={[styles.th, { color: theme.textSecondary }]}>
              {f.name}
            </Text>
          ))}
        </View>
        {Array.from({ length: rows }, (_, i) => (
          <View key={i} style={[styles.tr, { borderBottomColor: theme.grid }]}>
            {frame.fields.map((f) => (
              <Text key={f.name} style={[styles.td, { color: theme.text }, f.type === 'number' && styles.num]} numberOfLines={1}>
                {cell(f.values[i], f.type)}
              </Text>
            ))}
          </View>
        ))}
      </ScrollView>
    </ScrollView>
  );
}

/** Grafana "text": markdown is rendered as plain paragraphs with headings and bold stripped to weight. */
export function TextPanel({ panel }: PanelProps) {
  const theme = useDashTheme();
  const content: string = panel.options?.content ?? '';
  const text = panel.options?.mode === 'html' ? content.replace(/<[^>]+>/g, '') : content;
  return (
    <ScrollView>
      {text.split(/\n{2,}/).map((block, i) => {
        const heading = /^#{1,6}\s+/.test(block);
        return (
          <Text key={i} style={[styles.para, { color: heading ? theme.text : theme.textSecondary }, heading && styles.heading]}>
            {block.replace(/^#{1,6}\s+/, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\[(.+?)\]\(.+?\)/g, '$1')}
          </Text>
        );
      })}
    </ScrollView>
  );
}

/** Grafana "barchart": categories from the first string field (or time), grouped bars per numeric field. */
export function BarChartPanel({ panel, frames }: PanelProps) {
  const theme = useDashTheme();
  const values = useMemo(() => reducedValues(panel, frames, theme.scheme), [panel, frames, theme.scheme]);
  const frame = frames[0];
  const category = frame?.fields.find((f) => f.type === 'string');
  if (!frame || !values.length) return <NoData />;

  // Without a category field, show one bar per series using the reduced value.
  const labels = category ? category.values.map(String) : values.map((v) => v.name);
  const numeric = category ? frame.fields.filter((f) => f.type === 'number') : [];
  const bars = category
    ? labels.map((label, i) => ({ label, values: numeric.map((f, fi) => ({ v: Number(f.values[i] ?? 0), color: values[fi]?.color ?? theme.accent })) }))
    : values.map((v) => ({ label: v.name, values: [{ v: v.value ?? 0, color: v.color }] }));
  const max = Math.max(...bars.flatMap((b) => b.values.map((x) => x.v)), 0) || 1;

  return (
    <View style={styles.fill}>
      <View style={styles.barchart}>
        {bars.map((b, i) => (
          <View key={i} style={styles.barGroup}>
            <View style={styles.barStack}>
              {b.values.map((x, xi) => (
                <View key={xi} style={[styles.bar, { height: `${(Math.max(x.v, 0) / max) * 100}%`, backgroundColor: x.color }]} />
              ))}
            </View>
            <Text style={[styles.barLabel, { color: theme.textMuted }]} numberOfLines={1}>
              {b.label}
            </Text>
          </View>
        ))}
      </View>
      {numeric.length > 1 && <Legend items={numeric.map((f, i) => ({ key: f.name, name: f.name, color: values[i]?.color ?? theme.accent }))} />}
    </View>
  );
}

export function UnsupportedPanel({ panel }: PanelProps) {
  return <NoData message={`"${panel.type}" panels aren't supported yet`} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  tr: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  th: { width: 120, paddingVertical: 6, paddingRight: 8, fontSize: 12, fontWeight: '600' },
  td: { width: 120, paddingVertical: 6, paddingRight: 8, fontSize: 12 },
  num: { textAlign: 'right', fontVariant: ['tabular-nums'] },
  para: { fontSize: 14, lineHeight: 20, marginBottom: 8 },
  heading: { fontSize: 16, fontWeight: '600' },
  barchart: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  barGroup: { flex: 1, height: '100%', alignItems: 'center' },
  barStack: { flex: 1, width: '100%', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 2 },
  bar: { flex: 1, maxWidth: 24, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  barLabel: { fontSize: 10, marginTop: 4 },
});
