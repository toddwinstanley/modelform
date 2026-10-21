import type { DataSource } from './datasource';

/**
 * Grafana gazetteers: named places with coordinates, for geomap layers that locate rows by a lookup field
 * (a country code, a state, an airport). Grafana serves its own under public/gazetteer/.
 */
export interface Gazetteer {
  find(key: string): { lon: number; lat: number } | undefined;
}

/** The gazetteer Grafana uses when a lookup layer names none. */
export const DEFAULT_GAZETTEER = 'public/gazetteer/countries.json';

type Point = { lon: number; lat: number };

/**
 * Reads the formats Grafana ships: a list of places with `key`/`keys`, `name`, `latitude`/`longitude`
 * (countries.json, usa-states.json), or a GeoJSON FeatureCollection (airports.geojson), whose features are found
 * by id or any text property. Keys match exactly first, then ignoring case.
 */
export function parseGazetteer(json: unknown): Gazetteer {
  const exact = new Map<string, Point>();
  const folded = new Map<string, Point>();
  const add = (key: unknown, p: Point) => {
    if ((typeof key !== 'string' && typeof key !== 'number') || key === '') return;
    const k = String(key);
    if (!exact.has(k)) exact.set(k, p);
    if (!folded.has(k.toLowerCase())) folded.set(k.toLowerCase(), p);
  };

  if (Array.isArray(json)) {
    for (const item of json as Array<Record<string, any>>) {
      const lat = Number(item?.latitude ?? item?.lat);
      const lon = Number(item?.longitude ?? item?.lon ?? item?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const p = { lon, lat };
      add(item.key, p);
      for (const k of [...(item.keys ?? []), ...(item.keywords ?? [])]) add(k, p);
      add(item.name, p);
    }
  } else if ((json as { type?: string })?.type === 'FeatureCollection') {
    for (const f of (json as { features?: Array<Record<string, any>> }).features ?? []) {
      const p = featurePoint(f?.geometry);
      if (!p) continue;
      add(f.id, p);
      for (const v of Object.values(f.properties ?? {})) if (typeof v === 'string') add(v, p);
    }
  }

  return { find: (key) => exact.get(key) ?? folded.get(key.toLowerCase()) };
}

/** A Point's coordinates, or the middle of any other geometry's bounding box. */
function featurePoint(geometry: { type?: string; coordinates?: unknown } | undefined): Point | undefined {
  if (!geometry?.coordinates) return undefined;
  if (geometry.type === 'Point') {
    const [lon, lat] = geometry.coordinates as number[];
    return Number.isFinite(lon) && Number.isFinite(lat) ? { lon, lat } : undefined;
  }
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number') {
      x0 = Math.min(x0, c[0]);
      x1 = Math.max(x1, c[0]);
      y0 = Math.min(y0, c[1]);
      y1 = Math.max(y1, c[1]);
    } else c.forEach(walk);
  };
  walk(geometry.coordinates);
  return x0 === Infinity ? undefined : { lon: (x0 + x1) / 2, lat: (y0 + y1) / 2 };
}

const NO_SOURCE = {};
const cache = new WeakMap<object, Map<string, Promise<Gazetteer>>>();

/**
 * Loads a gazetteer once per datasource. An http(s) URL is fetched directly; a path such as
 * public/gazetteer/usa-states.json comes from the datasource's Grafana (see DataSource.publicFile).
 * A failed load isn't cached, so the next panel to ask tries again.
 */
export function loadGazetteer(path: string, ds?: DataSource): Promise<Gazetteer> {
  const absolute = /^https?:\/\//i.test(path);
  const owner = absolute || !ds ? NO_SOURCE : ds;
  const loaded = cache.get(owner) ?? cache.set(owner, new Map()).get(owner)!;
  let result = loaded.get(path);
  if (!result) {
    const json = absolute
      ? fetch(path).then((r) => {
          if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
          return r.json();
        })
      : ds?.publicFile
        ? ds.publicFile(path)
        : Promise.reject(new Error(`${path} is served by Grafana, and this dashboard has no Grafana connection`));
    const run = json.then(parseGazetteer);
    run.catch(() => loaded.get(path) === run && loaded.delete(path));
    loaded.set(path, run);
    result = run;
  }
  return result;
}
