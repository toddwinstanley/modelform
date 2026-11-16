import { describe, expect, it } from 'vitest';
import { AUTHORING_GUIDE, DOCUMENT_GUIDE, documentChanges, documentPrompt, EXAMPLE_TEMPLATE, fixDocumentPrompt, fixTemplatePrompt, jsonFromAnswer, readDocumentAnswer, readTemplateAnswer, templatePrompt } from '../src/core';

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

describe('editing one document', () => {
  const form = EXAMPLE_TEMPLATE.documents[0].dashboard;
  const dashboard = EXAMPLE_TEMPLATE.documents[1].dashboard;

  it('documentPrompt quotes the request, shows the document and asks for all of it back', () => {
    const p = documentPrompt('Add a notes field', form, { recorded: ['water', 'weight'] });
    expect(p).toContain('Change this form for me:\n\n> Add a notes field');
    expect(p).toContain('`water`, `weight`');
    expect(p).toContain(JSON.stringify(form, null, 2));
    expect(p).toContain('the whole changed form');
    expect(p).toContain(DOCUMENT_GUIDE);
    expect(p).not.toContain('## Tabs');
    expect(p).not.toMatch(/\n\n\n/);
  });

  it('readDocumentAnswer takes a document, or a template holding one', () => {
    const changed = { ...form, title: 'Today, changed' };
    expect(readDocumentAnswer(answer(changed), 'form')).toEqual({ document: changed, warnings: [] });
    const wrapped = { $modelform: 'template', version: 1, title: 'T', documents: [{ kind: 'form', id: 'x', dashboard: changed }] };
    expect(readDocumentAnswer(answer(wrapped), 'form')).toEqual({ document: changed, warnings: [] });
  });

  it('readDocumentAnswer adds the kind when it was left out', () => {
    const { kind: _, ...bare } = form;
    expect(readDocumentAnswer(answer(bare), 'form')).toEqual({ document: { kind: 'form', ...bare }, warnings: [] });
  });

  it('readDocumentAnswer refuses the wrong kind, a template of several, and non-documents', () => {
    expect(readDocumentAnswer(answer(dashboard), 'form')).toEqual({ error: 'That’s a dashboard, not a form' });
    expect(readDocumentAnswer(answer(EXAMPLE_TEMPLATE), 'form')).toEqual({ error: 'That’s a template, not one form' });
    expect(readDocumentAnswer(answer([1, 2]), 'form')).toEqual({ error: 'That isn’t a form' });
    expect(readDocumentAnswer(answer({ kind: 'form', title: 'No panels' }), 'form')).toHaveProperty('error');
    // Without a stated kind it goes by inputs.
    const { kind: _f, ...bareForm } = form;
    const { kind: _d, ...bareDashboard } = dashboard;
    expect(readDocumentAnswer(answer(bareDashboard), 'form')).toEqual({ error: 'That has no inputs, so it isn’t a form' });
    expect(readDocumentAnswer(answer(bareForm), 'dashboard')).toEqual({ error: 'That has inputs, so it’s a form, not a dashboard' });
  });

  it('readDocumentAnswer warns about values that will be ignored', () => {
    const bad = structuredClone(dashboard) as any;
    bad.panels[0].options.reduceOptions.calcs = 'mean';
    const read = readDocumentAnswer(answer(bad), 'dashboard');
    if ('error' in read) throw new Error(read.error);
    expect(read.warnings).toEqual([expect.stringMatching(/^dashboard: panels\[0\]\.options\.reduceOptions\.calcs/)]);
  });

  it('fixDocumentPrompt names the kind', () => {
    expect(fixDocumentPrompt(['a'], 'dashboard')).toBe(
      'modelform couldn’t use that dashboard as it was:\n\n- a\n\nFix these and reply with the whole corrected dashboard as one ```json code block.',
    );
  });

  it('documentChanges lists what was added, removed and changed', () => {
    const after = structuredClone(dashboard) as any;
    after.title = 'By day and week';
    after.panels[0].title = 'Mean sleep';
    after.panels[1].gridPos.y = 20;
    after.panels[2].targets[0].bucket = '1w';
    after.panels[2].gridPos.h = 9;
    after.panels.splice(3, 1);
    after.panels.push({ id: 5, type: 'text', title: '', gridPos: { x: 0, y: 30, w: 24, h: 3 }, options: { content: 'Hi' } });
    expect(documentChanges(dashboard, after)).toEqual({
      document: ['title'],
      panels: [
        { change: 'changed', id: 1, title: 'Mean sleep', type: 'stat', what: ['title'] },
        { change: 'changed', id: 2, title: 'Water today', type: 'stat', what: ['position'] },
        { change: 'changed', id: 3, title: 'Water per day', type: 'barchart', what: ['size', 'queries'] },
        { change: 'added', id: 5, title: 'text', type: 'text', what: [] },
        { change: 'removed', id: 4, title: 'Sleep quality', type: 'timeseries', what: [] },
      ],
    });
    expect(documentChanges(dashboard, structuredClone(dashboard))).toEqual({ document: [], panels: [] });
  });

  it('documentChanges looks inside rows', () => {
    const before = { title: 'R', panels: [{ id: 1, type: 'row', title: 'S', gridPos: { x: 0, y: 0, w: 24, h: 1 }, collapsed: true, panels: [{ id: 2, type: 'stat', title: 'A', gridPos: { x: 0, y: 1, w: 6, h: 4 } }] }] } as any;
    const after = structuredClone(before);
    after.panels[0].panels[0].title = 'B';
    expect(documentChanges(before, after).panels).toEqual([{ change: 'changed', id: 2, title: 'B', type: 'stat', what: ['title'] }]);
  });
});
