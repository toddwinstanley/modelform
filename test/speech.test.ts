import { describe, expect, it } from 'vitest';
import { matchChoices, parseSpokenDuration, parseSpokenNumber, parseSpokenYesNo, spokenValue, type InputPanel } from '../src/core';

const panel = (type: InputPanel['type'], options: Partial<InputPanel['options']> = {}): InputPanel => ({
  type,
  title: 'Field',
  gridPos: { x: 0, y: 0, w: 24, h: 3 },
  options: { metric: 'm', ...options },
});

describe('parseSpokenNumber', () => {
  it.each([
    ['125', 125],
    ['5.2', 5.2],
    ['72,5', 72.5],
    ['1,250', 1250],
    ['about 80 kilos', 80],
    ['-3', -3],
    ['minus three', -3],
    ['negative 2.5', -2.5],
    ['seven', 7],
    ['seventeen', 17],
    ['seventy two', 72],
    ['seventy-two', 72],
    ['one twenty-five', 125],
    ['one twenty five', 125],
    ['two fifty', 250],
    ['nineteen oh five', 1905],
    ['two oh five', 205],
    ['one hundred and five', 105],
    ['a hundred and ten', 110],
    ['two thousand three hundred', 2300],
    ['five point two', 5.2],
    ['five point two five', 5.25],
    ['seventy two point five kilos', 72.5],
    ['point five', 0.5],
    ['zero point seven five', 0.75],
    ['three point twenty five', 3.25],
    ['80 point five', 80.5],
    ['two and a half', 2.5],
    ['10 and a half', 10.5],
    ['one and a quarter', 1.25],
    ['I did 12 reps', 12],
  ])('%s → %s', (said, n) => expect(parseSpokenNumber(said)).toBe(n));

  it('is null without a number', () => {
    expect(parseSpokenNumber('')).toBeNull();
    expect(parseSpokenNumber('banana')).toBeNull();
    expect(parseSpokenNumber('and')).toBeNull();
    expect(parseSpokenNumber('a lot')).toBeNull();
  });

  it('ignores "minus" when other words come before the number', () => {
    expect(parseSpokenNumber('minus about three')).toBe(3);
  });
});

describe('parseSpokenDuration', () => {
  it.each([
    ['1:32.45', 92.45],
    ['01:32', 92],
    ['1:02:03', 3723],
    ['one minute thirty two point four five', 92.45],
    ['one minute thirty two point four five seconds', 92.45],
    ['92 seconds', 92],
    ['2 minutes', 120],
    ['an hour and ten minutes', 4200],
    ['a minute and a half', 90],
    ['one minute thirty', 90],
  ])('%s → %s', (said, s) => expect(parseSpokenDuration(said)).toBe(s));

  it('is null without a time', () => expect(parseSpokenDuration('fast')).toBeNull());
});

describe('matchChoices', () => {
  const moods = [
    { label: 'Good', value: 'good' },
    { label: 'Very good', value: 'very-good' },
    { label: 'Bad', value: 'bad' },
  ];

  it('matches labels as whole words, ignoring case', () => {
    expect(matchChoices('good', moods)).toEqual(['good']);
    expect(matchChoices('Pretty BAD today', moods)).toEqual(['bad']);
    expect(matchChoices('goodness', moods)).toEqual([]);
  });

  it('prefers the longest label where two overlap', () => {
    expect(matchChoices('very good', moods)).toEqual(['very-good']);
  });

  it('returns every choice said, in order, once each', () => {
    expect(matchChoices('bad then good then bad', moods)).toEqual(['bad', 'good']);
  });

  it('ignores plurals, accents and punctuation', () => {
    const food = [
      { label: 'Eggs', value: 1 },
      { label: 'Crème brûlée', value: 2 },
      { label: 'Toast', value: 3 },
    ];
    expect(matchChoices('egg and toasts', food)).toEqual([1, 3]);
    expect(matchChoices('creme brulee!', food)).toEqual([2]);
  });

  it('matches a spoken number to a numbered choice', () => {
    const levels = [1, 2, 3].map((n) => ({ label: String(n), value: n }));
    expect(matchChoices('two', levels)).toEqual([2]);
    expect(matchChoices('3', levels)).toEqual([3]);
  });
});

describe('parseSpokenYesNo', () => {
  it('reads yes and no, with no winning', () => {
    expect(parseSpokenYesNo('Yes')).toBe(true);
    expect(parseSpokenYesNo('yeah I did')).toBe(true);
    expect(parseSpokenYesNo('nope')).toBe(false);
    expect(parseSpokenYesNo('not done')).toBe(false);
    expect(parseSpokenYesNo("didn't")).toBe(false);
    expect(parseSpokenYesNo('maybe')).toBeNull();
  });
});

describe('spokenValue', () => {
  it('adds dictated text after what multi-line text already has', () => {
    expect(spokenValue(panel('input-text'), 'felt strong')).toEqual({ value: 'felt strong' });
    expect(spokenValue(panel('input-text'), 'felt strong', 'Good day.')).toEqual({ value: 'Good day. felt strong' });
    // A single-line suggest field is replaced, not added to.
    expect(spokenValue(panel('input-text', { suggest: true }), 'Laguna Seca', 'Spa')).toEqual({ value: 'Laguna Seca' });
  });

  it('reads numbers, rounding for whole-number steps', () => {
    expect(spokenValue(panel('input-number', { step: 0.1 }), 'seventy two point five')).toEqual({ value: 72.5 });
    expect(spokenValue(panel('input-number'), 'twelve point six')).toEqual({ value: 13 });
    expect(spokenValue(panel('input-number'), 'lots')).toEqual({ problem: 'Heard “lots”, not a number' });
    // Out of range is left for the form to flag, not clamped away.
    expect(spokenValue(panel('input-number', { max: 10 }), '250')).toEqual({ value: 250 });
  });

  it('reads durations as seconds', () => {
    expect(spokenValue(panel('input-duration'), 'one minute thirty two point four five')).toEqual({ value: 92.45 });
    expect(spokenValue(panel('input-duration'), '45')).toEqual({ value: 45 });
  });

  it('picks choices, adding to a multi-select', () => {
    const choices = [
      { label: 'Run', value: 'run' },
      { label: 'Swim', value: 'swim' },
      { label: 'Bike', value: 'bike' },
    ];
    expect(spokenValue(panel('input-select', { choices }), 'a swim')).toEqual({ value: 'swim' });
    expect(spokenValue(panel('input-select', { choices, multi: true }), 'bike and swim', ['swim'])).toEqual({ value: ['swim', 'bike'] });
    expect(spokenValue(panel('input-select', { choices }), 'yoga')).toEqual({ problem: 'Heard “yoga”, not one of the choices' });
    // Runtime choices (choicesFrom) are passed in.
    expect(spokenValue(panel('input-select', { choicesFrom: 'wheels' }), 'set B', null, [{ label: 'Set B', value: 2 }])).toEqual({ value: 2 });
  });

  it('reads slider labels and numbers', () => {
    const p = panel('input-slider', { min: -2, max: 2, labels: ['Understeer', 'Neutral', 'Oversteer'] });
    expect(spokenValue(p, 'oversteer')).toEqual({ value: 2 });
    expect(spokenValue(p, 'neutral')).toEqual({ value: 0 });
    expect(spokenValue(p, 'minus one')).toEqual({ value: -1 });
  });

  it('reads toggles and ratings', () => {
    expect(spokenValue(panel('input-toggle'), 'yes')).toEqual({ value: true });
    expect(spokenValue(panel('input-rating'), 'four stars')).toEqual({ value: 4 });
  });

  it('says when nothing was heard', () => {
    expect(spokenValue(panel('input-number'), '  ')).toEqual({ problem: 'Didn’t hear anything' });
  });
});
