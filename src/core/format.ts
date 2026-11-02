import { formatClock } from './inputs';
import type { FieldConfig, MappingResult, ThresholdStep } from './schema';

/** Value formatting for the Grafana units people actually use. Unknown units fall back to "short". */
export function formatValue(value: number | null | undefined, config: FieldConfig = {}): string {
  if (value == null || Number.isNaN(value)) return '—';
  const unit = config.unit ?? 'short';
  const d = config.decimals;

  if (unit.startsWith('suffix:')) return `${fixed(value, d)}${unit.slice(7)}`;
  if (unit.startsWith('prefix:')) return `${unit.slice(7)}${fixed(value, d)}`;

  switch (unit) {
    case 'none':
      return fixed(value, d);
    case 'percent':
      return `${fixed(value, d ?? 1)}%`;
    case 'percentunit':
      return `${fixed(value * 100, d ?? 1)}%`;
    case 'bytes':
    case 'decbytes':
      return scaled(value, unit === 'bytes' ? 1024 : 1000, ['B', 'kB', 'MB', 'GB', 'TB', 'PB'], d);
    case 'bits':
      return scaled(value, 1000, ['b', 'kb', 'Mb', 'Gb', 'Tb'], d);
    case 'Bps':
    case 'binBps':
      return scaled(value, unit === 'binBps' ? 1024 : 1000, ['B/s', 'kB/s', 'MB/s', 'GB/s', 'TB/s'], d);
    case 'bps':
      return scaled(value, 1000, ['b/s', 'kb/s', 'Mb/s', 'Gb/s'], d);
    case 'reqps':
      return `${short(value, d)} req/s`;
    case 'ops':
      return `${short(value, d)} ops/s`;
    case 'ms':
      return duration(value, d);
    case 's':
      return duration(value * 1000, d);
    case 'dtdurations':
      return duration(value * 1000, d);
    case 'clocks':
      // Seconds as a lap time, MM:SS.hh (Grafana shows HH:mm:ss).
      return formatClock(value);
    case 'celsius':
      return `${fixed(value, d ?? 1)}°C`;
    case 'fahrenheit':
      return `${fixed(value, d ?? 1)}°F`;
    case 'currencyUSD':
      return `$${short(value, d ?? 2)}`;
    case 'currencyEUR':
      return `€${short(value, d ?? 2)}`;
    case 'currencyGBP':
      return `£${short(value, d ?? 2)}`;
    case 'masskg':
      return `${fixed(value, d ?? 1)} kg`;
    case 'masslb':
      return `${fixed(value, d ?? 1)} lb`;
    case 'bool':
      return value ? 'true' : 'false';
    case 'bool_yes_no':
      return value ? 'Yes' : 'No';
    case 'bool_on_off':
      return value ? 'On' : 'Off';
    case 'dateTimeAsIso':
      return new Date(value).toISOString();
    case 'dateTimeFromNow':
      return fromNow(value);
    default:
      return short(value, d);
  }
}

/** More decimals than anyone can read; Intl throws past 100. */
const MAX_DECIMALS = 20;

function fixed(v: number, decimals?: number): string {
  if (decimals != null) {
    const d = Math.min(MAX_DECIMALS, Math.max(0, Math.round(decimals)));
    return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  const abs = Math.abs(v);
  const auto = abs === 0 || abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : 3;
  return v.toLocaleString('en-US', { maximumFractionDigits: auto });
}

/** 1,284 / 12.9K / 4.2M */
function short(v: number, decimals?: number): string {
  return scaled(v, 1000, ['', 'K', 'M', 'B', 'T'], decimals, '');
}

function scaled(v: number, base: number, units: string[], decimals?: number, sep = ' '): string {
  let i = 0;
  let n = v;
  while (Math.abs(n) >= base && i < units.length - 1) {
    n /= base;
    i++;
  }
  // Keep thousands-comma'd numbers below the first step (e.g. 1,284) rather than "1.28K"
  if (i === 1 && units[0] === '' && Math.abs(v) < 10_000) return fixed(v, decimals ?? 0);
  const suffix = units[i];
  return suffix ? `${fixed(n, decimals)}${sep}${suffix}` : fixed(n, decimals);
}

function duration(ms: number, decimals?: number): string {
  const abs = Math.abs(ms);
  if (abs < 1000) return `${fixed(ms, decimals)} ms`;
  if (abs < 60_000) return `${fixed(ms / 1000, decimals)} s`;
  if (abs < 3_600_000) return `${fixed(ms / 60_000, decimals)} min`;
  if (abs < 86_400_000) return `${fixed(ms / 3_600_000, decimals)} hour`;
  return `${fixed(ms / 86_400_000, decimals)} day`;
}

function fromNow(t: number): string {
  const diff = Date.now() - t;
  const mins = Math.round(Math.abs(diff) / 60_000);
  const text = mins < 60 ? `${mins} minutes` : mins < 1440 ? `${Math.round(mins / 60)} hours` : `${Math.round(mins / 1440)} days`;
  return diff >= 0 ? `${text} ago` : `in ${text}`;
}

/** The step with the highest value at or below the value, in any order; the first step (the base, value null) below them all. */
export function thresholdStep(value: number | null, config: FieldConfig = {}): ThresholdStep | undefined {
  const steps = config.thresholds?.steps;
  if (!steps?.length) return undefined;
  if (value == null) return steps[0];
  let v = value;
  if (config.thresholds?.mode === 'percentage') {
    const min = config.min ?? 0;
    const max = config.max ?? 100;
    v = ((value - min) / (max - min || 1)) * 100;
  }
  let match = steps[0];
  let best = -Infinity;
  for (const s of steps)
    if (s.value != null && v >= s.value && s.value >= best) {
      match = s;
      best = s.value;
    }
  return match;
}

/**
 * Grafana's named colors. Panels created in Grafana reference these by name
 * (thresholds default to "green"/"red"), so they must resolve to the same hues.
 */
export const NAMED_COLORS: Record<string, string> = {
  green: '#73BF69',
  'semi-dark-green': '#56A64B',
  'dark-green': '#37872D',
  'light-green': '#96D98D',
  'super-light-green': '#C8F2C2',
  red: '#F2495C',
  'semi-dark-red': '#E02F44',
  'dark-red': '#C4162A',
  'light-red': '#FF7383',
  'super-light-red': '#FFA6B0',
  yellow: '#FADE2A',
  'semi-dark-yellow': '#F2CC0C',
  'dark-yellow': '#E0B400',
  'light-yellow': '#FFEE52',
  'super-light-yellow': '#FFF899',
  orange: '#FF9830',
  'semi-dark-orange': '#FF780A',
  'dark-orange': '#FA6400',
  'light-orange': '#FFB357',
  'super-light-orange': '#FFCB7D',
  blue: '#5794F2',
  'semi-dark-blue': '#3274D9',
  'dark-blue': '#1F60C4',
  'light-blue': '#8AB8FF',
  'super-light-blue': '#C0D8FF',
  purple: '#B877D9',
  'semi-dark-purple': '#A352CC',
  'dark-purple': '#8F3BB8',
  'light-purple': '#CA95E5',
  'super-light-purple': '#DEB6F2',
  text: '#888888',
  transparent: 'transparent',
};

/** Colors React Native accepts as-is: hex, rgb()/hsl(), and plain CSS names like `white`. */
const PASSTHROUGH = /^(#[0-9a-f]{3,8}|(rgba?|hsla?)\(.*\)|[a-z]+)$/i;

export function resolveColor(name: string | undefined, fallback: string): string {
  if (!name) return fallback;
  // An unrecognised Grafana name would throw in React Native, so fall back instead.
  return NAMED_COLORS[name] ?? (PASSTHROUGH.test(name) ? name : fallback);
}

/**
 * Default categorical series palette (validated for colorblind separation, assigned in fixed
 * order). Light and dark steps are tuned for each surface.
 */
export const SERIES_PALETTE = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
};

export function seriesColor(index: number, scheme: 'light' | 'dark', config?: FieldConfig): string {
  const palette = SERIES_PALETTE[scheme];
  // Past the palette, reuse is unavoidable; the legend still carries identity.
  const color = palette[index % palette.length];
  if (config?.color?.mode === 'fixed') return resolveColor(config.color.fixedColor, color);
  return color;
}

/** The text a value mapping gives a value, if any. Supports value, range and special mappings. */
export function mappedResult(value: unknown, config: FieldConfig = {}): MappingResult | undefined {
  for (const m of config.mappings ?? []) {
    if (m.type === 'value') {
      const hit = (m.options as Record<string, MappingResult>)[String(value)];
      if (hit) return hit;
    } else if (m.type === 'range') {
      const { from, to, result } = m.options as { from?: number | null; to?: number | null; result: MappingResult };
      const v = Number(value);
      if (value != null && !Number.isNaN(v) && (from == null || v >= from) && (to == null || v <= to)) return result;
    } else if (m.type === 'regex') {
      const { pattern, result } = m.options as { pattern: string; result: MappingResult };
      if (value == null) continue;
      const re = regexOf(pattern);
      const match = re && String(value).match(re);
      // Grafana substitutes capture groups ($1) into the mapped text.
      if (match) return { ...result, text: result.text?.replace(/\$(\d+)/g, (_, n) => match[Number(n)] ?? '') };
    } else if (m.type === 'special') {
      const { match, result } = m.options as { match: string; result: MappingResult };
      const isNull = value == null;
      const isNaN = typeof value === 'number' && Number.isNaN(value);
      if (
        (match === 'null' && isNull) ||
        (match === 'nan' && isNaN) ||
        (match === 'null+nan' && (isNull || isNaN)) ||
        (match === 'empty' && value === '') ||
        (match === 'true' && value === true) ||
        (match === 'false' && value === false)
      )
        return result;
    }
  }
  return undefined;
}

function regexOf(pattern: string): RegExp | undefined {
  const m = /^\/(.*)\/([a-z]*)$/.exec(pattern);
  try {
    return m ? new RegExp(m[1], m[2]) : new RegExp(pattern);
  } catch {
    return undefined;
  }
}

/** formatValue, with the field's value mappings applied first. */
export function formatDisplay(value: number | null | undefined, config: FieldConfig = {}): string {
  return mappedResult(value, config)?.text ?? formatValue(value, config);
}

/** Grafana's continuous color schemes, as stops from the low end to the high end. */
const CONTINUOUS: Record<string, string[]> = {
  'continuous-GrYlRd': ['#73BF69', '#FADE2A', '#F2495C'],
  'continuous-RdYlGr': ['#F2495C', '#FADE2A', '#73BF69'],
  'continuous-BlYlRd': ['#5794F2', '#FADE2A', '#F2495C'],
  'continuous-YlRd': ['#FADE2A', '#F2495C'],
  'continuous-BlPu': ['#5794F2', '#B877D9'],
  'continuous-YlBl': ['#FADE2A', '#5794F2'],
  'continuous-blues': ['#C0D8FF', '#1F60C4'],
  'continuous-reds': ['#FFA6B0', '#C4162A'],
  'continuous-greens': ['#C8F2C2', '#37872D'],
  'continuous-purples': ['#DEB6F2', '#8F3BB8'],
};

function mix(a: string, b: string, t: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const out = [0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The color a field's config gives one value: a mapping's color, the fixed color, the matching threshold, or a
 * continuous scheme between min and max (from config, else `extent`). Other modes use `fallback`.
 */
export function valueColor(value: number | null, config: FieldConfig, fallback: string, extent?: [number, number]): string {
  const mapped = mappedResult(value, config)?.color;
  if (mapped) return resolveColor(mapped, fallback);
  const mode = config.color?.mode;
  if (mode === 'fixed') return resolveColor(config.color?.fixedColor, fallback);
  const stops = mode ? CONTINUOUS[mode] : undefined;
  if (stops) {
    const min = config.min ?? extent?.[0] ?? 0;
    const max = config.max ?? extent?.[1] ?? 1;
    const t = value == null ? 0 : Math.min(1, Math.max(0, (value - min) / (max - min || 1)));
    const at = t * (stops.length - 1);
    const i = Math.min(Math.floor(at), stops.length - 2);
    return mix(stops[i], stops[i + 1], at - i);
  }
  if (mode === 'thresholds' || (!mode && config.thresholds)) {
    const step = thresholdStep(value, config);
    if (step) return resolveColor(step.color, fallback);
  }
  return fallback;
}
