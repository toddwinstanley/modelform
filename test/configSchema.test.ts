import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dashboardSchemaIssues, manifestSchemaIssues, pointerToPath, validateDashboard } from '../src/core';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { stale } = require('../tools/schema.js');

const fixtures = path.join(__dirname, 'fixtures');
const jsonFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? jsonFiles(path.join(dir, d.name)) : d.name.endsWith('.json') ? [path.join(dir, d.name)] : []));

describe('generated schema', () => {
  it('is up to date with the types (run `pnpm --filter modelform schema`)', () => {
    expect(stale()).toEqual([]);
  }, 30_000);
});

describe('pointerToPath', () => {
  it('turns JSON pointers into dotted paths', () => {
    expect(pointerToPath('')).toBe('(root)');
    expect(pointerToPath('/tabs/0/screen')).toBe('tabs[0].screen');
    expect(pointerToPath('/documents/a~1b')).toBe('documents.a/b');
  });
});

describe('every dashboard and form in the fixtures', () => {
  const files = [
    ...jsonFiles(path.join(fixtures, 'tracker')),
    ...jsonFiles(path.join(fixtures, 'config')).filter((f) => !f.endsWith('app.json')),
  ];
  it.each(files.map((f) => [path.relative(fixtures, f), f]))('%s passes the schema', (_name, file) => {
    expect(dashboardSchemaIssues(JSON.parse(fs.readFileSync(file, 'utf8')))).toEqual([]);
  });

  it('includes the app manifest', () => {
    expect(manifestSchemaIssues(JSON.parse(fs.readFileSync(path.join(fixtures, 'config/app.json'), 'utf8')))).toEqual([]);
  });
});

describe('dashboard checks', () => {
  const panel = (extra: object) => ({ type: 'stat', title: 'A', gridPos: { x: 0, y: 0, w: 12, h: 4 }, ...extra });

  it('warns about values of the wrong type, and errors on what would break rendering', () => {
    const doc = {
      title: 'D',
      panels: [
        panel({ datasource: 5 }),
        panel({ fieldConfig: { defaults: { decimals: 'two' } } }),
        { type: 'stat', title: 'B' },
        panel({ type: 'input-number', options: { metric: 'm', step: 'x' } }),
        panel({ type: 'input-select', options: { metric: 's', choices: [{ label: 'A' }] } }),
      ],
    };
    expect(validateDashboard(doc, 'd.json').map((i) => `${i.severity} ${i.path} ${i.message}`)).toEqual([
      'error d.json: panels[2].gridPos must have numeric x, y, w and h',
      'warning d.json: panels[0].datasource must be object, string or null',
      'warning d.json: panels[1].fieldConfig.defaults.decimals must be number',
      'warning d.json: panels[3].options.step must be number',
      'warning d.json: panels[4].options.choices[0].value is required',
    ]);
  });

  it('tolerates keys it does not know, as Grafana exports have plenty', () => {
    expect(dashboardSchemaIssues({ title: 'D', schemaVersion: 39, editable: true, panels: [panel({ pluginVersion: '11' })] })).toEqual([]);
  });
});
