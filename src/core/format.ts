import type { FieldConfig, ThresholdStep } from './schema';

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

function fixed(v: number, decimals?: number): string {
  if (decimals != null) return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
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

/** Highest threshold step whose value is <= the value. The base step has value null. */
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
  for (const s of steps) if (s.value == null || v >= s.value) match = s;
  return match;
}

/**
 * Grafana's named colors. Panels created in Grafana reference these by name
 * (thresholds default to "green"/"red"), so they must resolve to the same hues.
 */
const NAMED: Record<string, string> = {
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
  return NAMED[name] ?? (PASSTHROUGH.test(name) ? name : fallback);
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
