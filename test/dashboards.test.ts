import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { listDashboards, renderIndex, writeIndex } from '../tools/dashboards';

function tempDir(files: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashkit-'));
  for (const f of files) fs.writeFileSync(path.join(dir, f), '{}');
  return dir;
}

describe('dashboards index generator', () => {
  it('lists json files sorted, ignoring everything else', () => {
    const dir = tempDir(['b.json', 'a.json', 'notes.md', 'index.ts']);
    expect(listDashboards(dir).map((e: { id: string }) => e.id)).toEqual(['a', 'b']);
  });

  it('quotes ids that are not identifiers', () => {
    const out = renderIndex([
      { id: 'laps', file: 'laps.json' },
      { id: 'service-overview', file: 'service-overview.json' },
    ]);
    expect(out).toContain("  laps: require('./laps.json'),\n");
    expect(out).toContain("  'service-overview': require('./service-overview.json'),\n");
    expect(out).toContain("export type BundledId = 'laps' | 'service-overview';");
  });

  it('types an empty folder as never', () => {
    expect(renderIndex([])).toContain('export type BundledId = never;');
  });

  it('only writes when the output changes', () => {
    const dir = tempDir(['a.json']);
    expect(writeIndex(dir)).toBe(true);
    expect(writeIndex(dir)).toBe(false);
    fs.writeFileSync(path.join(dir, 'b.json'), '{}');
    expect(writeIndex(dir)).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'index.ts'), 'utf8')).toContain("b: require('./b.json')");
  });
});
