import { describe, expect, it } from 'vitest';
import {
  initialVariableValues,
  newVariable,
  renameVariableInPanels,
  variableNameError,
  variableUses,
  variableWithCurrent,
  variableWithFlags,
  variableWithQuery,
  variableWithType,
  type Dashboard,
  type Panel,
} from '../src';

describe('variable names', () => {
  it('checks the pattern, built-ins and clashes', () => {
    expect(variableNameError('metric', [])).toBeNull();
    expect(variableNameError('', [])).toMatch(/name/);
    expect(variableNameError('1x', [])).toMatch(/letters/);
    expect(variableNameError('a-b', [])).toMatch(/letters/);
    expect(variableNameError('__range', [])).toMatch(/built-ins/);
    expect(variableNameError('metric', ['metric'])).toMatch(/already/);
  });
});

describe('editing variables', () => {
  it('starts new variables with unclashing names and a selection', () => {
    const v = newVariable('custom', ['choice']);
    expect(v).toEqual({ name: 'choice2', type: 'custom', query: 'a, b, c', current: { text: 'a', value: 'a' } });
    expect(newVariable('constant', [])).toMatchObject({ type: 'constant', hide: 2 });
    expect(newVariable('interval', [])).toMatchObject({ query: '1h,1d,1w', current: { value: '1h' } });
  });

  it('keeps the selection when the options still have it, and drops stale saved options', () => {
    const v = { name: 'm', type: 'custom', query: 'a, b', current: { text: 'b', value: 'b' }, options: [{ text: 'b', value: 'b' }] };
    expect(variableWithQuery(v, 'b, c')).toEqual({ name: 'm', type: 'custom', query: 'b, c', current: { text: 'b', value: 'b' } });
    expect(variableWithQuery(v, 'Weight : weight, c').current).toEqual({ text: 'Weight', value: 'weight' });
  });

  it('turns multi-value and All on and off', () => {
    const v = variableWithQuery({ name: 'm', type: 'custom' }, 'a, b');
    const multi = variableWithFlags(v, { multi: true });
    expect(multi.current).toEqual({ text: ['a'], value: ['a'] });
    expect(variableWithFlags(multi, { multi: false }).current).toEqual({ text: 'a', value: 'a' });
    const all = variableWithCurrent(variableWithFlags(v, { includeAll: true }), '$__all');
    expect(all.current).toEqual({ text: 'All', value: '$__all' });
    expect(variableWithFlags(all, { includeAll: false })).not.toHaveProperty('includeAll');
  });

  it('gives textboxes and constants their query as the value', () => {
    const t = variableWithQuery({ name: 't', type: 'textbox' }, 'hello');
    expect(t.current).toEqual({ text: 'hello', value: 'hello' });
    expect(initialVariableValues({ title: '', panels: [], templating: { list: [t] } })).toEqual({ t: 'hello' });
  });

  it('changes type keeping the name and label', () => {
    expect(variableWithType({ name: 'x', label: 'X', type: 'custom', query: 'a', multi: true }, 'textbox')).toEqual({
      name: 'x',
      label: 'X',
      type: 'textbox',
      query: '',
      current: { text: '', value: '' },
    });
  });
});

describe('variable uses', () => {
  const panels: Panel[] = [
    { id: 1, type: 'timeseries', title: '$metric over time', targets: [{ refId: 'A', metric: '${metric}', bucket: '$interval' }] },
    { id: 2, type: 'row', title: 'Each', repeat: 'metric', panels: [{ id: 3, type: 'stat', title: 'Stat', targets: [{ refId: 'A', metric: '[[metric:text]]' }] }] },
    { id: 4, type: 'text', title: 'Other', options: { content: '$metrics is different' } },
  ];
  const dashboard: Dashboard = { title: 'D', panels };

  it('lists the panels that refer to or repeat by a variable', () => {
    expect(variableUses(dashboard, 'metric')).toEqual(['$metric over time', 'Each', 'Stat']);
    expect(variableUses(dashboard, 'interval')).toEqual(['$metric over time']);
    expect(variableUses(dashboard, 'nope')).toEqual([]);
  });

  it('renames every use', () => {
    const renamed = renameVariableInPanels(panels, 'metric', 'measure');
    expect(renamed[0]).toMatchObject({ title: '$measure over time', targets: [{ metric: '${measure}', bucket: '$interval' }] });
    expect(renamed[1]).toMatchObject({ repeat: 'measure', panels: [{ targets: [{ metric: '[[measure:text]]' }] }] });
    expect(renamed[2]).toEqual(panels[2]);
  });
});
