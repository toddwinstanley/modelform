import { resolveFieldConfig } from '../core/fieldconfig';
import { fieldDisplayName, toMillis, type DataFrame, type Field } from '../core/frame';
import { formatDisplay, formatValue, resolveColor, valueColor } from '../core/format';
import { DEFAULT_GAZETTEER, type Gazetteer } from '../core/gazetteer';
import type { FieldConfig, Panel } from '../core/schema';

/** Tile edge in px. Zoom z shows the world 256 · 2^z px wide, as in OpenLayers (which Grafana uses). */
export const TILE = 256;
const MAX_LAT = 85.0511287798;
const MAX_ZOOM = 18;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Web Mercator: degrees to world coordinates, both in [0, 1] with y growing south. */
export function project(lon: number, lat: number): [number, number] {
  const phi = (clamp(lat, -MAX_LAT, MAX_LAT) * Math.PI) / 180;
  return [(lon + 180) / 360, (1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2];
}

export function unproject(x: number, y: number): { lon: number; lat: number } {
  return { lon: x * 360 - 180, lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI };
}

// ─── Basemap and tile layers ────────────────────────────────────────────────

export interface TileSource {
  url: (z: number, x: number, y: number) => string;
  /** Deepest zoom the server has tiles for; closer views scale those up. */
  maxZoom: number;
  attribution: string;
}

const ESRI: Record<string, { service: string; maxZoom: number }> = {
  streets: { service: 'World_Street_Map', maxZoom: 18 },
  'world-imagery': { service: 'World_Imagery', maxZoom: 18 },
  'world-physical': { service: 'World_Physical_Map', maxZoom: 8 },
  topo: { service: 'World_Topo_Map', maxZoom: 18 },
  'usa-topo': { service: 'USA_Topo_Maps', maxZoom: 15 },
  ocean: { service: 'Ocean/World_Ocean_Base', maxZoom: 10 },
};

const TILE_LAYERS = new Set(['default', 'carto', 'esri-xyz', 'xyz', 'osm-standard']);

const fillTemplate = (template: string, z: number, x: number, y: number) =>
  template
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{-y}', String(2 ** z - 1 - y))
    .replace('{y}', String(y));

const stripTags = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&copy;/g, '©').trim();

/**
 * Tiles for one of Grafana's raster layer types. `default` (and anything dashkit can't draw, such as vector
 * `maplibre` styles) is CARTO, Grafana's own default basemap. `retina` asks CARTO for 512px tiles.
 */
export function tileSource(layer: { type?: string; config?: Record<string, any> } | undefined, scheme: 'light' | 'dark', retina = false): TileSource {
  const config = layer?.config ?? {};
  switch (layer?.type) {
    case 'osm-standard':
      return { url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`, maxZoom: 19, attribution: '© OpenStreetMap contributors' };
    case 'esri-xyz': {
      const server = ESRI[config.server as string];
      if (!server && config.url) return xyz(config.url, config.attribution, 18);
      const { service, maxZoom } = server ?? ESRI.streets;
      return {
        url: (z, x, y) => `https://services.arcgisonline.com/arcgis/rest/services/${service}/MapServer/tile/${z}/${y}/${x}`,
        maxZoom,
        attribution: 'Tiles © Esri',
      };
    }
    case 'xyz':
      if (config.url) return xyz(config.url, config.attribution, config.maxZoom ?? MAX_ZOOM);
  }
  const dark = config.theme === 'dark' || (config.theme !== 'light' && scheme === 'dark');
  const style = `${dark ? 'dark' : 'light'}_${config.showLabels === false ? 'nolabels' : 'all'}`;
  return {
    url: (z, x, y) => `https://${'abcd'[(x + y) % 4]}.basemaps.cartocdn.com/${style}/${z}/${x}/${y}${retina ? '@2x' : ''}.png`,
    maxZoom: 20,
    attribution: '© CARTO © OpenStreetMap contributors',
  };
}

function xyz(template: string, attribution: unknown, maxZoom: number): TileSource {
  return { url: (z, x, y) => fillTemplate(template, z, x, y), maxZoom, attribution: typeof attribution === 'string' ? stripTags(attribution) : '' };
}

/** One tile to draw, positioned in panel px. */
export interface PlacedTile {
  key: string;
  url: string;
  left: number;
  top: number;
  size: number;
}

/**
 * The tiles covering a width × height panel centred on `view`. Tiles come from the nearest whole zoom (never past
 * the source's max) and are scaled to the fractional zoom; they repeat sideways when the world is narrower than the panel.
 */
export function visibleTiles(source: TileSource, view: MapView, width: number, height: number): PlacedTile[] {
  const z = clamp(Math.round(view.zoom), 0, source.maxZoom);
  const n = 2 ** z;
  const size = TILE * 2 ** (view.zoom - z);
  const [cx, cy] = project(view.lon, view.lat);
  // Panel px of tile (0, 0)'s top-left corner.
  const ox = width / 2 - cx * n * size;
  const oy = height / 2 - cy * n * size;
  const out: PlacedTile[] = [];
  const tx0 = Math.floor(-ox / size);
  const tx1 = Math.ceil((width - ox) / size) - 1;
  const ty0 = Math.max(0, Math.floor(-oy / size));
  const ty1 = Math.min(n - 1, Math.ceil((height - oy) / size) - 1);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const wx = ((tx % n) + n) % n;
      out.push({ key: `${z}/${tx}/${ty}`, url: source.url(z, wx, ty), left: ox + tx * size, top: oy + ty * size, size });
    }
  }
  return out;
}

// ─── View ───────────────────────────────────────────────────────────────────

export interface MapView {
  lon: number;
  lat: number;
  zoom: number;
}

/** Grafana's named starting views. */
const REGIONS: Record<string, MapView> = {
  zero: { lat: 0, lon: 0, zoom: 1 },
  'north-america': { lat: 40, lon: -100, zoom: 4 },
  'south-america': { lat: -20, lon: -60, zoom: 3 },
  europe: { lat: 46, lon: 14, zoom: 4 },
  africa: { lat: 0, lon: 30, zoom: 3 },
  'west-asia': { lat: 26, lon: 53, zoom: 4 },
  'south-asia': { lat: 19.5, lon: 80, zoom: 4 },
  'south-east-asia': { lat: 10, lon: 106, zoom: 4 },
  'east-asia': { lat: 33, lon: 120, zoom: 4 },
  australia: { lat: -25, lon: 135, zoom: 4 },
  oceania: { lat: -10, lon: -140, zoom: 3 },
};

export function zoomLimits(panel: Panel): [number, number] {
  const v = panel.options?.view ?? {};
  return [v.minZoom ?? 0, v.maxZoom ?? MAX_ZOOM];
}

/**
 * Where the map starts, from `options.view`: fixed coordinates, a named region, or `fit` to the data (padded by
 * `padding` percent and no closer than the saved zoom). Fit uses every data layer unless `allLayers` is false,
 * then only the layer named `layer`; `lastOnly` fits the last point of each frame.
 */
export function initialView(panel: Panel, layers: GeoLayer[], width: number, height: number): MapView {
  const v = panel.options?.view ?? {};
  const [minZoom, maxZoom] = zoomLimits(panel);
  const limit = (view: MapView) => ({ ...view, zoom: clamp(view.zoom, minZoom, maxZoom) });
  if (v.id === 'coords') return limit({ lat: v.lat ?? 0, lon: v.lon ?? 0, zoom: v.zoom ?? 1 });
  if (v.id !== 'fit') {
    const region = REGIONS[v.id] ?? REGIONS.zero;
    return limit({ ...region, zoom: v.zoom ?? region.zoom });
  }

  const fitted = layers.filter((l): l is DataLayer => l.type !== 'tiles' && (v.allLayers !== false || l.name === v.layer));
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const l of fitted) {
    for (const p of l.points) {
      const from = v.lastOnly ? p.xs.length - 1 : 0;
      for (let i = Math.max(0, from); i < p.xs.length; i++) {
        x0 = Math.min(x0, p.xs[i]);
        x1 = Math.max(x1, p.xs[i]);
        y0 = Math.min(y0, p.ys[i]);
        y1 = Math.max(y1, p.ys[i]);
      }
    }
  }
  if (x0 === Infinity) return limit(REGIONS.zero);
  const cap = Math.min(v.zoom ?? v.maxZoom ?? 15, maxZoom);
  const { lon, lat } = unproject((x0 + x1) / 2, (y0 + y1) / 2);
  const span = Math.max((x1 - x0) / Math.max(width, 1), (y1 - y0) / Math.max(height, 1)) * TILE;
  const fit = span > 0 ? -Math.log2(span) - Math.log2(1 + (v.padding ?? 5) / 100) : cap;
  return { lon, lat, zoom: clamp(Math.min(fit, cap), minZoom, maxZoom) };
}

// ─── Data layers ────────────────────────────────────────────────────────────

/** Located rows of one frame, with per-point styling. Arrays are parallel to `rows`. */
export interface GeoPoints {
  frame: DataFrame;
  rows: number[];
  /** World coordinates (see project). */
  xs: number[];
  ys: number[];
  colors: string[];
  /** Marker radius (markers), or heatmap weight. */
  sizes: number[];
  labels?: string[];
}

export type MarkerSymbol = 'circle' | 'square' | 'triangle' | 'star' | 'cross' | 'x';

export interface LegendEntry {
  key: string;
  name: string;
  color: string;
}

interface LayerBase {
  key: string;
  name: string;
  /** The whole layer's opacity. */
  opacity: number;
}

export interface MarkersLayer extends LayerBase {
  type: 'markers';
  points: GeoPoints[];
  symbol: MarkerSymbol;
  fillOpacity: number;
  fontSize: number;
  labelOffset: [number, number];
  tooltip: boolean;
  legend: LegendEntry[];
}

export interface RouteLayer extends LayerBase {
  type: 'route';
  points: GeoPoints[];
  lineWidth: number;
  tooltip: boolean;
  legend: LegendEntry[];
}

export interface HeatmapLayer extends LayerBase {
  type: 'heatmap';
  points: GeoPoints[];
  radius: number;
  blur: number;
  tooltip: false;
}

export interface TilesLayer extends LayerBase {
  type: 'tiles';
  source: TileSource;
}

export type DataLayer = MarkersLayer | RouteLayer | HeatmapLayer;
export type GeoLayer = DataLayer | TilesLayer;

/** A Grafana style dimension: a fixed value, or one scaled from a field. */
interface Dimension<T> {
  fixed?: T;
  field?: string;
  min?: number;
  max?: number;
  mode?: string;
}

interface Location {
  mode?: string;
  latitude?: string;
  longitude?: string;
  geohash?: string;
  lookup?: string;
  /** Lookup mode: the gazetteer's path on the Grafana server, or a URL. */
  gazetteer?: string;
}

interface LayerOptions {
  type?: string;
  name?: string;
  config?: Record<string, any>;
  location?: Location;
  filterData?: { id?: string; options?: unknown };
  tooltip?: boolean;
  opacity?: number;
}

/** Layers Grafana adds to a new geomap panel. */
const DEFAULT_LAYERS: LayerOptions[] = [{ type: 'markers', name: 'Layer 1', config: {}, location: { mode: 'auto' } }];

/**
 * The basemap and data layers of a geomap panel, bottom first. Data layers are `markers`, `heatmap`, `route` and
 * `lastPointTracker`; raster layers (`xyz`, `carto`, …) draw over the basemap. Other layer types (geojson,
 * photos, day/night, …) are skipped. Lookup layers find places in `gazetteers`, keyed by path.
 */
export function geomapLayers(
  panel: Panel,
  frames: DataFrame[],
  scheme: 'light' | 'dark',
  retina = false,
  gazetteers: Record<string, Gazetteer> = {},
): GeoLayer[] {
  const o = panel.options ?? {};
  const out: GeoLayer[] = [];
  const basemap = o.basemap as LayerOptions | undefined;
  out.push({ type: 'tiles', key: 'basemap', name: basemap?.name ?? 'Basemap', opacity: basemap?.opacity ?? 1, source: tileSource(basemap, scheme, retina) });
  const multiple = frames.length > 1;

  ((o.layers as LayerOptions[] | undefined) ?? DEFAULT_LAYERS).forEach((layer, li) => {
    const key = `${li}/${layer.type}`;
    const name = layer.name ?? `Layer ${li + 1}`;
    const opacity = layer.opacity ?? 1;
    const config = layer.config ?? {};
    if (layer.type && TILE_LAYERS.has(layer.type)) {
      out.push({ type: 'tiles', key, name, opacity, source: tileSource(layer, scheme, retina) });
      return;
    }
    if (!isDataLayer(layer.type)) return;

    const filter = layer.filterData;
    const chosen = filter?.id === 'byRefId' && filter.options ? frames.filter((f) => f.refId === filter.options) : frames;
    const style = (config.style ?? {}) as Record<string, any>;
    const color = (style.color ?? {}) as Dimension<string>;
    const size = (style.size ?? {}) as Dimension<number>;
    const text = style.text as Dimension<string> | undefined;
    const fixedColor = resolveColor(color.fixed ?? 'dark-green', '#37872D');
    const heat = layer.type === 'heatmap';
    const weight = (config.weight ?? {}) as Dimension<number>;
    const legend: LegendEntry[] = [];

    const points: GeoPoints[] = [];
    for (const frame of chosen) {
      const located = locate(frame, layer.location, gazetteers);
      if (!located) continue;
      let { rows } = located;
      let { xs, ys } = located;
      if (layer.type === 'lastPointTracker' && rows.length) [rows, xs, ys] = [rows.slice(-1), xs.slice(-1), ys.slice(-1)];
      const find = (field?: string) => (field ? fieldByName(frame, field, multiple) : undefined);
      const configOf = (f: Field) => resolveFieldConfig(panel, f, frame, fieldDisplayName(f, frame, multiple));

      let colors = rows.map(() => fixedColor);
      const colorField = !heat ? find(color.field) : undefined;
      if (colorField) {
        const cConfig = configOf(colorField);
        const values = rows.map((i) => num(colorField.values[i]));
        const extent = range(values);
        colors = values.map((v) => valueColor(v, cConfig, fixedColor, extent));
        if (showsLegend(layer) && legend.length === 0) legend.push(...thresholdLegend(`${key}/${frames.indexOf(frame)}`, cConfig, fixedColor));
      }

      const dim = heat ? weight : size;
      const sizeField = find(dim.field);
      let sizes = rows.map(() => dim.fixed ?? (heat ? 1 : 5));
      if (sizeField) {
        const values = rows.map((i) => num(sizeField.values[i]));
        const sConfig = configOf(sizeField);
        const ext = range(values) ?? [0, 1];
        const [lo, hi] = [sConfig.min ?? ext[0], sConfig.max ?? ext[1]];
        const [min, max] = [dim.min ?? (heat ? 0 : 2), dim.max ?? (heat ? 1 : 15)];
        sizes = values.map((v) => (v == null ? min : min + clamp((v - lo) / (hi - lo || 1), 0, 1) * (max - min)));
      }

      let labels: string[] | undefined;
      if (text && !heat) {
        const textField = text.mode === 'field' || (text.field && text.mode !== 'fixed') ? find(text.field) : undefined;
        if (textField) {
          const tConfig = configOf(textField);
          labels = rows.map((i) => cellText(textField, textField.values[i], tConfig));
        } else if (text.fixed) labels = rows.map(() => String(text.fixed));
      }
      points.push({ frame, rows, xs, ys, colors, sizes, labels });
    }

    const tooltip = layer.tooltip !== false;
    if (heat) out.push({ type: 'heatmap', key, name, opacity, points, radius: config.radius ?? 5, blur: config.blur ?? 15, tooltip: false });
    else if (layer.type === 'route')
      out.push({ type: 'route', key, name, opacity: opacity * (style.opacity ?? 1), points, lineWidth: style.lineWidth ?? 2, tooltip, legend });
    else {
      const textConfig = (style.textConfig ?? {}) as Record<string, number | undefined>;
      out.push({
        type: 'markers',
        key,
        name,
        opacity,
        points,
        symbol: markerSymbol(style.symbol?.fixed),
        fillOpacity: style.opacity ?? 0.4,
        fontSize: textConfig.fontSize ?? 12,
        labelOffset: [textConfig.offsetX ?? 0, textConfig.offsetY ?? 0],
        tooltip,
        legend,
      });
    }
  });
  return out;
}

const showsLegend = (layer: LayerOptions) => layer.config?.showLegend !== false;

/** `img/icons/marker/triangle.svg` → triangle. Grafana's other icons are drawn as circles. */
function markerSymbol(path: unknown): MarkerSymbol {
  const name = typeof path === 'string' ? path.replace(/^.*\//, '').replace(/\.svg$/, '') : '';
  return name === 'square' || name === 'triangle' || name === 'star' || name === 'cross' || name === 'x' ? name : 'circle';
}

/** Threshold steps as legend entries: "< 80", "80+". */
function thresholdLegend(key: string, config: FieldConfig, fallback: string): LegendEntry[] {
  if (config.color?.mode && config.color.mode !== 'thresholds') return [];
  const steps = config.thresholds?.steps ?? [];
  if (steps.length < 2) return [];
  return steps.map((s, i) => ({
    key: `${key}/${i}`,
    name: s.value == null ? `< ${formatValue(steps[i + 1].value, config)}` : `${formatValue(s.value, config)}+`,
    color: resolveColor(s.color, fallback),
  }));
}

const isDataLayer = (type?: string) => type === 'markers' || type === 'heatmap' || type === 'route' || type === 'lastPointTracker';

const lookupField = (frame: DataFrame) => frame.fields.find((f) => f.name.toLowerCase() === 'lookup');

/**
 * The gazetteers a panel's layers need: the one each lookup layer names (countries by default), and the default
 * for auto layers when a frame has a field called "lookup". Load these and pass them to geomapLayers.
 */
export function gazetteerPaths(panel: Panel, frames: DataFrame[]): string[] {
  const paths = new Set<string>();
  for (const layer of (panel.options?.layers as LayerOptions[] | undefined) ?? DEFAULT_LAYERS) {
    if (!isDataLayer(layer.type)) continue;
    const mode = layer.location?.mode ?? 'auto';
    if (mode === 'lookup') paths.add(layer.location?.gazetteer || DEFAULT_GAZETTEER);
    else if (mode === 'auto' && frames.some(lookupField)) paths.add(DEFAULT_GAZETTEER);
  }
  return [...paths];
}

const LAT_NAMES = ['lat', 'latitude'];
const LON_NAMES = ['lon', 'lng', 'long', 'longitude'];

function fieldByName(frame: DataFrame, name: string, multiple: boolean): Field | undefined {
  return frame.fields.find((f) => f.name === name) ?? frame.fields.find((f) => fieldDisplayName(f, frame, multiple) === name);
}

/**
 * Rows of a frame that have a location, as world coordinates. `coords` reads named latitude/longitude fields,
 * `geohash` decodes a geohash field, and `auto` (the default) looks for fields called lat/latitude and
 * lon/lng/long/longitude, else geohash, else a field called "lookup". `lookup` finds each row's value of the
 * `lookup` field in a gazetteer from `gazetteers` (by path, see gazetteerPaths); rows it doesn't know are skipped.
 */
export function locate(
  frame: DataFrame,
  location: Location = {},
  gazetteers: Record<string, Gazetteer> = {},
): { rows: number[]; xs: number[]; ys: number[] } | undefined {
  const mode = location.mode ?? 'auto';
  const named = (names: string[]) => frame.fields.find((f) => names.includes(f.name.toLowerCase()));
  let lat: Field | undefined;
  let lon: Field | undefined;
  let hash: Field | undefined;
  let lookup: Field | undefined;
  let gazetteer: Gazetteer | undefined;
  if (mode === 'coords') {
    lat = location.latitude ? fieldByName(frame, location.latitude, false) : undefined;
    lon = location.longitude ? fieldByName(frame, location.longitude, false) : undefined;
  } else if (mode === 'geohash') {
    hash = location.geohash ? fieldByName(frame, location.geohash, false) : named(['geohash']);
  } else if (mode === 'auto') {
    lat = named(LAT_NAMES);
    lon = named(LON_NAMES);
    if (!lat || !lon) hash = named(['geohash']);
    if ((!lat || !lon) && !hash) [lookup, gazetteer] = [lookupField(frame), gazetteers[DEFAULT_GAZETTEER]];
  } else if (mode === 'lookup') {
    lookup = location.lookup ? fieldByName(frame, location.lookup, false) : lookupField(frame);
    gazetteer = gazetteers[location.gazetteer || DEFAULT_GAZETTEER];
  }
  const rows: number[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  const add = (i: number, lo: number, la: number) => {
    if (!Number.isFinite(lo) || !Number.isFinite(la) || Math.abs(la) > 90) return;
    const [x, y] = project(lo, la);
    rows.push(i);
    xs.push(x);
    ys.push(y);
  };
  if (lat && lon) {
    const n = Math.min(lat.values.length, lon.values.length);
    for (let i = 0; i < n; i++) if (lat.values[i] != null && lon.values[i] != null) add(i, Number(lon.values[i]), Number(lat.values[i]));
  } else if (hash) {
    hash.values.forEach((v, i) => {
      const p = typeof v === 'string' ? decodeGeohash(v) : undefined;
      if (p) add(i, p.lon, p.lat);
    });
  } else if (lookup && gazetteer) {
    lookup.values.forEach((v, i) => {
      const p = v == null || v === '' ? undefined : gazetteer.find(String(v));
      if (p) add(i, p.lon, p.lat);
    });
  } else return undefined;
  return { rows, xs, ys };
}

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/** The centre of a geohash cell. */
export function decodeGeohash(hash: string): { lon: number; lat: number } | undefined {
  if (!hash) return undefined;
  const lat = [-90, 90];
  const lon = [-180, 180];
  let even = true;
  for (const c of hash.toLowerCase()) {
    const d = BASE32.indexOf(c);
    if (d < 0) return undefined;
    for (let bit = 4; bit >= 0; bit--) {
      const r = even ? lon : lat;
      const mid = (r[0] + r[1]) / 2;
      if ((d >> bit) & 1) r[0] = mid;
      else r[1] = mid;
      even = !even;
    }
  }
  return { lon: (lon[0] + lon[1]) / 2, lat: (lat[0] + lat[1]) / 2 };
}

function cellText(field: Field, v: unknown, config: FieldConfig): string {
  if (v == null) return '';
  if (field.type === 'number') return formatDisplay(Number(v), config);
  if (field.type === 'time') return new Date(toMillis(v)).toLocaleString();
  return String(v);
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function range(values: Array<number | null>): [number, number] | undefined {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v == null) continue;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return lo === Infinity ? undefined : [lo, hi];
}

// ─── Drawing helpers ────────────────────────────────────────────────────────

/** Panel px of world coordinates, using the copy of the world nearest the centre. */
export function screenProjector(view: MapView, width: number, height: number) {
  const [cx, cy] = project(view.lon, view.lat);
  const world = TILE * 2 ** view.zoom;
  return (x: number, y: number): [number, number] => [(x - cx - Math.round(x - cx)) * world + width / 2, (y - cy) * world + height / 2];
}

/** The view after dragging the map by (dx, dy) px. */
export function panView(view: MapView, dx: number, dy: number): MapView {
  const [cx, cy] = project(view.lon, view.lat);
  const world = TILE * 2 ** view.zoom;
  const x = cx - dx / world;
  const { lon, lat } = unproject(x - Math.floor(x), clamp(cy - dy / world, 0, 1));
  return { ...view, lon, lat };
}

/** SVG path of a marker centred on (x, y) with radius r. */
export function symbolPath(symbol: MarkerSymbol, x: number, y: number, r: number): string {
  switch (symbol) {
    case 'square':
      return `M${x - r},${y - r}h${2 * r}v${2 * r}h${-2 * r}Z`;
    case 'triangle':
      return `M${x},${y - r}L${x + r * 0.866},${y + r / 2}L${x - r * 0.866},${y + r / 2}Z`;
    case 'star': {
      let d = '';
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? r * 0.45 : r;
        d += `${i ? 'L' : 'M'}${x + rr * Math.cos(a)},${y + rr * Math.sin(a)}`;
      }
      return `${d}Z`;
    }
    case 'cross':
      return `M${x - r},${y}h${2 * r}M${x},${y - r}v${2 * r}`;
    case 'x': {
      const k = r * 0.707;
      return `M${x - k},${y - k}l${2 * k},${2 * k}M${x - k},${y + k}l${2 * k},${-2 * k}`;
    }
    default:
      return `M${x - r},${y}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;
  }
}

/** OpenLayers' default heatmap gradient, low to high. */
const HEAT_GRADIENT = ['#0000ff', '#00ffff', '#00ff00', '#ffff00', '#ff0000'];
const HEAT_LEVELS = 32;

function heatColor(t: number): string {
  const at = t * (HEAT_GRADIENT.length - 1);
  const i = Math.min(Math.floor(at), HEAT_GRADIENT.length - 2);
  const ch = (hex: string, k: number) => parseInt(hex.slice(1 + k * 2, 3 + k * 2), 16);
  const f = at - i;
  return `#${[0, 1, 2].map((k) => Math.round(ch(HEAT_GRADIENT[i], k) + (ch(HEAT_GRADIENT[i + 1], k) - ch(HEAT_GRADIENT[i], k)) * f).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * A heatmap as OpenLayers draws it: each point is a disc of `radius` px blurred by `blur` px with its weight as
 * alpha, the alphas composite, and the total picks a color from blue to red. Computed on a grid of `cell` px
 * squares and returned as one path per color level, so thousands of points stay a handful of SVG elements.
 */
export function heatmapCells(
  px: number[],
  py: number[],
  weights: number[],
  radius: number,
  blur: number,
  width: number,
  height: number,
  cell = 4,
): Array<{ color: string; opacity: number; d: string }> {
  const cols = Math.ceil(width / cell);
  const rowsN = Math.ceil(height / cell);
  if (cols <= 0 || rowsN <= 0) return [];
  // Summed -ln(1 - alpha) per cell: source-over compositing of alphas becomes addition.
  const acc = new Float32Array(cols * rowsN);
  const sigma = blur / 2;
  const s2 = sigma * sigma + (radius * radius) / 2;
  const peak = sigma > 0 ? 1 - Math.exp(-(radius * radius) / (2 * sigma * sigma)) : 1;
  const reach = 3 * Math.sqrt(s2);
  for (let i = 0; i < px.length; i++) {
    const w = clamp(weights[i], 0, 1) * peak;
    if (w <= 0) continue;
    const c0 = Math.max(0, Math.floor((px[i] - reach) / cell));
    const c1 = Math.min(cols - 1, Math.floor((px[i] + reach) / cell));
    const r0 = Math.max(0, Math.floor((py[i] - reach) / cell));
    const r1 = Math.min(rowsN - 1, Math.floor((py[i] + reach) / cell));
    for (let r = r0; r <= r1; r++) {
      const dy = (r + 0.5) * cell - py[i];
      for (let c = c0; c <= c1; c++) {
        const dx = (c + 0.5) * cell - px[i];
        const a = w * Math.exp(-(dx * dx + dy * dy) / (2 * s2));
        if (a > 0.001) acc[r * cols + c] += -Math.log(1 - Math.min(a, 0.999));
      }
    }
  }
  const paths: string[][] = Array.from({ length: HEAT_LEVELS }, () => []);
  for (let r = 0; r < rowsN; r++) {
    for (let c = 0; c < cols; c++) {
      const s = acc[r * cols + c];
      if (!s) continue;
      const level = Math.round((1 - Math.exp(-s)) * (HEAT_LEVELS - 1));
      if (level > 0) paths[level].push(`M${c * cell},${r * cell}h${cell}v${cell}h${-cell}Z`);
    }
  }
  return paths.flatMap((parts, level) => {
    const t = level / (HEAT_LEVELS - 1);
    return parts.length ? [{ color: heatColor(t), opacity: t, d: parts.join('') }] : [];
  });
}
