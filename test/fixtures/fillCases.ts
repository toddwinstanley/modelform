import type { Dashboard, InputPanel, InputValue } from '../../src/core';

/**
 * Forms and things people might say to fill them, with the values they mean. The rule-based
 * filler is tested on the cases marked `rule`; the rest need a model (no field names said,
 * or relative phrasing) and are the yardstick for on-device models.
 */

const at = (y: number, p: Omit<InputPanel, 'gridPos'>): InputPanel => ({ ...p, gridPos: { x: 0, y, w: 24, h: 3 } }) as InputPanel;

export const DAILY: Dashboard = {
  title: 'Daily',
  kind: 'form',
  panels: [
    at(0, { type: 'input-number', title: 'Weight', options: { metric: 'weight', unit: 'kg', step: 0.1, min: 0 } }),
    at(3, { type: 'input-number', title: 'Sleep', options: { metric: 'sleep', unit: 'h', step: 0.25, min: 0, max: 24 } }),
    at(6, { type: 'input-rating', title: 'Mood', options: { metric: 'mood', min: 1, max: 5 } }),
    at(9, { type: 'input-slider', title: 'Energy', options: { metric: 'energy', min: 0, max: 10, labels: ['Drained', 'OK', 'Buzzing'] } }),
    at(12, { type: 'input-counter', title: 'Water', options: { metric: 'water', unit: 'glasses' } }),
    at(15, { type: 'input-text', title: 'Notes', options: { metric: 'notes' } }),
  ],
};

export const WORKOUT: Dashboard = {
  title: 'Workout',
  kind: 'form',
  panels: [
    at(0, {
      type: 'input-select',
      title: 'Activity',
      options: { metric: 'activity', choices: [{ label: 'Run', value: 'run' }, { label: 'Ride', value: 'ride' }, { label: 'Swim', value: 'swim' }, { label: 'Strength', value: 'strength' }] },
    }),
    at(3, { type: 'input-number', title: 'Duration', options: { metric: 'workout-minutes', unit: 'min', step: 5, min: 0 } }),
    at(6, { type: 'input-number', title: 'Distance', options: { metric: 'distance', unit: 'km', step: 0.1, min: 0 } }),
    at(9, { type: 'input-rating', title: 'Effort', options: { metric: 'effort', min: 1, max: 5 } }),
  ],
};

export const HABITS: Dashboard = {
  title: 'Habits',
  kind: 'form',
  panels: [
    at(0, { type: 'input-toggle', title: 'Meditated', options: { metric: 'meditated' } }),
    at(3, { type: 'input-toggle', title: 'Alcohol', options: { metric: 'alcohol' } }),
    at(6, {
      type: 'input-select',
      title: 'Meals',
      options: { metric: 'meals', multi: true, choices: [{ label: 'Breakfast', value: 'b' }, { label: 'Lunch', value: 'l' }, { label: 'Dinner', value: 'd' }] },
    }),
    at(9, { type: 'input-duration', title: 'Screen time', options: { metric: 'screen' } }),
    at(12, { type: 'input-text', title: 'Gratitude', options: { metric: 'gratitude' } }),
  ],
};

export interface FillCase {
  form: Dashboard;
  said: string;
  expected: Record<string, InputValue>;
  /** The rule-based filler gets this one right. */
  rule?: boolean;
}

export const FILL_CASES: FillCase[] = [
  // Field names said: rule-based territory.
  { form: DAILY, said: 'Weight 72.5, sleep 7 hours, mood 4', expected: { weight: 72.5, sleep: 7, mood: 4 }, rule: true },
  { form: DAILY, said: 'weight seventy two point five sleep seven and a half mood four', expected: { weight: 72.5, sleep: 7.5, mood: 4 }, rule: true },
  { form: DAILY, said: 'Mood is 3. Notes: long day at work, skipped lunch', expected: { mood: 3, notes: 'long day at work, skipped lunch' }, rule: true },
  { form: DAILY, said: 'energy buzzing and mood five', expected: { energy: 10, mood: 5 }, rule: true },
  { form: DAILY, said: 'Sleep was 6 hours, weight 80 point 2', expected: { sleep: 6, weight: 80.2 }, rule: true },
  { form: WORKOUT, said: 'Activity run, duration 45 minutes, distance 8.2, effort 4', expected: { activity: 'run', 'workout-minutes': 45, distance: 8.2, effort: 4 }, rule: true },
  { form: HABITS, said: 'meditated yes, alcohol no, meals breakfast and dinner', expected: { meditated: true, alcohol: false, meals: ['b', 'd'] }, rule: true },
  { form: HABITS, said: 'screen time two hours fifteen minutes, gratitude my sister called', expected: { screen: 8100, gratitude: 'my sister called' }, rule: true },

  // Units and choices without field names: rule-based can still get these.
  { form: DAILY, said: '72.5 kilos and 7 hours', expected: { weight: 72.5, sleep: 7 }, rule: true },
  { form: WORKOUT, said: 'Went for a swim, 40 minutes', expected: { activity: 'swim', 'workout-minutes': 40 }, rule: true },
  { form: WORKOUT, said: 'ten k run in fifty five minutes', expected: { activity: 'run', distance: 10, 'workout-minutes': 55 }, rule: true },

  // Natural phrasing: needs a model.
  { form: DAILY, said: 'I slept badly, maybe five hours, feeling pretty low today', expected: { sleep: 5, mood: 2 } },
  { form: DAILY, said: "Feeling great, totally wired, weighed in at seventy one", expected: { weight: 71, energy: 10, mood: 5 } },
  { form: WORKOUT, said: 'Did a hard bike ride for an hour and a half', expected: { activity: 'ride', 'workout-minutes': 90, effort: 5 } },
  { form: WORKOUT, said: 'easy jog, 5k, about half an hour', expected: { activity: 'run', distance: 5, 'workout-minutes': 30, effort: 1 } },
  { form: HABITS, said: "I didn't drink, had lunch and dinner, and I'm grateful for the sunshine", expected: { alcohol: false, meals: ['l', 'd'], gratitude: 'the sunshine' } },
  { form: HABITS, said: 'No meditation today. Phone said three and a half hours.', expected: { meditated: false, screen: 12600 } },
];
