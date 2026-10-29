import { describe, expect, it } from 'vitest';
import { checkFiles, formatJsonText, locate, parseJsonText, setJsonValue, splitPath } from '../src/core';

const manifest = (documents: object, tabs?: object[]) =>
  JSON.stringify(
    {
      version: 1,
      title: 'T',
      tabs: tabs ?? [{ id: 'log', title: 'Log', screen: { type: 'forms', forms: ['daily'] } }],
      documents,
    },
    null,
    2,
  );
const form = JSON.stringify(
  { title: 'Daily', panels: [{ type: 'input-number', title: 'W', gridPos: { x: 0, y: 0, w: 24, h: 3 }, options: { metric: 'w' } }] },
  null,
  2,
);

describe('parseJsonText', () => {
  it('positions syntax errors', () => {
    const { value, errors } = parseJsonText('{\n  "a": 1\n  "b": 2\n}');
    expect(value).toBeUndefined();
    expect(errors[0]).toMatchObject({ message: 'expected a comma', line: 3, column: 3 });
  });

  it('rejects comments and trailing commas like the app does', () => {
    expect(parseJsonText('{"a": 1,}').errors.length).toBeGreaterThan(0);
    expect(parseJsonText('// x\n{}').errors[0].message).toBe('comments are not allowed');
  });

  it('parses good JSON', () => {
    expect(parseJsonText('{"a": [1]}')).toMatchObject({ value: { a: [1] }, errors: [] });
  });
});

describe('locate', () => {
  const text = '{\n  "tabs": [\n    { "id": "x", "screen": { "type": "forms" } }\n  ]\n}';
  const { tree } = parseJsonText(text);
  it('points at values, at keys for objects, and at the nearest ancestor for missing keys', () => {
    expect(splitPath('tabs[0].screen.type')).toEqual(['tabs', 0, 'screen', 'type']);
    expect(locate(text, tree, 'tabs[0].id')).toMatchObject({ line: 3, column: 13, length: 3 });
    expect(locate(text, tree, 'tabs[0].screen')).toMatchObject({ line: 3, column: 18, length: 8 });
    expect(locate(text, tree, 'tabs[0].screen.forms')).toMatchObject({ line: 3, column: 18 });
    expect(locate(text, tree, '(root)')).toMatchObject({ line: 1, column: 1 });
  });
});

describe('checkFiles', () => {
  it('passes a good config', async () => {
    expect(await checkFiles({ 'app.json': manifest({ daily: 'forms/daily.json' }), 'forms/daily.json': form }, 'app.json')).toEqual({
      'app.json': [],
      'forms/daily.json': [],
    });
  });

  it('files each issue under its file, positioned', async () => {
    const broken = form.replace('"metric": "w"', '"metric": ""');
    const out = await checkFiles({ 'app.json': manifest({ daily: 'forms/daily.json', ghost: 'forms/ghost.json' }), 'forms/daily.json': broken }, 'app.json');
    expect(out['forms/daily.json']).toMatchObject([{ severity: 'error', at: 'panels[0].options.metric', message: 'input-number needs a metric to record to', line: 14, column: 19 }]);
    expect(out['app.json'].map((i) => `${i.severity} ${i.at} ${i.message} @${i.line}`)).toEqual(['error documents.ghost file not found @18']);
  });

  it('reports a document that does not parse once, in that file', async () => {
    const out = await checkFiles({ 'app.json': manifest({ daily: 'forms/daily.json' }), 'forms/daily.json': '{ "title": ' }, 'app.json');
    expect(out['app.json']).toEqual([]);
    expect(out['forms/daily.json'][0]).toMatchObject({ severity: 'error', message: 'expected a value' });
  });

  it('positions issues in inline documents within the manifest', async () => {
    const out = await checkFiles({ 'app.json': manifest({ daily: { title: 'D', panels: [{ type: 'stat', title: 'S' }] } }) }, 'app.json');
    expect(out['app.json'].map((i) => `${i.severity} ${i.at}`)).toContain('error documents.daily.panels[0].gridPos');
  });

  it('only parses the manifest when it is broken', async () => {
    const out = await checkFiles({ 'app.json': '{', 'forms/daily.json': form }, 'app.json');
    expect(out['app.json'][0].severity).toBe('error');
    expect(out['forms/daily.json']).toEqual([]);
  });
});

describe('text edits', () => {
  it('formats and sets values without disturbing the rest', () => {
    expect(formatJsonText('{"a":1,"b":[1,2]}')).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
    expect(formatJsonText('{"a":')).toBe('{"a":');
    const text = '{\n  "documents": {\n    "a": "a.json"\n  }\n}';
    expect(setJsonValue(text, ['documents', 'b'], 'b.json')).toBe('{\n  "documents": {\n    "a": "a.json",\n    "b": "b.json"\n  }\n}');
  });
});
