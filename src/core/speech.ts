import { type InputChoice, type InputPanel, type InputValue } from './inputs';

/**
 * Turning what was said into an input's value. Recognizers return plain text, either with
 * digits ("125", "5.2") or with words ("one twenty-five", "five point two"); both work here.
 * These are pure functions so they can be tested without a microphone and reused by a
 * whole-form filler.
 */

const UNITS: Record<string, number> = {
  zero: 0, oh: 0, nought: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, million: 1_000_000 };
const NEGATIVE = new Set(['minus', 'negative']);

const isNumberWord = (w: string) => w in UNITS || w in TENS || w in SCALES;

/** Lowercase words, with hyphens and most punctuation turned into spaces; keeps digits, decimal points and colons. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/(\d),(\d{3})\b/g, '$1$2') // 1,250 → 1250
    .replace(/(\d),(\d)/g, '$1.$2') // 5,2 → 5.2
    .replace(/[^a-z0-9.:\s-]/g, ' ')
    .replace(/(?<![\d])-(?=\d)/g, ' minus ')
    .replace(/-/g, ' ')
    .replace(/\.(?!\d)/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Whole number from number words, or null if they don't make one. With hundred/thousand
 * it adds up the usual way ("one hundred and five"); without, consecutive small numbers
 * are read the way people say them ("one twenty-five" → 125, "nineteen oh five" → 1905).
 */
function wordsToInteger(ws: string[]): number | null {
  if (!ws.length) return null;
  if (ws.some((w) => w in SCALES)) {
    let total = 0;
    let current = 0;
    for (const w of ws) {
      if (w in UNITS) current += UNITS[w];
      else if (w in TENS) current += TENS[w];
      else if (w === 'hundred') current = (current || 1) * 100;
      else if (w in SCALES) {
        total += (current || 1) * SCALES[w];
        current = 0;
      } else return null;
    }
    return total + current;
  }
  // Split into spoken groups: "twenty five", "oh five", "seven" or "nineteen".
  const groups: string[] = [];
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    const next = ws[i + 1];
    const nextUnit = next != null && next in UNITS && UNITS[next] > 0 && UNITS[next] < 10;
    if (w in TENS) {
      groups.push(String(TENS[w] + (nextUnit ? UNITS[next] : 0)));
      if (nextUnit) i++;
    } else if (w === 'oh' && nextUnit) {
      groups.push(`0${UNITS[next]}`);
      i++;
    } else if (w in UNITS) groups.push(String(UNITS[w]));
    else return null;
  }
  // "one twenty" is 120, and "two oh five" 205: later groups are two digits each.
  return Number(groups.map((g, i) => (i === 0 ? g : g.padStart(2, '0'))).join(''));
}

/**
 * The first number in what was said: "72.5", "seventy two point five", "minus three",
 * "one twenty-five" (125), "two and a half", "a hundred and ten". Words around it
 * ("about 80 kilos") are ignored. Null when there's no number.
 */
export function parseSpokenNumber(text: string): number | null {
  const ws = words(text);
  let i = 0;
  let sign = 1;
  // Skip to the first number, remembering a "minus" just before it.
  for (; i < ws.length; i++) {
    const w = ws[i];
    if (NEGATIVE.has(w)) sign = -1;
    else if (/^\d/.test(w) || isNumberWord(w) || (w === 'a' && ws[i + 1] in SCALES) || (w === 'point' && ws[i + 1] && (/^\d/.test(ws[i + 1]) || ws[i + 1] in UNITS))) break;
    else if (w !== 'and') sign = 1;
  }
  if (i >= ws.length) return null;

  // Digits as the recognizer wrote them, maybe followed by "point five" or "and a half".
  const digits = /^(\d+(?:\.\d+)?)$/.exec(ws[i]);
  if (digits) {
    let n = Number(digits[1]);
    const rest = ws.slice(i + 1);
    if (!digits[1].includes('.') && rest[0] === 'point') n = Number(`${digits[1]}.${fractionDigits(rest.slice(1)) ?? 0}`);
    else if (rest[0] === 'and' && rest[1] === 'a' && rest[2] === 'half') n += 0.5;
    return sign * n;
  }

  const whole: string[] = [];
  for (; i < ws.length; i++) {
    const w = ws[i];
    if (isNumberWord(w)) whole.push(w);
    else if (w === 'a' && ws[i + 1] in SCALES) whole.push('one');
    // "one hundred and five" keeps going; "two and a half" is handled below.
    else if (w === 'and' && ws[i + 1] && isNumberWord(ws[i + 1]) && whole.some((x) => x in SCALES)) continue;
    else break;
  }
  const intPart = whole.length ? wordsToInteger(whole) : 0;
  if (intPart == null) return null;
  if (ws[i] === 'point') {
    const frac = fractionDigits(ws.slice(i + 1));
    return frac == null ? sign * intPart : sign * Number(`${intPart}.${frac}`);
  }
  if (ws[i] === 'and' && ws[i + 1] === 'a' && ws[i + 2] === 'half') return sign * (intPart + 0.5);
  if (ws[i] === 'and' && ws[i + 1] === 'a' && ws[i + 2] === 'quarter') return sign * (intPart + 0.25);
  if (!whole.length) return null;
  return sign * intPart;
}

/** The digits after "point": "two five" → "25", "twenty five" → "25", "05" → "05". */
function fractionDigits(ws: string[]): string | null {
  if (ws[0] && /^\d+$/.test(ws[0])) return ws[0];
  let out = '';
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    if (w in UNITS && UNITS[w] < 10) out += UNITS[w];
    else if (w in TENS) {
      const next = ws[i + 1];
      if (next in UNITS && UNITS[next] > 0 && UNITS[next] < 10) {
        out += TENS[w] + UNITS[next];
        i++;
      } else out += TENS[w];
    } else if (w in UNITS) out += UNITS[w]; // "point fifteen"
    else break;
  }
  return out || null;
}

/** A duration in seconds: "1:32.45", "one minute thirty two point four five", "92 seconds", "an hour and ten minutes". */
export function parseSpokenDuration(text: string): number | null {
  const clock = /(?:(\d+):)?(\d+):(\d{1,2})(?:\.(\d+))?|(\d+):(\d{1,2})(?:\.(\d+))?/.exec(text);
  if (clock) {
    if (clock[3] != null) {
      const [h, m, s, f] = [Number(clock[1] ?? 0), Number(clock[2]), Number(clock[3]), clock[4] ?? '0'];
      return clock[1] != null ? h * 3600 + m * 60 + s + Number(`0.${f}`) : m * 60 + s + Number(`0.${f}`);
    }
  }
  const lower = text
    .toLowerCase()
    .replace(/\ban hour\b/g, 'one hour')
    .replace(/\ba minute\b/g, 'one minute')
    // "a minute and a half" → "one and a half minute"
    .replace(/(\S+) (hours?|minutes?) and a half/g, '$1 and a half $2');
  const parts = lower.split(/\b(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/);
  const scale = (unit: string) => (unit.startsWith('h') ? 3600 : unit.startsWith('m') ? 60 : 1);
  let total = 0;
  let found = false;
  let last = 0;
  for (let i = 0; i < parts.length; i += 2) {
    const n = parseSpokenNumber(parts[i]);
    const unit = parts[i + 1];
    // A number after the last unit is in the next unit down: "one minute thirty" is 90 seconds.
    const s = unit != null ? scale(unit) : last === 3600 ? 60 : last === 60 ? 1 : 0;
    if (unit != null) last = s;
    if (n == null || !s) continue;
    total += n * s;
    found = true;
  }
  if (found) return Math.round(total * 100) / 100;
  return null;
}

const normalize = (s: string) => words(s).join(' ');
const singular = (w: string) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const loose = (s: string) => normalize(s).split(' ').map(singular).join(' ');

/**
 * The choices mentioned in what was said, in the order they were said. Labels are matched
 * as whole words, ignoring case, accents and plurals; the longest label wins where two
 * overlap ("Very good" over "Good"). A spoken number also matches a choice whose label or
 * value is that number.
 */
export function matchChoices(text: string, choices: InputChoice[]): (string | number)[] {
  const said = ` ${loose(text)} `;
  const hits: { at: number; end: number; value: string | number }[] = [];
  const byLength = [...choices].sort((a, b) => b.label.length - a.label.length);
  for (const c of byLength) {
    const label = loose(c.label);
    if (!label) continue;
    let from = 0;
    for (;;) {
      const at = said.indexOf(` ${label} `, from);
      if (at < 0) break;
      const end = at + label.length + 1;
      if (!hits.some((h) => at < h.end && end > h.at)) hits.push({ at, end, value: c.value });
      from = at + 1;
    }
  }
  if (!hits.length) {
    const n = parseSpokenNumber(text);
    const c = n == null ? undefined : choices.find((x) => x.value === n || Number(x.label) === n || x.value === String(n));
    return c ? [c.value] : [];
  }
  const seen = new Set<string | number>();
  return hits
    .sort((a, b) => a.at - b.at)
    .map((h) => h.value)
    .filter((v) => !seen.has(v) && seen.add(v));
}

const YES = new Set(['yes', 'yeah', 'yep', 'yup', 'true', 'on', 'done', 'did', 'checked', 'correct', 'affirmative']);
const NO = new Set(['no', 'nope', 'nah', 'false', 'off', 'not', 'didnt', 'didn', 'unchecked', 'negative']);

/** Yes or no from what was said, or null when it's neither. "No" wins when both are there ("not done"). */
export function parseSpokenYesNo(text: string): boolean | null {
  const ws = words(text.replace(/['’]/g, ''));
  if (ws.some((w) => NO.has(w))) return false;
  if (ws.some((w) => YES.has(w))) return true;
  return null;
}

/** What dictation into an input made of what was said: the new value, or why there isn't one. */
export type SpokenResult = { value: InputValue } | { problem: string };

/**
 * The value an input takes from what was said. Text inputs take the words (added after
 * what's there, for multi-line text); numbers, durations, choices and yes/no are read out
 * of them. The value isn't checked against min, max or required: the form does that.
 */
export function spokenValue(panel: InputPanel, said: string, current: InputValue = null, choices?: InputChoice[]): SpokenResult {
  const text = said.trim();
  if (!text) return { problem: 'Didn’t hear anything' };
  const o = panel.options;
  const quoted = `“${text}”`;
  switch (panel.type) {
    case 'input-text': {
      if (o.suggest || typeof current !== 'string' || !current.trim()) return { value: text };
      return { value: `${current.trimEnd()} ${text}` };
    }
    case 'input-number':
    case 'input-rating': {
      const n = parseSpokenNumber(text);
      if (n == null) return { problem: `Heard ${quoted}, not a number` };
      const step = panel.type === 'input-rating' ? 1 : o.step ?? 1;
      return { value: Number.isInteger(step) ? Math.round(n) : n };
    }
    case 'input-slider': {
      const min = o.min ?? 0;
      const max = o.max ?? 10;
      const step = o.step ?? 1;
      if (o.labels?.length) {
        const [hit] = matchChoices(text, o.labels.map((label, i) => ({ label, value: i })));
        if (typeof hit === 'number') {
          const raw = o.labels.length === 1 ? min : min + (hit / (o.labels.length - 1)) * (max - min);
          return { value: Number((Math.round((raw - min) / step) * step + min).toFixed((String(step).split('.')[1] ?? '').length)) };
        }
      }
      const n = parseSpokenNumber(text);
      if (n == null) return { problem: `Heard ${quoted}, not a number` };
      return { value: Number.isInteger(step) ? Math.round(n) : n };
    }
    case 'input-duration': {
      const s = parseSpokenDuration(text) ?? parseSpokenNumber(text);
      return s == null ? { problem: `Heard ${quoted}, not a time` } : { value: s };
    }
    case 'input-select': {
      const options = choices ?? o.choices ?? [];
      const hits = matchChoices(text, options);
      if (!hits.length) return { problem: `Heard ${quoted}, not one of the choices` };
      if (!o.multi) return { value: hits[0] };
      const had = Array.isArray(current) ? current : current == null ? [] : [current as string | number];
      return { value: [...had, ...hits.filter((h) => !had.includes(h))] };
    }
    case 'input-toggle': {
      const yes = parseSpokenYesNo(text);
      return yes == null ? { problem: `Heard ${quoted}, not yes or no` } : { value: yes };
    }
    default:
      return { problem: 'This input doesn’t take dictation' };
  }
}

/** Input types that show a dictation button. Sliders, ratings and toggles are a single tap already; counters record on tap. */
export const DICTATION_TYPES: InputPanel['type'][] = ['input-number', 'input-text', 'input-select', 'input-duration'];

/** Whether an input offers dictation. */
export const takesDictation = (panel: InputPanel) => DICTATION_TYPES.includes(panel.type);

/** Words a recognizer should expect for an input (its choice labels and unit), for recognizers that take hints. */
export function dictationHints(panel: InputPanel, choices?: InputChoice[]): string[] {
  const out = (choices ?? panel.options.choices ?? []).map((c) => c.label);
  if (panel.options.unit) out.push(panel.options.unit);
  return out;
}
