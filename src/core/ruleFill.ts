import { readFill, type FillField, type FillForm, type FillResult, type FormFiller } from './formFill';
import { matchChoices, parseSpokenDuration, parseSpokenNumber, parseSpokenYesNo } from './speech';

/**
 * Filling a form from what was said without a model. Field names are found by their word forms
 * ("slept" for Sleep, "meditation" for Meditated) and a few everyday synonyms ("drink" for Alcohol,
 * "jog" for Run); a named field takes the value said next to it, and the rest of what was said is
 * searched for values only one field could take (a number with a unit, a time, a choice). It
 * leaves a field empty rather than guess: everything it fills goes through readFill, like a
 * model's answer would.
 */

interface Token {
  /** Lowercase, as said. */
  text: string;
  stem: string;
  /** Character offsets in what was said. */
  at: number;
  end: number;
}

/** Irregular forms, mapped to a word with the stem they should match. */
const IRREGULAR: Record<string, string> = {
  slept: 'sleep',
  felt: 'feel',
  ran: 'run',
  swam: 'swim',
  rode: 'ride',
  drank: 'drink',
  drunk: 'drink',
  ate: 'eat',
  weigh: 'weight',
  weighs: 'weight',
  weighed: 'weight',
  weighing: 'weight',
};

/**
 * Everyday words for common things to track. A field or choice named with one of them is also
 * found by the others. Synonyms only ever name a field, never set a toggle to true on their own
 * ("had a drink" isn't "alcohol: yes", but "didn't drink" is "alcohol: no").
 */
const SYNONYMS: string[][] = [
  ['alcohol', 'drink', 'drinks', 'booze'],
  ['mood', 'feel', 'feeling'],
  ['run', 'jog'],
  ['ride', 'bike', 'cycle'],
  ['strength', 'gym', 'lift'],
];

/** Words that never name a field, whatever a field is called. */
const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'no', 'not', 'i', 'it', 'is', 'was', 'at', 'in', 'of', 'to', 'for', 'my', 'me', 'on', 'yes']);

/** A crude English stem, enough to match a field's name to the forms people say it in. */
function stem(word: string): string {
  let w = word.toLowerCase().replace(/['’]/g, '');
  w = IRREGULAR[w] ?? w;
  const cut = (suffix: string, add = '') => {
    if (!w.endsWith(suffix) || w.length - suffix.length < 3) return false;
    w = w.slice(0, -suffix.length) + add;
    return true;
  };
  const cutDone = cut('ations', 'at') || cut('ation', 'at') || cut('ing') || cut('ed');
  if (!cutDone && !w.endsWith('ss')) cut('s');
  // running → run, jogging → jog
  if (cutDone && /([b-df-hj-np-tv-z])\1$/.test(w) && !/(ll|ss|ff|zz)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

/** A number glued to its unit ("5k", "72kg") is said as two words. */
const GLUED_UNIT = /^(\d+(?:[.,]\d+)?)(k|km|kms|kg|kgs|lb|lbs|h|hr|hrs|min|mins|s|sec|secs|mi|m)$/;

function tokenize(said: string): Token[] {
  const out: Token[] = [];
  const add = (text: string, at: number, end: number) => out.push({ text, stem: stem(text), at, end });
  for (const m of said.matchAll(/[\p{L}\p{N}]+(?:['’.,][\p{L}\p{N}]+)*/gu)) {
    const at = m.index!;
    const raw = m[0].toLowerCase();
    const glued = GLUED_UNIT.exec(raw);
    if (glued) {
      add(glued[1], at, at + glued[1].length);
      add(glued[2], at + glued[1].length, at + raw.length);
    } else add(raw, at, at + raw.length);
  }
  return out;
}

const plain = (t: Token) => t.text.replace(/['’]/g, '');

type Kind = 'exact' | 'form' | 'synonym';

interface Phrase {
  words: string[];
  stems: string[];
  synonym: boolean;
  /** A choice label, which may be any word ("No"); field names never match words like "no" or "the". */
  label: boolean;
}

const phrase = (text: string, label: boolean, synonym = false): Phrase | null => {
  const words = tokenize(text).map((t) => t.text);
  if (!words.length || (!label && words.length === 1 && STOP.has(words[0]))) return null;
  return { words, stems: words.map(stem), synonym, label };
};

/** A field's names or a choice's label, and the synonyms of a one-word one. */
function phrasesFor(names: string[], label = false): Phrase[] {
  const out: Phrase[] = [];
  for (const name of names) {
    const p = phrase(name, label);
    if (!p) continue;
    out.push(p);
    if (p.stems.length === 1)
      for (const group of SYNONYMS)
        if (group.some((g) => stem(g) === p.stems[0]))
          for (const g of group) if (stem(g) !== p.stems[0]) out.push(phrase(g, label, true)!);
  }
  return out;
}

interface Hit {
  key: string;
  start: number;
  /** Token index just past the name. */
  end: number;
  kind: Kind;
  /** The label of the choice found, for choice hits. */
  label?: string;
}

/** Where phrases occur in tokens, longest first, without overlaps. */
function findPhrases(tokens: Token[], targets: { key: string; label?: string; phrases: Phrase[] }[]): Hit[] {
  const all = targets.flatMap((t) => t.phrases.map((p) => ({ ...t, p }))).sort((a, b) => b.p.stems.length - a.p.stems.length);
  const hits: Hit[] = [];
  for (const { key, label, p } of all)
    for (let i = 0; i + p.stems.length <= tokens.length; i++) {
      const span = tokens.slice(i, i + p.stems.length);
      if (span.some((t, n) => !t.stem || t.stem !== p.stems[n] || (!p.label && STOP.has(t.text)))) continue;
      const end = i + p.stems.length;
      if (hits.some((h) => i < h.end && end > h.start)) continue;
      const exact = span.every((t, n) => t.text === p.words[n]);
      hits.push({ key, label, start: i, end, kind: p.synonym ? 'synonym' : exact ? 'exact' : 'form' });
    }
  return hits.sort((a, b) => a.start - b.start);
}

/** Words that name a field: its label, and its metric with dashes as spaces. */
const namesOf = (f: FillField) => [...new Set([f.label, f.key.replace(/[-_]+/g, ' ')])];

// Numbers and units.

const NUMBER_WORDS = new Set(
  'zero oh nought one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand'.split(' '),
);
const TIME_UNITS: Record<string, number> = {
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
  min: 60, mins: 60, minute: 60, minutes: 60,
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
};
const UNIT_WORDS: Record<string, string[]> = {
  kg: ['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms'],
  lb: ['lb', 'lbs', 'pound', 'pounds'],
  km: ['km', 'kms', 'kilometer', 'kilometers', 'kilometre', 'kilometres', 'k'],
  mi: ['mi', 'mile', 'miles'],
  m: ['m', 'meter', 'meters', 'metre', 'metres'],
};

const isDigits = (t: Token | undefined) => !!t && /^\d/.test(t.text);
const isNumberWord = (t: Token | undefined) => !!t && NUMBER_WORDS.has(t.text);
const isTimeUnit = (t: Token | undefined) => !!t && t.text in TIME_UNITS;
const is = (t: Token | undefined, ...words: string[]) => !!t && words.includes(t.text);

/** Seconds per unit for a time unit ("min", "hours"), or undefined for other units. */
const timeScale = (unit?: string) => (unit ? TIME_UNITS[unit.toLowerCase()] : undefined);

/** The words a field's unit is said as. */
const unitWords = (unit: string) => UNIT_WORDS[unit.toLowerCase()] ?? [unit.toLowerCase()];

/** Whether a number starts at token i: "72", "seventy", "an hour", "half an hour", "a hundred". */
function numberStarts(tokens: Token[], i: number): boolean {
  const t = tokens[i];
  const next = tokens[i + 1];
  if (isDigits(t) || isNumberWord(t)) return true;
  if (is(t, 'a', 'an')) return is(next, 'half', 'quarter', 'hundred', 'thousand', 'hour', 'minute');
  if (is(t, 'half', 'quarter')) return is(next, 'a', 'an', 'of', 'hour', 'minute');
  return false;
}

interface Span {
  end: number;
  text: string;
  /** Seconds, when a time unit was said. */
  seconds?: number;
  /** A unit word said right after the number. */
  unit?: string;
}

/**
 * The number (or time) starting at token i, up to `stop`: "seventy two point five", "seven and a
 * half hours", "two hours fifteen minutes", "an hour and a half", "72.5 kilos".
 */
function numberAt(said: string, tokens: Token[], i: number, stop: number): Span | null {
  let k = i;
  let time = false;
  const numberish = (j: number) => {
    const t = tokens[j];
    const next = tokens[j + 1];
    if (isDigits(t) || isNumberWord(t) || is(t, 'point', 'half', 'quarter')) return true;
    if (is(t, 'and')) return j + 1 < stop && (isDigits(next) || isNumberWord(next) || is(next, 'a'));
    if (is(t, 'a', 'an')) return is(next, 'half', 'quarter', 'hundred', 'thousand', 'hour', 'minute');
    if (is(t, 'of')) return is(tokens[j - 1], 'half', 'quarter') && is(next, 'a', 'an');
    return false;
  };
  while (k < stop) {
    if (numberish(k)) k++;
    else if (isTimeUnit(tokens[k])) {
      time = true;
      k++;
      // "two hours fifteen minutes", "an hour and a half": keep going only into another number.
      if (!(k < stop && (numberStarts(tokens, k) || (is(tokens[k], 'and') && numberish(k))))) break;
    } else break;
  }
  // Trailing joiners aren't part of it: "seven and" → "seven".
  while (k > i && is(tokens[k - 1], 'and', 'a', 'an', 'of')) k--;
  if (k <= i) return null;
  const text = said.slice(tokens[i].at, tokens[k - 1].end);
  if (time) {
    const seconds = parseSpokenDuration(text);
    return seconds == null ? null : { end: k, text, seconds };
  }
  if (parseSpokenNumber(text) == null) return null;
  const unit = k < stop && !STOP.has(tokens[k].text) ? tokens[k].text : undefined;
  return { end: unit ? k + 1 : k, text, unit };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * A span as a field's value: times converted to the field's unit (an hour and a half in a
 * minutes field is 90), plain numbers as said. Null when the span can't be this field's: a time
 * for a field that isn't one, or a unit the field doesn't take.
 */
function spanValue(f: FillField, span: Span): unknown {
  const scale = timeScale(f.unit);
  if (span.seconds != null) {
    if (f.type === 'duration') return span.seconds;
    return scale ? round(span.seconds / scale) : null;
  }
  if (span.unit && f.unit && !scale && !unitWords(f.unit).includes(span.unit) && Object.values(UNIT_WORDS).some((ws) => ws.includes(span.unit!))) return null;
  // A plain number: in the field's own unit. Durations read it the way dictation does.
  return f.type === 'duration' ? span.text : parseSpokenNumber(span.text);
}

// Ratings said in words.

/** Where a word puts a rating along its scale, from 0 (lowest) to 1 (highest). */
const SCALE_WORDS: Record<string, number> = {
  terrible: 0, awful: 0, horrible: 0, dreadful: 0, miserable: 0, worst: 0,
  bad: 0.25, low: 0.25, poor: 0.25, rough: 0.25, down: 0.25, rubbish: 0.25, easy: 0, light: 0.25,
  ok: 0.5, okay: 0.5, fine: 0.5, alright: 0.5, average: 0.5, meh: 0.5, moderate: 0.5, normal: 0.5,
  good: 0.75, decent: 0.75, nice: 0.75, happy: 0.75, high: 0.75, hard: 0.75, tough: 0.75,
  great: 1, amazing: 1, excellent: 1, fantastic: 1, brilliant: 1, awesome: 1, wonderful: 1, perfect: 1, best: 1, brutal: 1,
};
const INTENSIFIERS = new Set(['very', 'really', 'super', 'so', 'extremely', 'totally', 'incredibly']);

/** A rating from a scale word in tokens [from, to): "pretty low" → 2 of 1–5. Not after "not". */
function scaleValue(f: FillField, tokens: Token[], from: number, to: number): { value: number; at: number } | null {
  if (f.min == null || f.max == null || f.unit) return null;
  for (let j = Math.max(0, from); j < to; j++) {
    const w = plain(tokens[j]);
    if (!(w in SCALE_WORDS)) continue;
    if (is(tokens[j - 1], 'not') || is(tokens[j - 2], 'not')) return null;
    let x = SCALE_WORDS[w];
    if (INTENSIFIERS.has(tokens[j - 1]?.text ?? '') && x !== 0.5) x = x < 0.5 ? Math.max(0, x - 0.25) : Math.min(1, x + 0.25);
    return { value: Math.round(f.min + x * (f.max - f.min)), at: j };
  }
  return null;
}

// Yes and no.

const NEGATIONS = new Set(['no', 'not', 'didnt', 'dont', 'never', 'skipped', 'skip', 'without', 'zero', 'none', 'havent', 'hasnt', 'wasnt', 'nope', 'cant', 'couldnt']);

/** Whether tokens just before `start` say no: "didn't drink", "no meditation", "skipped the gym". */
function negatedBefore(tokens: Token[], start: number, free: boolean[]): number | null {
  for (let j = start - 1; j >= Math.max(0, start - 3); j--) {
    if (!free[j]) return null;
    if (NEGATIONS.has(plain(tokens[j])) && !is(tokens[j + 1], 'wait')) return j;
  }
  return null;
}

/** "No wait", "actually", "I mean": what follows replaces what came before. */
const CORRECTIONS = [['no', 'wait'], ['wait'], ['sorry'], ['actually'], ['i', 'mean'], ['make', 'that'], ['scratch', 'that'], ['or', 'rather'], ['correction']];

function lastCorrection(tokens: Token[], from: number, to: number): number | null {
  let last: number | null = null;
  for (let j = from; j < to; j++)
    for (const c of CORRECTIONS) if (c.every((w, n) => tokens[j + n]?.text === w) && j + c.length <= to) last = j + c.length;
  return last;
}

/** Filler words between a field's name and its text: "notes: felt good", "gratitude is my sister". */
const LEAD = /^[\s,:;.-]*(?:(?:is|was|were|of|at|about|around|to|=)\b[\s,:;.-]*)*/i;

/** How many words may come between a field's name and its number: "slept badly, maybe five hours". */
const MAX_GAP = 4;

interface Found {
  value: unknown;
  /** Token index just past the value. */
  end: number;
  /** Token index where what this field took starts (a negation or scale word before its name). */
  start?: number;
}

/**
 * The value a named field takes from what follows its name, up to `stop` (the next name). For
 * numbers, a correction ("mood 3, actually 4") wins over what came before it.
 */
function valueAfter(said: string, f: FillField, h: Hit, tokens: Token[], stop: number, free: boolean[], nextIsToggle: boolean): Found | null {
  const from = h.end;
  if (f.type === 'text') {
    if (from >= stop) return null;
    const text = said.slice(tokens[from].at, tokens[stop - 1].end).replace(LEAD, '').replace(/[\s,;.]+$/, '');
    return text ? { value: text, end: stop } : null;
  }
  if (f.type === 'boolean') {
    // "alcohol no", but not the "no" of "meditated, no alcohol".
    const after = tokens.slice(from, Math.min(stop, from + 2));
    const last = after[after.length - 1];
    const lastIsNo = !!last && from + after.length === stop && nextIsToggle && NEGATIONS.has(plain(last));
    const yes = lastIsNo ? null : parseSpokenYesNo(after.map((t) => t.text).join(' '));
    if (yes != null) return { value: yes, end: from + after.length };
    const neg = negatedBefore(tokens, h.start, free);
    if (neg != null) return { value: false, end: h.end, start: neg };
    return h.kind === 'synonym' ? null : { value: true, end: h.end };
  }
  if (f.type === 'choice' || f.type === 'choices') {
    if (from >= stop) return null;
    const labels = choiceLabels(f, tokens.slice(from, stop));
    if (!labels.length || (f.type === 'choice' && labels.length > 1)) return null;
    return { value: f.type === 'choice' ? labels[0] : labels, end: stop };
  }
  // Numbers and durations, from the last correction on if there is one.
  const fix = lastCorrection(tokens, from, stop);
  for (const start of fix != null ? [fix, from] : [from])
    for (let j = start; j < Math.min(stop, start + MAX_GAP + 1); j++) {
      if (!numberStarts(tokens, j)) continue;
      const span = numberAt(said, tokens, j, stop);
      const value = span && spanValue(f, span);
      if (span && value != null) return { value, end: span.end };
      break;
    }
  // A slider's labels, or a rating in words ("mood pretty low", "in a good mood").
  const near = Math.min(stop, from + 3);
  if (f.choices && from < near) {
    const [hit] = matchChoices(said.slice(tokens[from].at, tokens[near - 1].end), f.choices.map((label) => ({ label, value: label })));
    if (hit != null) return { value: hit, end: near };
  }
  const scale = scaleValue(f, tokens, from, near);
  if (scale) return { value: scale.value, end: scale.at + 1 };
  const before = scaleValue(f, tokens, h.start - 2, h.start);
  if (before && tokens.slice(before.at, h.start).every((_, n) => free[before.at + n]) && !/[,.;]/.test(said.slice(tokens[before.at].end, tokens[h.start].at)))
    return { value: before.value, end: h.end, start: before.at };
  return null;
}

/** Choice labels said in tokens, by label or synonym, in the order said. */
function choiceLabels(f: FillField, tokens: Token[]): string[] {
  const hits = findPhrases(tokens, (f.choices ?? []).map((label) => ({ key: f.key, label, phrases: phrasesFor([label], true) })));
  return [...new Set(hits.map((h) => h.label!))];
}

/**
 * Fills a form without a model. A named field takes the value said next to it ("weight 72.5",
 * "slept badly, maybe five hours", "didn't drink", "mood pretty low"), the last time it was named
 * if it was named twice ("mood 3, no wait, mood 4"). Then fields not named are found in the rest
 * of what was said by what only they could take: a number with the field's unit ("72.5 kilos",
 * "5k"), a time when one field takes times ("for an hour and a half"), or a choice only that
 * field has ("went for a jog"). Works offline on every device.
 */
export function ruleFill(form: FillForm, said: string): FillResult {
  const tokens = tokenize(said);
  const free = tokens.map(() => true);
  const take = (from: number, to: number) => {
    for (let j = from; j < to; j++) free[j] = false;
  };
  const fieldOf = (key: string) => form.fields.find((f) => f.key === key)!;

  // Names. Inside a text field's words, only a field's exact name ends the text.
  const named: Hit[] = [];
  let inText = false;
  for (const h of findPhrases(tokens, form.fields.map((f) => ({ key: f.key, phrases: phrasesFor(namesOf(f)) })))) {
    if (inText && h.kind !== 'exact') continue;
    named.push(h);
    inText = fieldOf(h.key).type === 'text';
  }
  for (const h of named) take(h.start, h.end);

  const answer: Record<string, unknown> = {};
  for (const f of form.fields) {
    const mine = named.map((h, i) => ({ h, i })).filter(({ h }) => h.key === f.key);
    // The last mention that gives a value wins.
    for (const { h, i } of mine.reverse()) {
      const stop = named[i + 1]?.start ?? tokens.length;
      const nextIsToggle = !!named[i + 1] && fieldOf(named[i + 1].key).type === 'boolean';
      const found = valueAfter(said, f, h, tokens, stop, free, nextIsToggle);
      if (!found) continue;
      answer[f.key] = found.value;
      take(found.start ?? h.start, found.end);
      break;
    }
  }

  // Fields not named: numbers by unit, times by being the only field that takes one.
  const open = (f: FillField) => !(f.key in answer);
  const timeFields = () => form.fields.filter((f) => open(f) && (f.type === 'duration' || (f.type === 'number' && timeScale(f.unit))));
  for (let j = 0; j < tokens.length; j++) {
    if (!free[j] || !numberStarts(tokens, j)) continue;
    let stop = j;
    while (stop < tokens.length && free[stop]) stop++;
    const span = numberAt(said, tokens, j, stop);
    if (!span) continue;
    let field: FillField | undefined;
    if (span.seconds != null) {
      const unitSaid = tokens.slice(j, span.end).find(isTimeUnit)!.text;
      const candidates = timeFields();
      field = candidates.find((f) => timeScale(f.unit) === TIME_UNITS[unitSaid]) ?? (candidates.length === 1 ? candidates[0] : undefined);
    } else if (span.unit) {
      const matching = form.fields.filter((f) => open(f) && f.type === 'number' && f.unit && !timeScale(f.unit) && unitWords(f.unit).includes(span.unit!));
      if (matching.length === 1) field = matching[0];
    }
    const value = field && spanValue(field, span);
    if (field && value != null) {
      answer[field.key] = value;
      take(j, span.end);
      j = span.end - 1;
    }
  }

  // Choices, when only one open field has any of those said.
  const unclaimed = tokens.map((t, j) => (free[j] ? t : { ...t, stem: '', text: '' }));
  const choiceFields = form.fields.filter((f) => open(f) && (f.type === 'choice' || f.type === 'choices'));
  const mentioned = choiceFields.map((f) => ({ f, labels: choiceLabels(f, unclaimed) })).filter((c) => c.labels.length);
  if (mentioned.length === 1) {
    const [{ f, labels }] = mentioned;
    if (f.type === 'choices') answer[f.key] = labels;
    else if (labels.length === 1) answer[f.key] = labels[0];
  }

  return readFill(form, answer);
}

/** The filler that needs no model: ruleFill. Works offline on every device. */
export const ruleFiller: FormFiller = async (form, said) => ruleFill(form, said);
