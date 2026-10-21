import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { formatValue } from '../../core/format';
import { frameLength } from '../../core/frame';
import { contrastText, cellDisplay, tableColumns } from '../table';
import { barAxes, barCategory, categoryLabels, reducedValues, tickDecimals, type BarAxis } from '../chart';
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

/**
 * Grafana "table". Each column follows its field config: display name, width, alignment, unit, decimals, value
 * mappings and `noValue`; `custom.hidden` columns are left out. Cells can be colored text, colored backgrounds
 * (optionally the whole row) or gauges.
 */
export function TablePanel({ panel, frames }: PanelProps) {
  const theme = useDashTheme();
  const frame = frames[0];
  const columns = useMemo(() => (frame ? tableColumns(panel, frame, frames.length > 1) : []), [panel, frame, frames.length]);
  if (!frame || !frameLength(frame)) return <NoData />;
  const rows = Math.min(frameLength(frame), 500);
  const rowColumn = columns.find((c) => c.applyToRow);

  return (
    <ScrollView horizontal>
      <ScrollView nestedScrollEnabled>
        <View style={[styles.tr, { borderBottomColor: theme.border }]}>
          {columns.map((c) => (
            <Text key={c.key} style={[styles.th, { width: c.width, color: theme.textSecondary, textAlign: c.align }]} numberOfLines={2}>
              {c.name}
            </Text>
          ))}
        </View>
        {Array.from({ length: rows }, (_, i) => {
          const rowBg = rowColumn ? cellDisplay(rowColumn, rowColumn.field.values[i], theme.accent).background : undefined;
          return (
            <View key={i} style={[styles.tr, { borderBottomColor: theme.grid }, rowBg ? { backgroundColor: rowBg } : null]}>
              {columns.map((c) => {
                const d = cellDisplay(c, c.field.values[i], theme.accent);
                const bg = d.background ?? rowBg;
                const color = d.color ?? (bg ? contrastText(bg, theme.text) : theme.text);
                return (
                  <View key={c.key} style={[styles.td, { width: c.width }, d.background ? { backgroundColor: d.background } : null]}>
                    {d.gauge != null && (
                      <View style={[styles.gaugeTrack, { backgroundColor: theme.grid }]}>
                        <View style={[styles.gaugeFill, { width: `${d.gauge * 100}%`, backgroundColor: d.gaugeColor ?? theme.accent }]} />
                      </View>
                    )}
                    <Text style={[styles.cellText, { color, textAlign: c.align }, c.field.type === 'number' && styles.num]} numberOfLines={c.wrap ? undefined : 1}>
                      {d.text}
                    </Text>
                  </View>
                );
              })}
            </View>
          );
        })}
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

/**
 * Grafana "barchart": one group of bars per category, one bar per numeric field. Categories come from `xField`,
 * else the first string field, else the first time field, as in Grafana. Fields placed on the right axis
 * (`custom.axisPlacement: "right"`) get their own scale there.
 */
export function BarChartPanel({ panel, frames, width }: PanelProps) {
  const theme = useDashTheme();
  const [plot, onPlotLayout] = useLayout();
  const values = useMemo(() => reducedValues(panel, frames, theme.scheme), [panel, frames, theme.scheme]);
  const frame = frames[0];
  const category = frame && barCategory(panel, frame);
  if (!frame || !values.length) return <NoData />;

  const allNumeric = frame.fields.filter((f) => f.type === 'number');
  const at = (f: (typeof allNumeric)[number]) => values[allNumeric.indexOf(f)];
  // Without a category field, show one bar per series using the reduced value.
  const numeric = category ? allNumeric.filter((f) => f !== category) : [];
  const fields = category
    ? numeric.map((f) => ({ key: f.name, name: at(f)?.name ?? f.name, color: at(f)?.color ?? theme.accent, config: at(f)?.config ?? {}, values: f.values.map(num) }))
    : [{ key: 'reduced', name: '', color: theme.accent, config: values[0].config, values: values.map((v) => v.value) }];
  const labels = category ? categoryLabels(category) : values.map((v) => v.name);
  const colorAt = (fi: number, i: number) => (category ? fields[fi].color : values[i].color);

  const axes = barAxes(
    fields.map((f) => f.config),
    fields.map((f) => f.values),
    plot.height < 100 ? 2 : 4,
  );
  const axisOf = (fi: number) => axes.find((a) => a.fields.includes(fi))!;
  const left = axes.find((a) => a.side === 'left' && a.show);
  const right = axes.find((a) => a.side === 'right' && a.show);
  const gridAxis = left ?? right;
  // Label every nth group so labels get ~44px each; a month of days would otherwise be unreadable.
  const plotW = width - (left ? AXIS_W : 0) - (right ? AXIS_W : 0);
  const every = Math.max(1, Math.ceil(labels.length / Math.max(1, Math.floor(plotW / 44))));

  const axisColumn = (axis: BarAxis) => (
    <View style={[styles.axis, axis.side === 'left' ? styles.axisLeft : styles.axisRight]}>
      {plot.height > 0 &&
        axis.ticks.map((t) => (
          <Text
            key={t}
            style={[styles.tick, { color: theme.textMuted, top: plot.height * (1 - t / axis.top) - 7 }, axis.side === 'left' ? styles.tickLeft : styles.tickRight]}
            numberOfLines={1}
          >
            {formatValue(t, { ...axis.config, decimals: tickDecimals(axis.ticks) })}
          </Text>
        ))}
    </View>
  );

  return (
    <View style={styles.fill}>
      {(left?.label || right?.label) && (
        <View style={styles.axisLabels}>
          <Text style={[styles.axisLabel, { color: theme.textMuted }]}>{left?.label ?? ''}</Text>
          <Text style={[styles.axisLabel, { color: theme.textMuted }]}>{right?.label ?? ''}</Text>
        </View>
      )}
      <View style={styles.barRow}>
        {left && axisColumn(left)}
        <View style={styles.fill} onLayout={onPlotLayout}>
          {gridAxis &&
            plot.height > 0 &&
            gridAxis.ticks.map((t) => (
              <View key={t} style={[styles.gridLine, { backgroundColor: theme.grid, top: plot.height * (1 - t / gridAxis.top) }]} />
            ))}
          <View style={styles.barchart}>
            {labels.map((_, i) => (
              <View key={i} style={styles.barStack}>
                {fields.map((f, fi) => (
                  <View
                    key={fi}
                    style={[styles.bar, { height: `${(Math.max(f.values[i] ?? 0, 0) / (axisOf(fi).top || 1)) * 100}%`, backgroundColor: colorAt(fi, i) }]}
                  />
                ))}
              </View>
            ))}
          </View>
        </View>
        {right && axisColumn(right)}
      </View>
      <View style={[styles.barLabels, { marginLeft: left ? AXIS_W : 0, marginRight: right ? AXIS_W : 0 }]}>
        {labels.map((label, i) => (
          <Text key={i} style={[styles.barLabel, { color: theme.textMuted }]} numberOfLines={1}>
            {i % every === 0 ? label : ' '}
          </Text>
        ))}
      </View>
      {category && fields.length > 1 && <Legend items={fields} />}
    </View>
  );
}

const AXIS_W = 40;

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function UnsupportedPanel({ panel }: PanelProps) {
  return <NoData message={`"${panel.type}" panels aren't supported yet`} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  tr: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  th: { paddingVertical: 6, paddingHorizontal: 6, fontSize: 12, fontWeight: '600' },
  td: { paddingVertical: 6, paddingHorizontal: 6, justifyContent: 'center' },
  cellText: { fontSize: 12 },
  gaugeTrack: { position: 'absolute', left: 6, right: 6, bottom: 3, height: 3, borderRadius: 2, overflow: 'hidden' },
  gaugeFill: { height: '100%', borderRadius: 2 },
  num: { textAlign: 'right', fontVariant: ['tabular-nums'] },
  para: { fontSize: 14, lineHeight: 20, marginBottom: 8 },
  heading: { fontSize: 16, fontWeight: '600' },
  // Room for half of the top tick label, which is centred on the plot's top edge.
  barRow: { flex: 1, flexDirection: 'row', paddingTop: 7 },
  barchart: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  barStack: { flex: 1, height: '100%', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 2 },
  bar: { flex: 1, maxWidth: 24, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  barLabels: { flexDirection: 'row', gap: 2 },
  barLabel: { flex: 1, fontSize: 10, marginTop: 4, textAlign: 'center' },
  gridLine: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth },
  axis: { width: AXIS_W },
  axisLeft: { paddingRight: 6 },
  axisRight: { paddingLeft: 6 },
  tick: { position: 'absolute', fontSize: 10, lineHeight: 14 },
  tickLeft: { right: 6, textAlign: 'right' },
  tickRight: { left: 6 },
  axisLabels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  axisLabel: { fontSize: 10 },
});
