import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';
import { formatValue } from '../../core/format';
import { linearScale, niceTicks, tickDecimals } from '../chart';
import { useDashTheme } from '../theme';
import { xyDomain, xySeries, type XYSeries } from '../xychart';
import { AXIS_TITLE_SPACE, AxisTitles, axisTitle, Legend, NoData, RowTooltip, rowTooltipItems, showLegend, useLayout, type PanelProps } from './common';

const AXIS = { left: 44, bottom: 20 };
const EDGE = 8;
/** How far from a point a touch can be and still pick it. */
const HIT_PX = 32;

/**
 * Grafana "xychart": points (and/or lines) of one numeric field against another, optionally colored and sized
 * by further fields. Touch a point to see its row.
 */
export function XYChartPanel({ panel, frames }: PanelProps) {
  const theme = useDashTheme();
  const [size, onLayout] = useLayout();
  const [touch, setTouch] = useState<{ x: number; y: number } | null>(null);
  const series = useMemo(() => xySeries(panel, frames, theme.scheme), [panel, frames, theme.scheme]);

  const first = series[0];
  const showX = first?.xConfig.custom?.axisPlacement !== 'hidden';
  const showY = first?.yConfig.custom?.axisPlacement !== 'hidden';
  // Grafana leaves a hidden axis untitled too.
  const xTitle = showX ? axisTitle(first?.xConfig) : undefined;
  const yTitle = showY ? axisTitle(first?.yConfig) : undefined;
  const pad = {
    top: EDGE,
    right: EDGE,
    bottom: (showX ? AXIS.bottom : EDGE) + (xTitle ? AXIS_TITLE_SPACE : 0),
    left: (showY ? AXIS.left : EDGE) + (yTitle ? AXIS_TITLE_SPACE : 0),
  };
  const plotW = Math.max(0, size.width - pad.left - pad.right);
  const plotH = Math.max(0, size.height - pad.top - pad.bottom);

  const layout = useMemo(() => {
    if (!first) return null;
    const [x0, x1] = xyDomain(series.map((s) => s.xs), first.xConfig);
    const [y0, y1] = xyDomain(series.map((s) => s.ys), first.yConfig);
    const x = linearScale(x0, x1, pad.left, pad.left + plotW);
    const y = linearScale(y0, y1, pad.top + plotH, pad.top);
    const points = series.map((s) => ({ px: s.xs.map(x), py: s.ys.map(y) }));
    return { x, y, x0, x1, y0, y1, points, paths: series.map((s, i) => drawSeries(s, points[i].px, points[i].py)) };
    // pad follows from showX, showY and the titles.
  }, [series, plotW, plotH, showX, showY, xTitle, yTitle]);

  if (!first || !layout || series.every((s) => !s.rows.length)) return <NoData />;

  const xTicks = showX ? axisTicks(layout.x0, layout.x1, plotW < 220 ? 2 : plotW < 400 ? 3 : 5) : [];
  const yTicks = showY ? axisTicks(layout.y0, layout.y1, plotH < 100 ? 2 : 4) : [];
  const gridX = first.xConfig.custom?.axisGridShow !== false;
  const gridY = first.yConfig.custom?.axisGridShow !== false;
  const hover = touch ? nearestPoint(series, layout.points, touch) : null;
  const legendItems = series.filter((s) => !(s.yConfig.custom?.hideFrom as { legend?: boolean } | undefined)?.legend);

  return (
    <View style={styles.fill}>
      <View
        style={styles.fill}
        onLayout={onLayout}
        onStartShouldSetResponder={() => true}
        onResponderGrant={(e) => setTouch({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY })}
        onResponderMove={(e) => setTouch({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY })}
        onResponderRelease={() => setTouch(null)}
        onResponderTerminate={() => setTouch(null)}
      >
        {size.width > 0 && (
          <Svg width={size.width} height={size.height}>
            {yTicks.map((t) => (
              <G key={`y${t}`}>
                {gridY && <Line x1={pad.left} x2={pad.left + plotW} y1={layout.y(t)} y2={layout.y(t)} stroke={theme.grid} strokeWidth={1} />}
                <SvgText x={pad.left - 6} y={layout.y(t) + 3} fontSize={10} fill={theme.textMuted} textAnchor="end">
                  {formatValue(t, { ...first.yConfig, decimals: first.yConfig.decimals ?? tickDecimals(yTicks) })}
                </SvgText>
              </G>
            ))}
            {xTicks.map((t) => (
              <G key={`x${t}`}>
                {gridX && <Line x1={layout.x(t)} x2={layout.x(t)} y1={pad.top} y2={pad.top + plotH} stroke={theme.grid} strokeWidth={1} />}
                <SvgText
                  x={layout.x(t)}
                  y={pad.top + plotH + 15}
                  fontSize={10}
                  fill={theme.textMuted}
                  textAnchor={layout.x(t) - pad.left < 20 ? 'start' : pad.left + plotW - layout.x(t) < 20 ? 'end' : 'middle'}
                >
                  {formatValue(t, { ...first.xConfig, decimals: first.xConfig.decimals ?? tickDecimals(xTicks) })}
                </SvgText>
              </G>
            ))}
            <AxisTitles x={xTitle} y={yTitle} plot={{ left: pad.left, top: pad.top, width: plotW, height: plotH }} height={size.height} />

            {series.map((s, si) => (
              <G key={s.key}>
                {layout.paths[si].line && <Path d={layout.paths[si].line} stroke={s.color} strokeWidth={s.lineWidth} fill="none" strokeLinejoin="round" />}
                {layout.paths[si].dots.map(([color, d]) => (
                  <Path key={color} d={d} fill={color} />
                ))}
              </G>
            ))}

            {hover && (
              <Circle
                cx={hover.px}
                cy={hover.py}
                r={Math.max(hover.series.sizes[hover.index] / 2 + 2, 5)}
                fill={hover.series.colors[hover.index]}
                stroke={theme.text}
                strokeWidth={2}
              />
            )}
          </Svg>
        )}
        {hover && (
          <RowTooltip
            at={{ x: hover.px, y: hover.py }}
            size={size}
            color={hover.series.colors[hover.index]}
            title={hover.series.name}
            rows={rowTooltipItems(panel, hover.series.frame, hover.series.rows[hover.index], frames.length > 1)}
          />
        )}
      </View>
      {showLegend(panel, legendItems.length) && <Legend items={legendItems} />}
    </View>
  );
}

/**
 * Lines in data order, and the points batched into one path per color: a lap of telemetry is thousands of
 * points, far too many to draw as separate SVG elements.
 */
function drawSeries(s: XYSeries, px: number[], py: number[]): { line?: string; dots: Array<[string, string]> } {
  const line = s.show === 'points' ? undefined : px.map((x, i) => `${i ? 'L' : 'M'}${x},${py[i]}`).join('');
  if (s.show === 'lines') return { line, dots: [] };
  const byColor = new Map<string, string[]>();
  px.forEach((x, i) => {
    const r = s.sizes[i] / 2;
    const color = s.colors[i];
    const parts = byColor.get(color) ?? byColor.set(color, []).get(color)!;
    parts.push(`M${x - r},${py[i]}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`);
  });
  return { line, dots: [...byColor].map(([color, parts]) => [color, parts.join('')]) };
}

function axisTicks(from: number, to: number, count: number): number[] {
  const ticks = niceTicks(from, to, count).filter((t) => t >= from && t <= to);
  return ticks.length ? ticks : [from, to];
}

function nearestPoint(series: XYSeries[], points: Array<{ px: number[]; py: number[] }>, at: { x: number; y: number }) {
  let best: { series: XYSeries; index: number; px: number; py: number } | null = null;
  let bestD = HIT_PX * HIT_PX;
  series.forEach((s, si) => {
    const { px, py } = points[si];
    for (let i = 0; i < px.length; i++) {
      const d = (px[i] - at.x) ** 2 + (py[i] - at.y) ** 2;
      if (d < bestD) (bestD = d), (best = { series: s, index: i, px: px[i], py: py[i] });
    }
  });
  return best as { series: XYSeries; index: number; px: number; py: number } | null;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
