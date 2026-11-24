import { describe, expect, it } from 'vitest';
import { fillForm, fillHints, fillPrompt, fillSchema, modelFiller, parseFillAnswer, readFill, ruleFill, ruleFiller } from '../src/core';
import { DAILY, FILL_CASES, HABITS, WORKOUT } from './fixtures/fillCases';

describe('fillForm', () => {
  it('describes the inputs a filler can fill, leaving out counters', () => {
    expect(fillForm(DAILY).fields).toEqual([
      { key: 'weight', label: 'Weight', type: 'number', unit: 'kg', min: 0 },
      { key: 'sleep', label: 'Sleep', type: 'number', unit: 'h', min: 0, max: 24 },
      { key: 'mood', label: 'Mood', type: 'number', min: 1, max: 5 },
      { key: 'energy', label: 'Energy', type: 'number', min: 0, max: 10, choices: ['Drained', 'OK', 'Buzzing'] },
      { key: 'notes', label: 'Notes', type: 'text' },
    ]);
    expect(fillForm(HABITS).fields.map((f) => f.type)).toEqual(['boolean', 'boolean', 'choices', 'duration', 'text']);
  });

  it('takes runtime choices for choicesFrom, and skips selects with none', () => {
    const form = { title: 'W', panels: [{ type: 'input-select', title: 'Wheels', gridPos: { x: 0, y: 0, w: 24, h: 3 }, options: { metric: 'wheels', choicesFrom: 'sets' } }] };
    expect(fillForm(form).fields).toEqual([]);
    expect(fillForm(form, { sets: [{ label: 'Set A', value: 1 }] }).fields[0]).toMatchObject({ type: 'choice', choices: ['Set A'] });
  });
});

describe('fillSchema and fillPrompt', () => {
  it('makes an object schema with one optional property per field', () => {
    const schema = fillSchema(fillForm(WORKOUT)) as { properties: Record<string, Record<string, unknown>>; required: string[] };
    expect(schema.required).toEqual([]);
    expect(schema.properties.activity).toMatchObject({ type: 'string', enum: ['Run', 'Ride', 'Swim', 'Strength'] });
    expect(schema.properties['workout-minutes']).toMatchObject({ type: 'number', minimum: 0, description: 'Duration: a number in min, 0 or more' });
    expect(fillSchema(fillForm(HABITS)).properties).toMatchObject({ meals: { type: 'array', items: { enum: ['Breakfast', 'Lunch', 'Dinner'] } } });
  });

  it('lists the fields and what was said in the prompt', () => {
    const { instructions, prompt } = fillPrompt(fillForm(DAILY), 'weight "72"');
    expect(instructions).toContain('Only include fields the user gave a value for');
    expect(prompt).toContain('- sleep: Sleep, a number in h, from 0 to 24');
    expect(prompt).toContain('- energy: Energy, a number, from 0 to 10 (Drained … OK … Buzzing along the scale)');
    expect(prompt).toContain(`The user said: "weight '72'"`);
  });
});

describe('readFill', () => {
  const daily = fillForm(DAILY);

  it('finds the JSON in a chatty or fenced reply', () => {
    expect(parseFillAnswer('Sure! ```json\n{"mood": 4}\n```')).toEqual({ mood: 4 });
    expect(parseFillAnswer('no idea')).toBeNull();
    expect(parseFillAnswer({ mood: 4 })).toEqual({ mood: 4 });
    expect(readFill(daily, 'nope').problems).toEqual([{ key: '', problem: 'The answer wasn’t a JSON object' }]);
  });

  it('reads values the way dictation does, and ignores keys that aren’t fields', () => {
    expect(readFill(daily, { weight: '72.5 kg', sleep: 'seven and a half', mood: 4.4, energy: 'Buzzing', water: 3, notes: '  ok  ', bogus: 1 })).toEqual({
      values: { weight: 72.5, sleep: 7.5, mood: 4, energy: 10, notes: 'ok' },
      problems: [],
    });
  });

  it('takes choices by label or value, and true/false for toggles', () => {
    expect(readFill(fillForm(WORKOUT), { activity: 'swim' }).values).toEqual({ activity: 'swim' });
    expect(readFill(fillForm(WORKOUT), { activity: 'Ride' }).values).toEqual({ activity: 'ride' });
    expect(readFill(fillForm(HABITS), { meditated: true, alcohol: false, meals: ['Lunch', 'Dinner'] }).values).toEqual({ meditated: true, alcohol: false, meals: ['l', 'd'] });
  });

  it('reports values that don’t fit instead of filling them', () => {
    expect(readFill(fillForm(WORKOUT), { activity: 'Yoga', effort: 'hard' })).toEqual({
      values: {},
      problems: [
        { key: 'activity', problem: 'Heard “Yoga”, not one of the choices' },
        { key: 'effort', problem: 'Heard “hard”, not a number' },
      ],
    });
  });

  it('skips nulls and empty strings', () => {
    expect(readFill(daily, { weight: null, notes: '' })).toEqual({ values: {}, problems: [] });
  });
});

describe('ruleFill', () => {
  it.each(FILL_CASES.filter((c) => c.rule).map((c) => [c.said, c] as const))('%s', (_, c) => {
    const r = ruleFill(fillForm(c.form), c.said);
    expect(r.values).toEqual(c.expected);
  });

  it('never fills a wrong value, on any case', () => {
    for (const c of FILL_CASES) {
      const got = ruleFill(fillForm(c.form), c.said).values;
      for (const [k, v] of Object.entries(got)) expect({ said: c.said, [k]: v }).toEqual({ said: c.said, [k]: c.expected[k] });
    }
  });

  it('leaves what it can’t place rather than guessing', () => {
    const daily = fillForm(DAILY);
    expect(ruleFill(daily, 'pretty low today').values).toEqual({});
    expect(ruleFill(daily, 'feeling tired').values).toEqual({});
    expect(ruleFill(daily, 'slept badly').values).toEqual({});
    expect(ruleFill(daily, 'mood not great').values).toEqual({});
    // Pounds aren't kilos.
    expect(ruleFill(daily, 'weight 160 pounds').values).toEqual({});
    // Two different activities for one choice.
    expect(ruleFill(fillForm(WORKOUT), 'a run then a swim').values).toEqual({});
  });

  it('takes the last value when one is corrected', () => {
    const daily = fillForm(DAILY);
    expect(ruleFill(daily, 'mood 3 no wait mood 4').values.mood).toBe(4);
    expect(ruleFill(daily, 'mood 3, actually 4').values.mood).toBe(4);
    expect(ruleFill(daily, 'weight 72 sorry 73.5, sleep 7').values).toEqual({ weight: 73.5, sleep: 7 });
  });

  it('finds fields by the forms their names are said in, and everyday synonyms', () => {
    expect(ruleFill(fillForm(DAILY), 'slept seven hours and weighed 70.4').values).toEqual({ sleep: 7, weight: 70.4 });
    expect(ruleFill(fillForm(HABITS), 'I meditated this morning').values).toEqual({ meditated: true });
    expect(ruleFill(fillForm(WORKOUT), 'went cycling').values).toEqual({ activity: 'ride' });
    expect(ruleFill(fillForm(WORKOUT), 'jogging, 6k').values).toEqual({ activity: 'run', distance: 6 });
  });

  it('reads yes and no for toggles, before or after the name', () => {
    const habits = fillForm(HABITS);
    expect(ruleFill(habits, 'meditated, no alcohol').values).toEqual({ meditated: true, alcohol: false });
    expect(ruleFill(habits, 'skipped meditation').values).toEqual({ meditated: false });
    expect(ruleFill(habits, "didn't drink").values).toEqual({ alcohol: false });
    // A synonym alone doesn't say yes: a drink may have been water.
    expect(ruleFill(habits, 'had a drink').values).toEqual({});
  });

  it('reads ratings said in words when the field is named', () => {
    const daily = fillForm(DAILY);
    expect(ruleFill(daily, 'in a good mood').values).toEqual({ mood: 4 });
    expect(ruleFill(daily, 'mood very bad').values).toEqual({ mood: 1 });
    expect(ruleFill(daily, 'felt great').values).toEqual({ mood: 5 });
    expect(ruleFill(fillForm(WORKOUT), 'effort hard').values).toEqual({ effort: 4 });
  });

  it('converts times to the field’s unit', () => {
    expect(ruleFill(fillForm(WORKOUT), 'duration an hour and a half').values).toEqual({ 'workout-minutes': 90 });
    expect(ruleFill(fillForm(DAILY), 'sleep 450 minutes').values).toEqual({ sleep: 7.5 });
    expect(ruleFill(fillForm(DAILY), '72kg').values).toEqual({ weight: 72 });
    // A time isn't a distance.
    expect(ruleFill(fillForm(WORKOUT), 'distance 20 minutes').values).toEqual({ 'workout-minutes': 20 });
  });

  it('keeps a text field’s words together', () => {
    expect(ruleFill(fillForm(DAILY), 'notes slept badly, felt off').values).toEqual({ notes: 'slept badly, felt off' });
  });

  it('matches any choice label when the field is named, short words too', () => {
    const form = fillForm({
      title: 'C',
      panels: [{ type: 'input-select', title: 'Caffeine', gridPos: { x: 0, y: 0, w: 24, h: 3 }, options: { metric: 'caffeine', choices: [{ label: 'No', value: 0 }, { label: 'Some', value: 1 }] } }],
    } as never);
    expect(ruleFill(form, 'caffeine no').values).toEqual({ caffeine: 0 });
  });
});

describe('fillers', () => {
  const daily = fillForm(DAILY);

  it('ruleFiller is ruleFill behind the filler interface', async () => {
    expect(await ruleFiller(daily, 'weight 72.5, mood 4')).toEqual(ruleFill(daily, 'weight 72.5, mood 4'));
  });

  it('modelFiller asks with the prompt and schema, and reads the reply with readFill', async () => {
    const asked: unknown[][] = [];
    const filler = modelFiller(async (...args) => {
      asked.push(args);
      return '```json\n{"mood": "four", "sleep": "lots"}\n```';
    });
    const r = await filler(daily, 'in a good mood');
    expect(asked[0][1]).toContain('The user said: "in a good mood"');
    expect(asked[0][2]).toEqual(fillSchema(daily));
    expect(r.values).toEqual({ mood: 4 });
    expect(r.problems.map((p) => p.key)).toEqual(['sleep']);
  });

  it('modelFiller falls back to another filler for what the model left out, or when it fails', async () => {
    const partial = modelFiller(async () => ({ mood: 2 }), ruleFiller);
    expect((await partial(daily, 'weight 70, mood 5')).values).toEqual({ weight: 70, mood: 2 });

    const broken = modelFiller(async () => {
      throw new Error('no model');
    }, ruleFiller);
    expect((await broken(daily, 'weight 70')).values).toEqual({ weight: 70 });
    expect((await modelFiller(async () => 'no idea', ruleFiller)(daily, 'mood 3')).values).toEqual({ mood: 3 });

    const alone = await modelFiller(async () => 'no idea')(daily, 'mood 3');
    expect(alone).toEqual({ values: {}, problems: [{ key: '', problem: 'The model couldn’t fill the form' }] });
  });

  it('gives the recognizer field names, units and choices as hints', () => {
    expect(fillHints(daily)).toEqual(['Weight', 'kg', 'Sleep', 'h', 'Mood', 'Energy', 'Drained', 'OK', 'Buzzing', 'Notes']);
  });
});

/** How the rule-based filler does on every case, model-only ones included: a baseline for models. */
export function scoreRuleFill() {
  return FILL_CASES.map((c) => {
    const got = ruleFill(fillForm(c.form), c.said).values;
    const keys = new Set([...Object.keys(c.expected), ...Object.keys(got)]);
    const right = [...keys].filter((k) => JSON.stringify(got[k]) === JSON.stringify(c.expected[k])).length;
    return { said: c.said, right, of: keys.size };
  });
}

describe('baseline', () => {
  it('scores every case', () => {
    const scores = scoreRuleFill();
    const right = scores.reduce((n, s) => n + s.right, 0);
    const of = scores.reduce((n, s) => n + s.of, 0);
    console.log(`ruleFill: ${right}/${of} fields right across ${scores.length} cases`);
    expect(right).toBeGreaterThan(0);
  });
});
