import { plainInputPanels, type InputChoice, type InputPanel, type InputValue } from './inputs';
import type { Dashboard } from './schema';
import { spokenValue } from './speech';

/**
 * Filling a whole form from one thing said ("weight seventy two point five, slept seven hours,
 * mood four"). A filler (an on-device model, or the rule-based one here) gets the form's fields
 * as a small schema, and whatever it returns goes through readFill, which turns it into input
 * values the same way dictation does, so a filler can't put anything in a form that typing couldn't.
 * The user always reviews the result before saving.
 *
 * Groups' fields aren't filled yet; counters record on tap, so they're left out too.
 */

export type FillFieldType = 'number' | 'text' | 'choice' | 'choices' | 'boolean' | 'duration';

/** One field as a filler sees it. `key` is the input's metric. */
export interface FillField {
  key: string;
  label: string;
  type: FillFieldType;
  unit?: string;
  min?: number;
  max?: number;
  /** Choice labels, for choice and choices fields; a slider's labels for a number field. */
  choices?: string[];
}

/** A form's fields for filling, with the panels they came from. */
export interface FillForm {
  fields: FillField[];
  panels: Record<string, InputPanel>;
  /** Runtime choices, for selects that use choicesFrom. */
  choices: Record<string, InputChoice[]>;
}

export const choicesOf = (p: InputPanel, runtime: Record<string, InputChoice[]>) =>
  (p.options.choicesFrom ? runtime[p.options.choicesFrom] : p.options.choices) ?? [];

/** The fields a filler can fill: the form's inputs outside groups, except counters. */
export function fillForm(dashboard: Dashboard, choices: Record<string, InputChoice[]> = {}): FillForm {
  const fields: FillField[] = [];
  const panels: Record<string, InputPanel> = {};
  for (const p of plainInputPanels(dashboard)) {
    const o = p.options;
    if (p.type === 'input-counter' || panels[o.metric]) continue;
    const base = { key: o.metric, label: p.title || o.metric };
    let field: FillField;
    switch (p.type) {
      case 'input-number':
        field = { ...base, type: 'number', unit: o.unit, min: o.min, max: o.max };
        break;
      case 'input-rating':
        field = { ...base, type: 'number', min: Math.round(o.min ?? 1), max: Math.round(o.max ?? 5) };
        break;
      case 'input-slider':
        field = { ...base, type: 'number', unit: o.unit, min: o.min ?? 0, max: o.max ?? 10, choices: o.labels?.length ? o.labels : undefined };
        break;
      case 'input-duration':
        field = { ...base, type: 'duration' };
        break;
      case 'input-select': {
        const labels = choicesOf(p, choices).map((c) => c.label);
        if (!labels.length) continue;
        field = { ...base, type: o.multi ? 'choices' : 'choice', choices: labels };
        break;
      }
      case 'input-toggle':
        field = { ...base, type: 'boolean' };
        break;
      case 'input-text':
        field = { ...base, type: 'text' };
        break;
      default:
        continue;
    }
    fields.push(Object.fromEntries(Object.entries(field).filter(([, v]) => v !== undefined)) as unknown as FillField);
    panels[o.metric] = p;
  }
  return { fields, panels, choices };
}

/** How a field reads in a prompt: "weight: Weight, a number in kg, 0 or more". */
function describe(f: FillField): string {
  const range =
    f.min != null && f.max != null ? `, from ${f.min} to ${f.max}` : f.min != null ? `, ${f.min} or more` : f.max != null ? `, at most ${f.max}` : '';
  switch (f.type) {
    case 'number':
      return `a number${f.unit ? ` in ${f.unit}` : ''}${range}${f.choices ? ` (${f.choices.join(' … ')} along the scale)` : ''}`;
    case 'duration':
      return 'a duration in seconds';
    case 'choice':
      return `one of: ${f.choices!.map((c) => JSON.stringify(c)).join(', ')}`;
    case 'choices':
      return `a list of any of: ${f.choices!.map((c) => JSON.stringify(c)).join(', ')}`;
    case 'boolean':
      return 'true or false';
    case 'text':
      return 'text, in the user’s words';
  }
}

/**
 * JSON Schema for a filler's answer: an object with one optional property per field. Fillers
 * with guided generation (Apple's DynamicGenerationSchema) can constrain output with it; others
 * get it in the prompt. Either way readFill checks the answer.
 */
export function fillSchema(form: FillForm): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const f of form.fields) {
    const description = `${f.label}: ${describe(f)}`;
    switch (f.type) {
      case 'number':
      case 'duration':
        properties[f.key] = { type: 'number', description, ...(f.min != null && { minimum: f.min }), ...(f.max != null && { maximum: f.max }) };
        break;
      case 'choice':
        properties[f.key] = { type: 'string', enum: f.choices, description };
        break;
      case 'choices':
        properties[f.key] = { type: 'array', items: { type: 'string', enum: f.choices }, description };
        break;
      case 'boolean':
        properties[f.key] = { type: 'boolean', description };
        break;
      case 'text':
        properties[f.key] = { type: 'string', description };
        break;
    }
  }
  return { type: 'object', properties, required: [], additionalProperties: false };
}

/** Instructions and prompt for a model filling the form from what was said. */
export function fillPrompt(form: FillForm, said: string): { instructions: string; prompt: string } {
  const instructions = [
    'You fill in a form from what the user said.',
    'Reply with one JSON object and nothing else. Its keys are field keys from the list below.',
    'Only include fields the user gave a value for; leave the others out. Never guess or make up values.',
    'Numbers are plain numbers without units. Choices use the exact text listed.',
  ].join(' ');
  const list = form.fields.map((f) => `- ${f.key}: ${f.label}, ${describe(f)}`).join('\n');
  const example = form.fields.find((f) => f.type === 'number');
  const prompt = [
    `Fields:\n${list}`,
    example ? `Example: if the user said "${example.label.toLowerCase()} 3" the answer is {"${example.key}": 3}` : '',
    `The user said: "${said.replace(/"/g, "'")}"`,
    'JSON:',
  ]
    .filter(Boolean)
    .join('\n\n');
  return { instructions, prompt };
}

/** The JSON object in a model's reply: the whole reply, or the first {...} in it (models like code fences). */
export function parseFillAnswer(answer: unknown): Record<string, unknown> | null {
  if (answer && typeof answer === 'object' && !Array.isArray(answer)) return answer as Record<string, unknown>;
  if (typeof answer !== 'string') return null;
  const start = answer.indexOf('{');
  const end = answer.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(answer.slice(start, end + 1));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

export interface FillResult {
  /** Values for the inputs that were filled, keyed by metric. */
  values: Record<string, InputValue>;
  /** Fields the answer gave something for that couldn't be used, with why. */
  problems: { key: string; problem: string }[];
}

/** Text a filler's value reads as, for spokenValue: arrays joined, booleans as yes/no. */
function asSaid(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  if (typeof v === 'string') return v.trim() || null;
  if (Array.isArray(v)) return v.map(asSaid).filter(Boolean).join(', ') || null;
  return null;
}

/**
 * A filler's answer as input values. Each value goes through spokenValue, so "72.5 kg",
 * "seven and a half", a choice's label (or value) and true/"yes" all work, and anything that
 * doesn't fit the input is reported instead of filled. Keys that aren't fields are ignored.
 */
export function readFill(form: FillForm, answer: unknown): FillResult {
  const result: FillResult = { values: {}, problems: [] };
  const obj = parseFillAnswer(answer);
  if (!obj) return { values: {}, problems: [{ key: '', problem: 'The answer wasn’t a JSON object' }] };
  for (const f of form.fields) {
    const raw = obj[f.key];
    const panel = form.panels[f.key];
    const choices = choicesOf(panel, form.choices);
    // A choice's value, not its label (some fillers answer with those).
    if (panel.type === 'input-select' && !panel.options.multi) {
      const byValue = choices.find((c) => c.value === raw);
      if (byValue) {
        result.values[f.key] = byValue.value;
        continue;
      }
    }
    const said = asSaid(raw);
    if (said == null) continue;
    const r = spokenValue(panel, said, null, choices);
    if ('value' in r) result.values[f.key] = r.value;
    else result.problems.push({ key: f.key, problem: r.problem });
  }
  return result;
}

/**
 * Fills a form from what was said. The rule-based filler is the default; an on-device model can
 * be dropped in later (see modelFiller) without changing the form. Whatever a filler returns
 * should come from readFill, so it can only hold values typing could have entered.
 */
export type FormFiller = (form: FillForm, said: string) => Promise<FillResult>;

/**
 * Generates a reply for a model filler: `schema` is fillSchema(form), for models with guided
 * generation; others can ignore it (the prompt describes the fields too). Resolve with the
 * reply as text, or as an object already parsed.
 */
export type FillGenerate = (instructions: string, prompt: string, schema: Record<string, unknown>) => Promise<unknown>;

/**
 * A filler backed by a model: asks it with fillPrompt and reads the reply with readFill. With
 * `fallback`, fields the model left out are filled by that filler (ruleFiller, say), and a
 * model that fails or gives no usable answer falls back entirely.
 */
export function modelFiller(generate: FillGenerate, fallback?: FormFiller): FormFiller {
  return async (form, said) => {
    let result: FillResult | null = null;
    try {
      const { instructions, prompt } = fillPrompt(form, said);
      result = readFill(form, await generate(instructions, prompt, fillSchema(form)));
      if (result.problems.some((p) => p.key === '')) result = null;
    } catch {
      result = null;
    }
    if (!fallback) return result ?? { values: {}, problems: [{ key: '', problem: 'The model couldn’t fill the form' }] };
    const rules = await fallback(form, said);
    if (!result) return rules;
    const values = { ...rules.values, ...result.values };
    const problems = [...result.problems, ...rules.problems.filter((p) => !(p.key in values))];
    return { values, problems };
  };
}

/** Words a recognizer should expect for the whole form: field names, units and choice labels. */
export function fillHints(form: FillForm): string[] {
  const out = new Set<string>();
  for (const f of form.fields) {
    out.add(f.label);
    if (f.unit) out.add(f.unit);
    for (const c of f.choices ?? []) out.add(c);
  }
  return [...out];
}
