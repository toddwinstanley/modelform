import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';
import { formatValue } from '../../core/format';
import { formatTimeTick, formatTooltipTime, linearScale, niceTicks, styledSeries, styledXYSeries, tickDecimals, yDomain, type StyledSeries } from '../chart';
import { useDashboard } from '../context';
import { useDashTheme } from '../theme';
import { Legend, NoData, showLegend, useLayout, type PanelProps } from './common';

const PAD = { top: 8, right: 8, bottom: 20, left: 44 };
const BAR_MAX = 24;

/**
 * Grafana "timeseries" (and legacy "graph") panels: lines, points, bars and area fills.
 * Also "trend" panels, which are the same chart against a numeric x field (`options.xField`).
 */
export function TimeSeriesPanel({ panel, frames }: PanelProps) {
  const theme = useDashTheme();
  const { range } = useDashboard();
  const [size, onLayout] = useLayout();
  const [hoverX, setHoverX] = useState<number | null>(null);

  const numericX = panel.type === 'trend';
  const { series, xConfig } = useMemo(
    () => (numericX ? styledXYSeries(panel, frames, theme.scheme) : { series: styledSeries(panel, frames, theme.scheme), xConfig: {} }),
    [numericX, panel, frames, theme.scheme],
  );
  if (!series.length || series.every((s) => s.values.every((v) => v == null))) return <NoData />;

  const style = (s: StyledSeries) => s.config.custom?.drawStyle ?? (panel.type === 'graph' && panel.bars ? 'bars' : 'line');
  const anyBars = series.some((s) => style(s) === 'bars');
  const anyFill = series.some((s) => (s.config.custom?.fillOpacity ?? 0) > 0);

  const plotW = Math.max(0, size.width - PAD.left - PAD.right);
  const plotH = Math.max(0, size.height - PAD.top - PAD.bottom);

  const [dMin, dMax] = yDomain(series, anyBars || anyFill);
  const ticks = niceTicks(dMin, dMax, plotH < 100 ? 2 : 4);
  const yMin = series[0].config.min ?? ticks[0];
  const yMax = series[0].config.max ?? ticks[ticks.length - 1];
  const [xFrom, xTo] = numericX ? xExtent(series) : [range.from, range.to];
  const x = linearScale(xFrom, xTo, PAD.left, PAD.left + plotW);
  const y = linearScale(yMin, yMax, PAD.top + plotH, PAD.top);
  const span = xTo - xFrom;
  const xTicks = numericX ? numberTicks(xFrom, xTo, plotW) : timeTicks(xFrom, xTo, plotW);
  const xLabel = (t: number) => (numericX ? formatValue(t, { ...xConfig, decimals: tickDecimals(xTicks) }) : formatTimeTick(t, span));
  const unitConfig = series[0].config;

  const barSeries = series.filter((s) => style(s) === 'bars');
  const pointsCount = Math.max(...series.map((s) => s.times.length));
  const slot = plotW / Math.max(pointsCount, 1);
  const groupW = Math.min(slot * 0.8, BAR_MAX * barSeries.length);
  const barW = Math.max(2, groupW / Math.max(barSeries.length, 1) - (barSeries.length > 1 ? 2 : 0));

  const hover = hoverX == null ? null : nearest(series, xFrom + ((hoverX - PAD.left) / (plotW || 1)) * span);

  return (
    <View style={styles.fill}>
      <View
        style={styles.fill}
        onLayout={onLayout}
        onStartShouldSetResponder={() => true}
        onResponderGrant={(e) => setHoverX(e.nativeEvent.locationX)}
        onResponderMove={(e) => setHoverX(e.nativeEvent.locationX)}
        onResponderRelease={() => setHoverX(null)}
        onResponderTerminate={() => setHoverX(null)}
      >
        {size.width > 0 && (
          <Svg width={size.width} height={size.height}>
            {ticks.map((t) => (
              <G key={t}>
                <Line x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} stroke={theme.grid} strokeWidth={1} />
                <SvgText x={PAD.left - 6} y={y(t) + 3} fontSize={10} fill={theme.textMuted} textAnchor="end">
                  {formatValue(t, { ...unitConfig, decimals: tickDecimals(ticks) })}
                </SvgText>
              </G>
            ))}
            {xTicks.map((t) => (
              <SvgText
                key={t}
                x={x(t)}
                y={size.height - 5}
                fontSize={10}
                fill={theme.textMuted}
                textAnchor={x(t) - PAD.left < 20 ? 'start' : PAD.left + plotW - x(t) < 20 ? 'end' : 'middle'}
              >
                {xLabel(t)}
              </SvgText>
            ))}

            {barSeries.map((s, si) =>
              s.times.map((t, i) => {
                const v = s.values[i];
                if (v == null || t < xFrom || t > xTo) return null;
                const left = x(t) - groupW / 2 + si * (groupW / barSeries.length);
                return <Path key={`${s.key}-${i}`} d={barPath(left, barW, y(Math.max(v, 0)), y(Math.min(v, 0)), v >= 0)} fill={s.color} />;
              }),
            )}

            {series
              .filter((s) => style(s) !== 'bars')
              .map((s) => {
                const fill = (s.config.custom?.fillOpacity ?? 0) / 100;
                const showPoints =
                  style(s) === 'points' ||
                  s.config.custom?.showPoints === 'always' ||
                  (s.config.custom?.showPoints !== 'never' && s.times.length <= plotW / 14);
                const segs = segments(s, x, y);
                return (
                  <G key={s.key}>
                    {fill > 0 &&
                      segs.map((seg, i) => (
                        <Path key={`f${i}`} d={`${seg.d}L${seg.lastX},${y(Math.max(yMin, 0))}L${seg.firstX},${y(Math.max(yMin, 0))}Z`} fill={s.color} opacity={fill} />
                      ))}
                    {style(s) !== 'points' &&
                      segs.map((seg, i) => (
                        <Path key={`l${i}`} d={seg.d} stroke={s.color} strokeWidth={s.config.custom?.lineWidth ?? 2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
                      ))}
                    {showPoints &&
                      s.times.map((t, i) =>
                        s.values[i] == null ? null : (
                          <Circle key={i} cx={x(t)} cy={y(s.values[i]!)} r={4} fill={s.color} stroke={theme.surface} strokeWidth={2} />
                        ),
                      )}
                  </G>
                );
              })}

            {hover && (
              <G>
                <Line x1={x(hover.time)} x2={x(hover.time)} y1={PAD.top} y2={PAD.top + plotH} stroke={theme.textMuted} strokeWidth={1} />
                {hover.rows.map((r) =>
                  r.value == null ? null : <Circle key={r.key} cx={x(r.time)} cy={y(r.value)} r={5} fill={r.color} stroke={theme.surface} strokeWidth={2} />,
                )}
              </G>
            )}
          </Svg>
        )}
        {hover && (
          <View
            pointerEvents="none"
            style={[
              styles.tooltip,
              { backgroundColor: theme.surface, borderColor: theme.border },
              x(hover.time) > size.width / 2 ? { right: size.width - x(hover.time) + 8 } : { left: x(hover.time) + 8 },
            ]}
          >
            <Text style={[styles.tooltipTime, { color: theme.textMuted }]}>
              {numericX ? formatValue(hover.time, xConfig) : formatTooltipTime(hover.time)}
            </Text>
            {hover.rows.map((r) => (
              <View key={r.key} style={styles.tooltipRow}>
                <View style={[styles.swatch, { backgroundColor: r.color }]} />
                <Text style={[styles.tooltipName, { color: theme.textSecondary }]} numberOfLines={1}>
                  {r.name}
                </Text>
                <Text style={[styles.tooltipValue, { color: theme.text }]}>{formatValue(r.value, r.config)}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
      {showLegend(panel, series.length) && <Legend items={series} />}
    </View>
  );
}

function segments(s: StyledSeries, x: (v: number) => number, y: (v: number) => number) {
  const out: Array<{ d: string; firstX: number; lastX: number }> = [];
  let d = '';
  let firstX = 0;
  let lastX = 0;
  s.times.forEach((t, i) => {
    const v = s.values[i];
    if (v == null) {
      if (d) out.push({ d, firstX, lastX });
      d = '';
      return;
    }
    const px = x(t);
    if (!d) firstX = px;
    d += `${d ? 'L' : 'M'}${px},${y(v)}`;
    lastX = px;
  });
  if (d) out.push({ d, firstX, lastX });
  return out;
}

/** A bar with a 4px rounded data end and a square baseline. */
function barPath(left: number, w: number, top: number, bottom: number, up: boolean): string {
  const h = bottom - top;
  const r = Math.min(4, w / 2, h);
  const right = left + w;
  if (up) {
    return `M${left},${bottom}V${top + r}Q${left},${top} ${left + r},${top}H${right - r}Q${right},${top} ${right},${top + r}V${bottom}Z`;
  }
  return `M${left},${top}V${bottom - r}Q${left},${bottom} ${left + r},${bottom}H${right - r}Q${right},${bottom} ${right},${bottom - r}V${top}Z`;
}

function timeTicks(from: number, to: number, width: number): number[] {
  const n = width < 220 ? 2 : width < 400 ? 3 : 5;
  return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
}

/** Round-numbered ticks inside [from, to] for a numeric x axis. */
function numberTicks(from: number, to: number, width: number): number[] {
  const ticks = niceTicks(from, to, width < 220 ? 2 : width < 400 ? 3 : 5).filter((t) => t >= from && t <= to);
  return ticks.length ? ticks : [from, to];
}

function xExtent(series: StyledSeries[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const s of series) {
    if (!s.times.length) continue;
    min = Math.min(min, s.times[0]);
    max = Math.max(max, s.times[s.times.length - 1]);
  }
  return min === Infinity ? [0, 1] : min === max ? [min - 1, max + 1] : [min, max];
}

function nearest(series: StyledSeries[], t: number) {
  let best: number | null = null;
  for (const s of series) {
    for (const st of s.times) if (best == null || Math.abs(st - t) < Math.abs(best - t)) best = st;
  }
  if (best == null) return null;
  const time = best;
  return {
    time,
    rows: series.map((s) => {
      const i = s.times.indexOf(time);
      return { key: s.key, name: s.name, color: s.color, config: s.config, time, value: i >= 0 ? s.values[i] : null };
    }),
  };
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  tooltip: {
    position: 'absolute',
    top: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 220,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  tooltipTime: { fontSize: 11, marginBottom: 3 },
  tooltipRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 3, borderRadius: 2 },
  tooltipName: { fontSize: 12, flexShrink: 1 },
  tooltipValue: { fontSize: 12, fontWeight: '600', marginLeft: 'auto', paddingLeft: 8 },
});
