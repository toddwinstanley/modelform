import { describe, expect, it } from 'vitest';
import type { DataFrame, Panel } from '../src/core';
import {
  decodeGeohash,
  geomapLayers,
  heatmapCells,
  initialView,
  locate,
  panView,
  project,
  screenProjector,
  tileSource,
  unproject,
  visibleTiles,
  type MarkersLayer,
} from '../src/ui/geomap';

const cities: DataFrame = {
  refId: 'A',
  fields: [
    { name: 'City', type: 'string', values: ['London', 'Paris', 'Nowhere', 'Berlin'] },
    { name: 'Latitude', type: 'number', values: [51.5, 48.86, null, 52.52] },
    { name: 'lng', type: 'number', values: [-0.12, 2.35, 10, 13.4] },
    { name: 'Visitors', type: 'number', values: [10, 50, 0, 90] },
  ],
};

const panel = (options: Record<string, any>, defaults: Record<string, any> = {}): Panel => ({
  type: 'geomap',
  gridPos: { x: 0, y: 0, w: 12, h: 10 },
  options,
  fieldConfig: { defaults, overrides: [] },
});

describe('geomap projection', () => {
  it('maps degrees to Web Mercator world coordinates and back', () => {
    expect(project(0, 0)).toEqual([0.5, 0.5]);
    expect(project(-180, 0)[0]).toBe(0);
    expect(project(0, 90)[1]).toBeCloseTo(0, 6);
    const { lon, lat } = unproject(...project(13.4, 52.52));
    expect(lon).toBeCloseTo(13.4, 9);
    expect(lat).toBeCloseTo(52.52, 9);
  });

  it('places the centre in the middle and wraps to the nearest copy of the world', () => {
    const at = screenProjector({ lon: 179, lat: 0, zoom: 2 }, 400, 300);
    expect(at(...project(179, 0))).toEqual([200, 150]);
    // -179° is 2° east of 179°, not 358° west.
    expect(at(...project(-179, 0))[0]).toBeCloseTo(200 + (2 / 360) * 1024, 6);
  });

  it('pans by screen pixels', () => {
    const v = panView({ lon: 0, lat: 0, zoom: 0 }, -64, 0);
    expect(v.lon).toBeCloseTo(90, 6);
    expect(panView({ lon: 0, lat: 0, zoom: 0 }, 0, 10_000).lat).toBeCloseTo(85.0511, 3);
  });
});

describe('geomap locations', () => {
  it('finds lat/lon fields by name in auto mode, skipping rows without both', () => {
    const l = locate(cities)!;
    expect(l.rows).toEqual([0, 1, 3]);
    expect(l.xs[0]).toBeCloseTo(project(-0.12, 51.5)[0], 12);
  });

  it('reads named fields in coords mode', () => {
    const frame: DataFrame = { fields: [{ name: 'y', type: 'number', values: [10] }, { name: 'x', type: 'string', values: ['20'] }] };
    expect(locate(frame, { mode: 'coords', latitude: 'y', longitude: 'x' })!.xs).toEqual([project(20, 10)[0]]);
    expect(locate(frame)).toBeUndefined();
  });

  it('decodes geohashes', () => {
    const p = decodeGeohash('u4pruydqqvj')!;
    expect(p.lat).toBeCloseTo(57.64911, 4);
    expect(p.lon).toBeCloseTo(10.40744, 4);
    expect(decodeGeohash('a')).toBeUndefined();
    const frame: DataFrame = { fields: [{ name: 'geohash', type: 'string', values: ['u4pruydqqvj', null] }] };
    expect(locate(frame)!.rows).toEqual([0]);
  });
});

describe('geomap layers', () => {
  it('defaults to CARTO under one auto markers layer', () => {
    const [base, markers] = geomapLayers(panel({}), [cities], 'dark');
    expect(base.type).toBe('tiles');
    expect(base.type === 'tiles' && base.source.url(1, 0, 1)).toBe('https://b.basemaps.cartocdn.com/dark_all/1/0/1.png');
    expect(markers).toMatchObject({ type: 'markers', symbol: 'circle', fillOpacity: 0.4 });
    expect((markers as MarkersLayer).points[0].colors).toEqual(['#37872D', '#37872D', '#37872D']);
  });

  it('colors and sizes markers by fields, labels them, and lists thresholds in the legend', () => {
    const p = panel(
      {
        layers: [
          {
            type: 'markers',
            name: 'Visits',
            config: {
              style: {
                color: { field: 'Visitors' },
                size: { field: 'Visitors', min: 4, max: 12 },
                symbol: { mode: 'fixed', fixed: 'img/icons/marker/triangle.svg' },
                text: { mode: 'field', field: 'City' },
              },
            },
          },
        ],
      },
      { color: { mode: 'thresholds' }, thresholds: { mode: 'absolute', steps: [{ color: 'green', value: null }, { color: 'red', value: 80 }] } },
    );
    const m = geomapLayers(p, [cities], 'light')[1] as MarkersLayer;
    expect(m.symbol).toBe('triangle');
    expect(m.points[0].colors).toEqual(['#73BF69', '#73BF69', '#F2495C']);
    expect(m.points[0].sizes).toEqual([4, 8, 12]);
    expect(m.points[0].labels).toEqual(['London', 'Paris', 'Berlin']);
    expect(m.legend.map((e) => e.name)).toEqual(['< 80', '80+']);
  });

  it('keeps only the last point for lastPointTracker and filters frames by refId', () => {
    const other = { ...cities, refId: 'B' };
    const layers = geomapLayers(panel({ layers: [{ type: 'lastPointTracker', filterData: { id: 'byRefId', options: 'B' } }] }), [cities, other], 'light');
    const l = layers[1] as MarkersLayer;
    expect(l.points).toHaveLength(1);
    expect(l.points[0].frame).toBe(other);
    expect(l.points[0].rows).toEqual([3]);
  });

  it('builds routes and heatmaps, and skips layer types it cannot draw', () => {
    const layers = geomapLayers(
      panel({ layers: [{ type: 'route', config: { style: { lineWidth: 3 } } }, { type: 'geojson' }, { type: 'heatmap', config: { weight: { field: 'Visitors' } } }] }),
      [cities],
      'light',
    );
    expect(layers.map((l) => l.type)).toEqual(['tiles', 'route', 'heatmap']);
    expect(layers[1]).toMatchObject({ lineWidth: 3 });
    expect(layers[2].type === 'heatmap' && layers[2].points[0].sizes).toEqual([0, 0.5, 1]);
  });
});

describe('geomap basemaps', () => {
  it('builds tile URLs for each raster type', () => {
    expect(tileSource({ type: 'carto', config: { theme: 'light', showLabels: false } }, 'dark', true).url(2, 1, 3)).toBe(
      'https://a.basemaps.cartocdn.com/light_nolabels/2/1/3@2x.png',
    );
    expect(tileSource({ type: 'osm-standard' }, 'light').url(2, 1, 3)).toBe('https://tile.openstreetmap.org/2/1/3.png');
    const esri = tileSource({ type: 'esri-xyz', config: { server: 'world-physical' } }, 'light');
    expect(esri.url(2, 1, 3)).toBe('https://services.arcgisonline.com/arcgis/rest/services/World_Physical_Map/MapServer/tile/2/3/1');
    expect(esri.maxZoom).toBe(8);
    const xyz = tileSource({ type: 'xyz', config: { url: 'https://t.example/{z}/{x}/{-y}.png', attribution: '<a href="x">&copy; Example</a>' } }, 'light');
    expect(xyz.url(2, 1, 0)).toBe('https://t.example/2/1/3.png');
    expect(xyz.attribution).toBe('© Example');
  });

  it('covers the panel with tiles, repeating the world sideways', () => {
    const source = tileSource(undefined, 'light');
    const tiles = visibleTiles(source, { lon: 0, lat: 0, zoom: 1 }, 512, 512);
    expect(tiles.map((t) => t.key)).toEqual(['1/0/0', '1/1/0', '1/0/1', '1/1/1']);
    const wide = visibleTiles(source, { lon: 0, lat: 0, zoom: 0 }, 600, 256);
    expect(wide.map((t) => [t.left, t.url.endsWith('/0/0/0.png')])).toEqual([
      [-84, true],
      [172, true],
      [428, true],
    ]);
    // Past the source's max zoom the deepest tiles are scaled up.
    const deep = visibleTiles({ ...source, maxZoom: 8 }, { lon: 0, lat: 0, zoom: 10 }, 100, 100);
    expect(deep[0].size).toBe(1024);
  });
});

describe('geomap view', () => {
  const layers = geomapLayers(panel({}), [cities], 'light');

  it('starts at fixed coordinates or a named region', () => {
    expect(initialView(panel({ view: { id: 'coords', lat: 10, lon: 20, zoom: 5 } }), layers, 400, 300)).toEqual({ lat: 10, lon: 20, zoom: 5 });
    expect(initialView(panel({ view: { id: 'europe' } }), layers, 400, 300)).toEqual({ lat: 46, lon: 14, zoom: 4 });
    expect(initialView(panel({}), layers, 400, 300)).toEqual({ lat: 0, lon: 0, zoom: 1 });
    expect(initialView(panel({ view: { id: 'coords', zoom: 12, maxZoom: 8 } }), layers, 400, 300).zoom).toBe(8);
  });

  it('fits the data with padding, no closer than the saved zoom', () => {
    const v = initialView(panel({ view: { id: 'fit' } }), layers, 400, 300);
    const at = screenProjector(v, 400, 300);
    const xs = [project(-0.12, 51.5), project(13.4, 52.52)].map((p) => at(...p)[0]);
    // The widest span fills the panel less the 5% padding.
    expect(xs[1] - xs[0]).toBeCloseTo(400 / 1.05, 6);
    expect(initialView(panel({ view: { id: 'fit', zoom: 3 } }), layers, 400, 300).zoom).toBe(3);
    const last = initialView(panel({ view: { id: 'fit', lastOnly: true } }), layers, 400, 300);
    expect([last.lat, last.lon, last.zoom].map((n) => Math.round(n * 100) / 100)).toEqual([52.52, 13.4, 15]);
  });
});

describe('geomap heatmap', () => {
  it('is hottest where points overlap and empty far from them', () => {
    const cells = heatmapCells([20, 22, 80], [20, 20, 80], [1, 1, 0.2], 5, 15, 100, 100);
    const hottest = cells[cells.length - 1];
    const coolest = cells[0];
    expect(hottest.opacity).toBeGreaterThan(coolest.opacity);
    expect(hottest.d).toMatch(/M(16|20),(16|20)h4/);
    expect(cells.some((c) => c.d.includes('M0,96h4'))).toBe(false);
    expect(heatmapCells([], [], [], 5, 15, 100, 100)).toEqual([]);
  });
});
