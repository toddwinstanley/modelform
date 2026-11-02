// @vitest-environment jsdom
/**
 * The contract the app relies on to load configs at runtime: any panel the loader accepts
 * renders without throwing. Starting from real dashboards and forms and a template of every
 * panel type, this mutates panels at random (deterministically, from a seed), readies each as
 * the loader does (prepareDashboard), and renders whatever it lets through, with data, at two sizes.
 *
 * Reproduce or widen a run with FUZZ_SEED and FUZZ_COUNT, e.g. FUZZ_COUNT=3000 pnpm test.
 */
import './render/dom';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DashboardProvider,
  InputFormContext,
  layoutDashboard,
  LocalDataSource,
  MemoryEntryStore,
  newPanel,
  PANEL_TYPES,
  PanelCard,
  panelOptions,
  prepareDashboard,
  type InputFormState,
  type NewEntry,
  type Panel,
} from '../src';
import { render } from './render/render';

const SEED = Number(process.env.FUZZ_SEED ?? 20261031);
const COUNT = Number(process.env.FUZZ_COUNT ?? 500);
const SIZES = [
  { width: 400, height: 300 },
  { width: 120, height: 60 },
];

const ROOT = path.resolve(__dirname, '../../..');
const FIXTURES = [
  'apps/studio/config/dashboards/trends.json',
  'apps/studio/config/dashboards/workouts.json',
  'apps/studio/config/forms/daily.json',
  'apps/studio/config/forms/workout.json',
  'apps/tracker/dashboards/insights.json',
  'apps/tracker/dashboards/setup.json',
  'apps/tracker/dashboards/track-day.json',
];

/** Every panel in the repo's dashboards and forms (rows' children too), and a template of each type. */
function seedPanels(): Panel[] {
  const out: Panel[] = [];
  for (const file of FIXTURES) {
    const d = JSON.parse(readFileSync(path.join(ROOT, file), 'utf8')) as Dashboard;
    for (const p of d.panels ?? []) out.push(p, ...(p.panels ?? []));
  }
  for (const type of new Set([...PANEL_TYPES.form, ...PANEL_TYPES.dashboard, 'geomap', 'xychart'])) out.push(newPanel(type, 'weight'));
  return out;
}

/** mulberry32: small, seedable, good enough to pick mutations. */
function prng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T,>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)] };
}
type Rng = ReturnType<typeof prng>;

type Path = (string | number)[];

/** Every place in a JSON value that can be changed: object keys and array items. */
function paths(value: unknown, at: Path = [], out: Path[] = []): Path[] {
  const children: [string | number, unknown][] = Array.isArray(value) ? value.map((v, i) => [i, v]) : value && typeof value === 'object' ? Object.entries(value) : [];
  for (const [k, v] of children) {
    out.push([...at, k]);
    paths(v, [...at, k], out);
  }
  return out;
}

const WEIRD: unknown[] = [null, 0, -1, 1, 0.5, -0.000001, 1e300, -1e300, 2 ** 53, '', ' ', 'x', '💥', 'a'.repeat(500), '${x}', '$__all', 'now-1y', true, false, [], {}, [null], [[]], { a: {} }, [0, ''], 'value', 'weight'];

/** Applies one random change in place and describes it. */
function mutate(root: Record<string, unknown>, rng: Rng): string {
  const all = paths(root);
  if (!all.length) return 'nothing to change';
  const at = rng.pick(all);
  const key = at[at.length - 1];
  let parent: unknown = root;
  for (const k of at.slice(0, -1)) parent = (parent as Record<string | number, unknown>)[k];
  const container = parent as Record<string | number, unknown>;
  const where = at.join('.');
  const options = panelOptions(String(root.type));
  if (options.length && rng.int(6) === 0) {
    // Somewhere the renderer reads, whether or not the panel sets it yet.
    const keys = rng.pick(options).path.split('.');
    let node = root;
    for (const k of keys.slice(0, -1)) node = (node[k] = node[k] && typeof node[k] === 'object' ? node[k] : {}) as Record<string, unknown>;
    const v = structuredClone(rng.pick(WEIRD));
    node[keys[keys.length - 1]] = v;
    return `set option ${keys.join('.')} to ${JSON.stringify(v)?.slice(0, 40)}`;
  }
  switch (rng.int(5)) {
    case 0:
      if (Array.isArray(container)) container.splice(key as number, 1);
      else delete container[key];
      return `delete ${where}`;
    case 1:
      if (Array.isArray(container)) {
        container.splice(key as number, 0, structuredClone(container[key as number]));
        return `duplicate ${where}`;
      }
      container[`${String(key)}_extra`] = structuredClone(container[key]);
      return `copy ${where} to an unknown key`;
    case 2: {
      // Another value already in the panel, so types from elsewhere land in the wrong place.
      const [donor] = [rng.pick(all)];
      let v: unknown = root;
      for (const k of donor) v = (v as Record<string | number, unknown>)?.[k];
      container[key] = structuredClone(v);
      return `set ${where} to ${donor.join('.')}'s value`;
    }
    default: {
      const v = structuredClone(rng.pick(WEIRD));
      container[key] = v;
      return `set ${where} to ${JSON.stringify(v)?.slice(0, 40)}`;
    }
  }
}

/** Metrics a panel reads or records, to give it data. */
function metricsIn(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => metricsIn(v, out));
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) {
      if (k === 'metric' && typeof v === 'string') out.add(v);
      else metricsIn(v, out);
    }
  return out;
}

function entriesFor(metrics: Set<string>): NewEntry[] {
  const now = Date.now();
  const day = 86_400_000;
  return [...metrics].flatMap((metric) =>
    Array.from({ length: 12 }, (_, i) => ({ metric, ts: now - i * 2.5 * day, value: i % 5 === 4 ? null : 50 + ((i * 7) % 13), text: i % 3 ? null : `t${i % 2}` })),
  );
}

const formState = (store: MemoryEntryStore): InputFormState => ({
  value: () => null,
  setValue: () => {},
  isDirty: () => false,
  store,
  choices: {},
});

interface Failure {
  case: number;
  mutations: string[];
  error: string;
  panel: string;
}

describe('any panel the validator accepts renders', () => {
  const warn = vi.spyOn(console, 'warn');
  const error = vi.spyOn(console, 'error');
  beforeAll(() => {
    warn.mockImplementation(() => {});
    error.mockImplementation(() => {});
  });
  afterAll(() => {
    warn.mockRestore();
    error.mockRestore();
  });

  it(`holds for ${COUNT} mutated panels (seed ${SEED})`, { timeout: 120_000 }, async () => {
    const rng = prng(SEED);
    const seeds = seedPanels();
    const failures: Failure[] = [];
    let accepted = 0;

    for (let n = 0; n < COUNT; n++) {
      const panel = structuredClone(rng.pick(seeds)) as unknown as Record<string, unknown>;
      const mutations = Array.from({ length: 1 + rng.int(3) }, () => mutate(panel, rng));
      // Only what a config could actually deliver: what the loader makes of the mutant.
      const { dashboard } = prepareDashboard({ title: 'Fuzz', time: { from: 'now-30d', to: 'now' }, panels: [panel] }, 'fuzz');
      if (!dashboard?.panels[0]) continue;
      const ready = dashboard.panels[0];
      accepted++;
      const fail = (e: unknown) => failures.push({ case: n, mutations, error: e instanceof Error ? e.message : String(e), panel: JSON.stringify(panel).slice(0, 400) });

      try {
        layoutDashboard(dashboard, 'phone');
        layoutDashboard(dashboard, 'grid');
      } catch (e) {
        fail(e);
        continue;
      }

      const store = new MemoryEntryStore(entriesFor(metricsIn(ready)));
      const local = new LocalDataSource(store);
      warn.mockClear();
      error.mockClear();
      try {
        const view = await render(
          <InputFormContext.Provider value={formState(store)}>
            <DashboardProvider dashboard={dashboard} resolve={() => local}>
              {SIZES.map((s, i) => (
                <PanelCard key={i} panel={ready} width={s.width} height={s.height} />
              ))}
            </DashboardProvider>
          </InputFormContext.Provider>,
        );
        await view.unmount();
      } catch (e) {
        fail(e);
        continue;
      }
      // PanelCard's boundary catches render errors; it reports each with console.warn.
      const caught = warn.mock.calls.find((c) => String(c[0]).includes('[dashkit] render failed'));
      if (caught) fail(caught[1]);
    }

    expect(accepted, 'too few mutants got past the validator to mean anything').toBeGreaterThan(COUNT / 4);
    expect(failures).toEqual([]);
  });
});
