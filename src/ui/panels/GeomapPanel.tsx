import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Image, PixelRatio, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Text as SvgText } from 'react-native-svg';
import { normalizeRef, type DataSource } from '../../core/datasource';
import type { DataFrame } from '../../core/frame';
import { loadGazetteer, type Gazetteer } from '../../core/gazetteer';
import type { Panel } from '../../core/schema';
import { useDashboard, usePanelLinks } from '../context';
import {
  gazetteerPaths,
  geomapLayers,
  heatmapCells,
  initialView,
  panView,
  screenProjector,
  symbolPath,
  visibleTiles,
  zoomLimits,
  type DataLayer,
  type GeoLayer,
  type MapView,
  type MarkersLayer,
  type RouteLayer,
  type TilesLayer,
} from '../geomap';
import { useDashTheme } from '../theme';
import { Legend, RowTooltip, rowLinks, rowTooltipItems, useLayout, type PanelProps } from './common';

/** How far from a point a tap can be and still pick it. */
const HIT_PX = 24;
/** Movement before a touch counts as a drag rather than a tap. */
const DRAG_PX = 6;
const MAX_LABELS = 300;

/** Screen positions of one layer's points, parallel to layer.points. */
type Screen = { px: number[]; py: number[] }[];

interface Picked {
  layer: MarkersLayer | RouteLayer;
  group: number;
  index: number;
  px: number;
  py: number;
}

/**
 * Grafana "geomap": a basemap of raster tiles with markers, heatmap, route and last-point layers drawn over it.
 * Drag to pan, pinch or use +/− to zoom, tap a point to see its row.
 */
export function GeomapPanel({ panel, frames }: PanelProps) {
  const theme = useDashTheme();
  const [size, onLayout] = useLayout();
  const retina = PixelRatio.get() > 1;
  const { gazetteers, error } = useGazetteers(panel, frames);
  const layers = useMemo(() => geomapLayers(panel, frames, theme.scheme, retina, gazetteers), [panel, frames, theme.scheme, retina, gazetteers]);
  const home = useMemo(() => initialView(panel, layers, size.width, size.height), [panel, layers, size.width, size.height]);
  // Set once the map is panned or zoomed; until then the view follows the data (for "fit").
  const [moved, setMoved] = useState<MapView | null>(null);
  const [picked, setPicked] = useState<{ layer: string; group: number; index: number } | null>(null);
  const links = usePanelLinks(panel);
  const view = moved ?? home;
  const [minZoom, maxZoom] = zoomLimits(panel);
  const zoomTo = (v: MapView, zoom: number) => setMoved({ ...v, zoom: Math.min(maxZoom, Math.max(minZoom, zoom)) });

  const screen = useMemo(() => {
    const at = screenProjector(view, size.width, size.height);
    return new Map(
      layers.map((l) => [
        l.key,
        l.type === 'tiles'
          ? []
          : l.points.map((p) => {
              const px: number[] = [];
              const py: number[] = [];
              p.xs.forEach((x, i) => {
                const [sx, sy] = at(x, p.ys[i]);
                px.push(sx);
                py.push(sy);
              });
              return { px, py };
            }),
      ]),
    );
  }, [layers, view, size.width, size.height]);

  const tooltips = panel.options?.tooltip?.mode !== 'none';
  const pick = (x: number, y: number): Picked | null => {
    let best: Picked | null = null;
    let bestD = HIT_PX * HIT_PX;
    for (const l of layers) {
      if (l.type === 'tiles' || l.type === 'heatmap' || !l.tooltip) continue;
      screen.get(l.key)?.forEach(({ px, py }, group) => {
        for (let i = 0; i < px.length; i++) {
          const d = (px[i] - x) ** 2 + (py[i] - y) ** 2;
          if (d <= bestD) {
            bestD = d;
            best = { layer: l, group, index: i, px: px[i], py: py[i] };
          }
        }
      });
    }
    return best;
  };

  const gesture = useRef<{ x: number; y: number; lx: number; ly: number; view: MapView; moved: boolean; dist?: number } | null>(null);
  const responder = {
    onStartShouldSetResponder: () => true,
    // Keep the gesture while panning instead of handing it to the dashboard's scroll view.
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: any) => {
      const t = e.nativeEvent;
      gesture.current = { x: t.pageX, y: t.pageY, lx: t.locationX, ly: t.locationY, view, moved: false };
    },
    onResponderMove: (e: any) => {
      const g = gesture.current;
      if (!g) return;
      const touches = e.nativeEvent.touches ?? [];
      if (touches.length >= 2) {
        const dist = Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
        if (g.dist == null) Object.assign(g, { dist, view, moved: true });
        else if (dist > 0) zoomTo(g.view, g.view.zoom + Math.log2(dist / g.dist));
        return;
      }
      // After a pinch, the finger left behind doesn't pan.
      if (g.dist != null) return;
      const dx = e.nativeEvent.pageX - g.x;
      const dy = e.nativeEvent.pageY - g.y;
      if (!g.moved && Math.hypot(dx, dy) < DRAG_PX) return;
      g.moved = true;
      setMoved(panView(g.view, dx, dy));
    },
    onResponderRelease: () => {
      const g = gesture.current;
      gesture.current = null;
      if (!g || g.moved || !tooltips) return;
      const hit = pick(g.lx, g.ly);
      setPicked(hit && { layer: hit.layer.key, group: hit.group, index: hit.index });
    },
    onResponderTerminate: () => {
      gesture.current = null;
    },
  };

  const shown = picked && resolvePicked(layers, screen, picked);
  const controls = panel.options?.controls ?? {};
  const attribution = [...new Set(layers.flatMap((l) => (l.type === 'tiles' && l.source.attribution ? [l.source.attribution] : [])))].join(' ');
  const legend = layers.flatMap((l) => (l.type === 'markers' || l.type === 'route' ? l.legend : []));
  const ready = size.width > 0 && size.height > 0;

  return (
    <View style={styles.fill}>
      <View style={[styles.fill, styles.map, { backgroundColor: theme.grid }]} onLayout={onLayout} {...responder}>
        {ready && (
          // Nothing inside takes touches, so locationX/Y are always relative to the map.
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {layers.map((l) =>
              l.type === 'tiles' ? (
                <Tiles key={l.key} layer={l} view={view} width={size.width} height={size.height} />
              ) : (
                <DataLayerSvg key={l.key} layer={l} screen={screen.get(l.key) ?? []} width={size.width} height={size.height} textColor={theme.text} />
              ),
            )}
            {shown && (
              <Svg width={size.width} height={size.height} style={StyleSheet.absoluteFill}>
                <Path
                  d={symbolPath('circle', shown.px, shown.py, Math.max(shown.layer.type === 'markers' ? shown.radius + 2 : 5, 5))}
                  fill="none"
                  stroke={theme.text}
                  strokeWidth={2}
                />
              </Svg>
            )}
          </View>
        )}
        {shown && (
          <RowTooltip
            at={{ x: shown.px, y: shown.py }}
            size={size}
            color={shown.color}
            title={shown.layer.name}
            rows={rowTooltipItems(panel, shown.frame, shown.row, frames.length > 1)}
            links={rowLinks(panel, shown.frame, shown.row, frames.length > 1, links.resolve)}
            onOpenLink={(l) => links.openLinks([l])}
          />
        )}
        {controls.showZoom !== false && (
          <View style={styles.zoom}>
            <MapButton label="+" onPress={() => zoomTo(view, Math.round(view.zoom) + 1)} />
            <MapButton label="−" onPress={() => zoomTo(view, Math.round(view.zoom) - 1)} />
            {moved && <MapButton label="⟲" onPress={() => setMoved(null)} />}
          </View>
        )}
        {error ? (
          <Text pointerEvents="none" style={[styles.error, { color: theme.danger, backgroundColor: theme.surface }]} numberOfLines={2}>
            {error}
          </Text>
        ) : null}
        {controls.showAttribution !== false && attribution ? (
          <Text pointerEvents="none" style={[styles.attribution, { color: theme.textSecondary, backgroundColor: theme.surface }]} numberOfLines={1}>
            {attribution}
          </Text>
        ) : null}
      </View>
      {legend.length > 0 && <Legend items={legend} />}
    </View>
  );
}

const NONE: Record<string, Gazetteer> = {};

/** The gazetteers the panel's lookup layers need, loaded from the panel's Grafana, and why any failed. */
function useGazetteers(panel: Panel, frames: DataFrame[]): { gazetteers: Record<string, Gazetteer>; error?: string } {
  const { resolve } = useDashboard();
  const key = gazetteerPaths(panel, frames).join('\n');
  const [state, setState] = useState<{ key: string; gazetteers: Record<string, Gazetteer>; error?: string }>({ key: '', gazetteers: NONE });
  useEffect(() => {
    if (!key) return;
    let live = true;
    let ds: DataSource | undefined;
    try {
      ds = resolve?.(normalizeRef(panel.datasource));
    } catch {}
    const paths = key.split('\n');
    Promise.allSettled(paths.map((p) => loadGazetteer(p, ds))).then((results) => {
      if (!live) return;
      const gazetteers: Record<string, Gazetteer> = {};
      const errors: string[] = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') gazetteers[paths[i]] = r.value;
        else errors.push(`Couldn't load ${paths[i]}: ${r.reason?.message ?? r.reason}`);
      });
      setState({ key, gazetteers, error: errors.join('\n') || undefined });
    });
    return () => {
      live = false;
    };
  }, [key, resolve, panel.datasource]);
  return state.key === key ? state : { gazetteers: NONE };
}

function MapButton({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useDashTheme();
  return (
    <Pressable onPress={onPress} hitSlop={4} style={[styles.button, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[styles.buttonText, { color: theme.text }]}>{label}</Text>
    </Pressable>
  );
}

function Tiles({ layer, view, width, height }: { layer: TilesLayer; view: MapView; width: number; height: number }) {
  const tiles = visibleTiles(layer.source, view, width, height);
  return (
    <View style={[StyleSheet.absoluteFill, { opacity: layer.opacity }]}>
      {tiles.map((t) => (
        // Half a pixel of overlap hides seams between scaled tiles.
        <Image
          key={t.key}
          source={{ uri: t.url }}
          fadeDuration={0}
          style={{ position: 'absolute', left: t.left, top: t.top, width: t.size + 0.5, height: t.size + 0.5 }}
        />
      ))}
    </View>
  );
}

function DataLayerSvg({ layer, screen, width, height, textColor }: { layer: DataLayer; screen: Screen; width: number; height: number; textColor: string }) {
  const body = useMemo(() => {
    if (layer.type === 'heatmap') {
      const px = screen.flatMap((s) => s.px);
      const py = screen.flatMap((s) => s.py);
      const weights = layer.points.flatMap((p) => p.sizes);
      return heatmapCells(px, py, weights, layer.radius, layer.blur, width, height).map((c) => (
        <Path key={c.color} d={c.d} fill={c.color} fillOpacity={c.opacity} />
      ));
    }
    if (layer.type === 'route') return routePaths(layer, screen);
    return markerPaths(layer, screen, width, height, textColor);
  }, [layer, screen, width, height, textColor]);
  return (
    <Svg width={width} height={height} style={[StyleSheet.absoluteFill, { opacity: layer.opacity }]}>
      {body}
    </Svg>
  );
}

/** Markers batched into one path per color, skipping those off screen. */
function markerPaths(layer: MarkersLayer, screen: Screen, width: number, height: number, textColor: string) {
  const byColor = new Map<string, string[]>();
  const labels: ReactElement[] = [];
  layer.points.forEach((p, g) => {
    const { px, py } = screen[g];
    for (let i = 0; i < px.length; i++) {
      const r = p.sizes[i];
      if (px[i] < -r || px[i] > width + r || py[i] < -r || py[i] > height + r) continue;
      const parts = byColor.get(p.colors[i]) ?? byColor.set(p.colors[i], []).get(p.colors[i])!;
      parts.push(symbolPath(layer.symbol, px[i], py[i], r));
      const label = p.labels?.[i];
      if (label && labels.length < MAX_LABELS)
        labels.push(
          <SvgText
            key={`${g}/${i}`}
            x={px[i] + layer.labelOffset[0]}
            y={py[i] - layer.labelOffset[1] + layer.fontSize / 3}
            fontSize={layer.fontSize}
            fill={textColor}
            textAnchor="middle"
          >
            {label}
          </SvgText>,
        );
    }
  });
  const outline = layer.symbol === 'cross' || layer.symbol === 'x';
  return [
    ...[...byColor].map(([color, parts]) => (
      <Path key={color} d={parts.join('')} fill={outline ? 'none' : color} fillOpacity={layer.fillOpacity} stroke={color} strokeWidth={outline ? 2 : 1} />
    )),
    ...labels,
  ];
}

/** A line through each frame's points in data order, each segment in its starting point's color. */
function routePaths(layer: RouteLayer, screen: Screen) {
  const byColor = new Map<string, string[]>();
  layer.points.forEach((p, g) => {
    const { px, py } = screen[g];
    for (let i = 0; i + 1 < px.length; i++) {
      const parts = byColor.get(p.colors[i]) ?? byColor.set(p.colors[i], []).get(p.colors[i])!;
      parts.push(`M${px[i]},${py[i]}L${px[i + 1]},${py[i + 1]}`);
    }
  });
  return [...byColor].map(([color, parts]) => (
    <Path key={color} d={parts.join('')} stroke={color} strokeWidth={layer.lineWidth} strokeLinecap="round" fill="none" />
  ));
}

/** The picked point in the current data, or null if a refresh removed it. */
function resolvePicked(layers: GeoLayer[], screen: Map<string, Screen>, picked: { layer: string; group: number; index: number }) {
  const layer = layers.find((l) => l.key === picked.layer);
  if (!layer || (layer.type !== 'markers' && layer.type !== 'route')) return null;
  const p = layer.points[picked.group];
  const s = screen.get(layer.key)?.[picked.group];
  if (!p || !s || picked.index >= p.rows.length) return null;
  return {
    layer,
    frame: p.frame,
    row: p.rows[picked.index],
    color: p.colors[picked.index],
    radius: p.sizes[picked.index],
    px: s.px[picked.index],
    py: s.py[picked.index],
  };
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  map: { overflow: 'hidden', borderRadius: 4 },
  zoom: { position: 'absolute', top: 6, left: 6, gap: 4 },
  button: {
    width: 28,
    height: 28,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: '600', lineHeight: 18 },
  error: { position: 'absolute', top: 6, left: 40, right: 6, fontSize: 11, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4 },
  attribution: { position: 'absolute', right: 0, bottom: 0, fontSize: 9, paddingHorizontal: 4, paddingVertical: 1, opacity: 0.85, maxWidth: '100%' },
});
