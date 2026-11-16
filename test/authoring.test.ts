import { describe, expect, it } from 'vitest';
import { AUTHORING_GUIDE, EXAMPLE_TEMPLATE, fixTemplatePrompt, jsonFromAnswer, readTemplateAnswer, templatePrompt } from '../src/core';

const answer = (json: unknown, before = 'Here’s your template:') => `${before}\n\n\`\`\`json\n${JSON.stringify(json, null, 2)}\n\`\`\`\n`;

describe('templatePrompt', () => {
  it('quotes the request and lists what the app has', () => {
    const p = templatePrompt('Track my runs\nand my weight', { recorded: ['weight'], icons: ['edit', 'chart'] });
    expect(p).toContain('> Track my runs\n> and my weight');
    expect(p).toContain('`weight`');
    expect(p).toContain('`edit`, `chart`');
    expect(p).toContain(AUTHORING_GUIDE);
  });

  it('says when the app records nothing yet', () => {
    expect(templatePrompt('x')).toContain('doesn’t record anything yet');
  });
});

describe('the guide’s example', () => {
  it('is a template modelform reads without warnings', () => {
    const read = readTemplateAnswer(answer(EXAMPLE_TEMPLATE));
    expect(read).toEqual({ template: EXAMPLE_TEMPLATE, warnings: [] });
  });

  it('is in the prompt', () => {
    expect(templatePrompt('x')).toContain(JSON.stringify(EXAMPLE_TEMPLATE));
  });
});

describe('jsonFromAnswer', () => {
  it('takes the last json block that parses', () => {
    expect(jsonFromAnswer('```json\n{"a":1}\n```\nthen\n```json\n{"b":2}\n```')).toEqual({ b: 2 });
    expect(jsonFromAnswer('```json\n{"a":1}\n```\n```json\n{oops\n```')).toEqual({ a: 1 });
  });

  it('takes bare JSON, or JSON inside prose', () => {
    expect(jsonFromAnswer('{"a":1}')).toEqual({ a: 1 });
    expect(jsonFromAnswer('Sure! {"a":{"b":2}} Hope that helps.')).toEqual({ a: { b: 2 } });
    expect(jsonFromAnswer('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('says when there is none', () => {
    expect(() => jsonFromAnswer('I can’t help with that.')).toThrow('There’s no JSON in that answer');
  });
});

describe('readTemplateAnswer', () => {
  it('passes on parseTemplate’s errors', () => {
    expect(readTemplateAnswer(answer({ title: 'T' }))).toEqual({ error: 'That isn’t a template' });
    expect(readTemplateAnswer('nothing here')).toEqual({ error: 'There’s no JSON in that answer' });
  });

  it('warns about what was dropped or looks wrong', () => {
    const t = structuredClone(EXAMPLE_TEMPLATE) as any;
    t.documents[1].dashboard.panels[0].options.reduceOptions.calcs = 'mean';
    t.tabs.push({ id: 'ghost', title: 'Ghost', screen: { type: 'dashboard', dashboard: 'nope' } });
    t.tabs.push({ id: 'wrong', title: 'Wrong', screen: { type: 'forms', forms: ['by-day'] } });
    const read = readTemplateAnswer(answer(t));
    if ('error' in read) throw new Error(read.error);
    expect(read.warnings).toContainEqual(expect.stringMatching(/^by-day: panels\[0\]/));
    expect(read.warnings).toContain('tabs[2] was left out: it needs an id, a title and a screen showing only this template’s documents');
    expect(read.warnings).toContain('tab "wrong" shows "by-day" as a form, but it’s a dashboard');
  });
});

describe('fixTemplatePrompt', () => {
  it('lists the problems and asks for the whole template again', () => {
    expect(fixTemplatePrompt(['a', 'b'])).toBe(
      'modelform couldn’t use that template as it was:\n\n- a\n- b\n\nFix these and reply with the whole corrected template as one ```json code block.',
    );
  });
});
