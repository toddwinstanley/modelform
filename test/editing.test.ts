import { describe, expect, it, vi } from 'vitest';
import { checkFiles, formatJsonText, HttpConfigFiles, locate, parseJsonText, readConfigFiles, SaveConflictError, setJsonValue, splitPath } from '../src/core';

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

describe('HttpConfigFiles', () => {
  it('saves against the revision it read, and reports a conflict', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const responses: Response[] = [
      new Response('{}', { status: 200, headers: { ETag: '"3"' } }), // read
      new Response('{}', { status: 200, headers: { ETag: '"4"' } }), // save
      new Response('{"error":"stale"}', { status: 412 }), // save again, someone else saved
      new Response(null, { status: 201, headers: { ETag: '"1"' } }), // new file
    ];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return responses.shift()!;
    });
    try {
      const files = new HttpConfigFiles('https://api.test/v1/configs/c1/files/app.json', () => 'tok');
      await files.read('forms/a.json');
      await files.write('forms/a.json', '{}');
      await expect(files.write('forms/a.json', '{}')).rejects.toBeInstanceOf(SaveConflictError);
      await files.write('forms/new.json', '{}');
      expect(calls.map((c) => [c.url, (c.init.headers as Record<string, string>) ?? {}])).toEqual([
        ['https://api.test/v1/configs/c1/files/forms/a.json', { Authorization: 'Bearer tok' }],
        ['https://api.test/v1/configs/c1/files/forms/a.json', { Authorization: 'Bearer tok', 'If-Match': '"3"', 'Content-Type': 'application/json' }],
        ['https://api.test/v1/configs/c1/files/forms/a.json', { Authorization: 'Bearer tok', 'If-Match': '"4"', 'Content-Type': 'application/json' }],
        ['https://api.test/v1/configs/c1/files/forms/new.json', { Authorization: 'Bearer tok', 'If-None-Match': '*', 'Content-Type': 'application/json' }],
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reads the whole config in one request and saves several files as one change', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const bundle = {
      $bundle: 1,
      revision: 5,
      manifest: 'app.json',
      commit: '../commit',
      files: { 'app.json': { revision: 2, text: manifest({ daily: 'forms/daily.json' }) }, 'forms/daily.json': { revision: 4, text: form } },
    };
    const responses: Response[] = [
      new Response(JSON.stringify(bundle), { status: 200, headers: { 'Content-Type': 'application/vnd.modelform.bundle+json' } }),
      new Response(JSON.stringify({ revision: 6, files: { 'app.json': 3, 'forms/new.json': 1 } }), { status: 200 }),
      new Response(JSON.stringify({ error: 'stale', conflicts: { 'forms/daily.json': 9 } }), { status: 412 }),
    ];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return responses.shift()!;
    });
    try {
      const files = new HttpConfigFiles('https://api.test/v1/configs/c1/files/app.json', () => 'tok');
      expect(files.atomic).toBe(false);
      expect(await readConfigFiles(files)).toEqual({ 'app.json': bundle.files['app.json'].text, 'forms/daily.json': form });
      expect(files.atomic).toBe(true);
      expect((calls[0].init.headers as Record<string, string>).Accept).toContain('application/vnd.modelform.bundle+json');

      await files.commit({ 'app.json': '{}', 'forms/new.json': '{}' });
      expect(calls[1].url).toBe('https://api.test/v1/configs/c1/commit');
      expect(JSON.parse(calls[1].init.body as string)).toEqual({
        files: { 'app.json': { text: '{}', ifMatch: 2 }, 'forms/new.json': { text: '{}', ifMatch: null } },
      });

      // The next commit is based on what the last one saved, and reports every conflict.
      const error = await files.commit({ 'app.json': '{"a":1}', 'forms/daily.json': '{}' }).catch((e) => e);
      expect(error).toBeInstanceOf(SaveConflictError);
      expect(error.paths).toEqual(['forms/daily.json']);
      expect(JSON.parse(calls[2].init.body as string).files).toEqual({
        'app.json': { text: '{"a":1}', ifMatch: 3 },
        'forms/daily.json': { text: '{}', ifMatch: 4 },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reads file by file from a server that doesn’t bundle', async () => {
    const served: Record<string, string> = {
      'https://files.test/c/app.json': manifest({ daily: 'forms/daily.json' }),
      'https://files.test/c/forms/daily.json': form,
    };
    vi.stubGlobal('fetch', async (url: string) => (url in served ? new Response(served[url], { status: 200 }) : new Response('', { status: 404 })));
    try {
      const files = new HttpConfigFiles('https://files.test/c/app.json');
      expect(Object.keys(await readConfigFiles(files))).toEqual(['app.json', 'forms/daily.json']);
      expect(files.atomic).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
