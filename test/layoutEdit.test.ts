import { describe, expect, it } from 'vitest';
import {
  applyJsonEdits,
  collapseRow,
  diffJson,
  gridOffsetPx,
  dropTarget,
  duplicatePanel,
  expandRow,
  insertPanel,
  layoutCanvas,
  layoutDashboard,
  movePanel,
  panelEdits,
  placePanel,
  readingOrder,
  removePanel,
  repack,
  resizePanel,
  setHiddenOnPhones,
  settleLayout,
  snapToGrid,
  stringifyCompact,
  type Panel,
} from '../src/core';

const p = (id: number, x: number, y: number, w: number, h = 4, extra: Partial<Panel> = {}): Panel => ({ id, type: 'stat', title: `P${id}`, gridPos: { x, y, w, h }, ...extra });
const row = (id: number, y: number, extra: Partial<Panel> = {}): Panel => ({ id, type: 'row', title: `R${id}`, gridPos: { x: 0, y, w: 24, h: 1 }, ...extra });
const ids = (panels: Panel[], order = readingOrder(panels)) => order.map((i) => panels[i].id);
/** What the app shows, in order: panel ids per packed line. */
const appLines = (panels: Panel[]) =>
  layoutDashboard({ title: 'T', panels }, 'grid').flatMap((s) => [...(s.row ? [[`row ${s.row.id}`]] : []), ...s.rows.map((r) => r.cells.map((c) => String(c.panel.id)))]);

describe('stringifyCompact', () => {
  it('keeps short objects on one line and breaks long ones', () => {
    expect(stringifyCompact({ x: 0, y: 1 })).toBe('{ "x": 0, "y": 1 }');
    expect(stringifyCompact({ id: 1, type: 'stat', title: 'A long enough title to wrap the line', gridPos: { x: 0, y: 0, w: 24, h: 4 } }, 4)).toBe(
      '{\n      "id": 1,\n      "type": "stat",\n      "title": "A long enough title to wrap the line",\n      "gridPos": { "x": 0, "y": 0, "w": 24, "h": 4 }\n    }',
    );
    expect(stringifyCompact([])).toBe('[]');
  });
});

describe('applyJsonEdits', () => {
  const text = '{\n  "panels": [\n    { "id": 1, "gridPos": { "x": 0, "y": 0 } },\n    {\n      "id": 2\n    }\n  ]\n}';

  it('changes values in place', () => {
    expect(applyJsonEdits(text, [{ path: ['panels', 0, 'gridPos', 'x'], value: 6 }])).toBe(text.replace('"x": 0', '"x": 6'));
  });

  it('removes array elements and keys without reformatting neighbours', () => {
    expect(applyJsonEdits(text, [{ path: ['panels', 0], remove: true }])).toBe('{\n  "panels": [\n    {\n      "id": 2\n    }\n  ]\n}');
    expect(applyJsonEdits(text, [{ path: ['panels', 1], remove: true }])).toBe('{\n  "panels": [\n    { "id": 1, "gridPos": { "x": 0, "y": 0 } }\n  ]\n}');
    expect(applyJsonEdits(text, [{ path: ['panels', 0, 'gridPos', 'y'], remove: true }])).toContain('{ "id": 1, "gridPos": { "x": 0 } }');
  });

  it('adds keys and array elements in the compact style', () => {
    expect(applyJsonEdits(text, [{ path: ['panels', 1, 'mobile'], value: { span: 12 } }])).toContain('"id": 2,\n      "mobile": { "span": 12 }\n');
    const inserted = applyJsonEdits(text, [{ path: ['panels', 2], value: { id: 3, gridPos: { x: 0, y: 4 } }, insert: true }]);
    expect(JSON.parse(inserted).panels[2]).toEqual({ id: 3, gridPos: { x: 0, y: 4 } });
    expect(inserted).toContain('{ "id": 3, "gridPos": { "x": 0, "y": 4 } }');
  });
});

describe('diffJson', () => {
  it('sets changed leaves, removes dropped keys, and inserts into resized arrays', () => {
    expect(diffJson({ a: 1, b: { c: 2, d: 3 }, e: [1] }, { a: 1, b: { c: 5 }, e: [1, 2] })).toEqual([
      { path: ['b', 'd'], remove: true },
      { path: ['b', 'c'], value: 5 },
      { path: ['e', 1], value: 2, insert: true },
    ]);
  });

  it('adds or removes array elements between the ones that match, editing the rest in place', () => {
    expect(diffJson([1, 2, 3], [1, 9, 2, 3])).toEqual([{ path: [1], value: 9, insert: true }]);
    expect(diffJson([1, 2, 3, 4], [1, 4])).toEqual([
      { path: [2], remove: true },
      { path: [1], remove: true },
    ]);
    expect(diffJson([{ a: 1 }, 2], [{ a: 5 }, 7, 8])).toEqual([
      { path: [0, 'a'], value: 5 },
      { path: [1], value: 7 },
      { path: [2], value: 8, insert: true },
    ]);
  });

  it('keeps how untouched elements were written when one is added or removed', () => {
    const text = '{\n  "tabs": [\n    { "id": "a", "title": "A" },\n    {\n      "id": "b",\n      "title": "B"\n    }\n  ]\n}';
    const before = JSON.parse(text);
    const added = applyJsonEdits(text, diffJson(before, { tabs: [...before.tabs, { id: 'c', title: 'C' }] }));
    expect(added).toContain('{ "id": "a", "title": "A" },\n    {\n      "id": "b",');
    expect(JSON.parse(added).tabs.map((t: { id: string }) => t.id)).toEqual(['a', 'b', 'c']);
    const removed = applyJsonEdits(text, diffJson(before, { tabs: [before.tabs[1]] }));
    expect(JSON.parse(removed)).toEqual({ tabs: [{ id: 'b', title: 'B' }] });
    expect(removed).toContain('{\n      "id": "b",');
  });
});

describe('layout ops', () => {
  // Line 1: 1 (12) 2 (12); row 10; line 2: 3 (8) 4 (8) 5 (8)
  const panels = [p(1, 0, 0, 12), p(2, 12, 0, 12), row(10, 4), p(3, 0, 5, 8), p(4, 8, 5, 8), p(5, 16, 5, 8)];

  it('repacks positions from an order, matching what the app shows', () => {
    const order = [4, 0, 1, 2, 3, 5]; // panel 4 first
    const out = repack(panels, order);
    expect(ids(out)).toEqual([4, 1, 2, 10, 3, 5]);
    expect(appLines(out)).toEqual([['4', '1'], ['2'], ['row 10'], ['3', '5']]);
  });

  it('leaves an already packed layout alone', () => {
    expect(repack(panels, readingOrder(panels))).toEqual(panels);
  });

  it('moves panels before another in reading order, for phones, by taking its place', () => {
    const before3 = movePanel(panels, 4, 3);
    expect(before3[4].gridPos).toMatchObject({ x: 0, y: 5 });
    // The grid decides the order: 4 lands right before 3, and 5, beside 4, floats up ahead of 3 too.
    expect(ids(before3)).toEqual([1, 2, 10, 4, 5, 3]);
    expect(ids(movePanel(panels, 0, null))).toEqual([2, 10, 3, 4, 5, 1]);
    expect(ids(movePanel(panels, 2, 0))).toEqual([10, 1, 2, 3, 4, 5]);
    expect(appLines(movePanel(panels, 2, 0))).toEqual([['row 10'], ['1', '2'], ['3', '4', '5']]);
    expect(movePanel(panels, 3, 3)).toBe(panels);
  });

  it('places a panel anywhere on the grid, moving what’s in the way down', () => {
    // A tall panel with a short one beside it, and one under the tall one.
    const grid = [p(1, 0, 0, 12, 8), p(2, 12, 0, 12, 4), p(3, 0, 8, 12, 4)];
    const stacked = placePanel(grid, 2, 12, 4);
    expect(stacked.map((x) => x.gridPos)).toEqual([
      { x: 0, y: 0, w: 12, h: 8 },
      { x: 12, y: 0, w: 12, h: 4 },
      { x: 12, y: 4, w: 12, h: 4 },
    ]);
    const onTop = placePanel(grid, 2, 12, 0);
    expect(onTop[2].gridPos).toMatchObject({ x: 12, y: 0 });
    expect(onTop[1].gridPos).toMatchObject({ x: 12, y: 4 });
    // Dropped low with nothing above, it floats up; dropped past the right edge, it stays on the grid.
    expect(placePanel(grid, 1, 30, 40)[1].gridPos).toMatchObject({ x: 12, y: 0 });
  });

  it('settles a layout the way the app shows it, leaving panels in place alone', () => {
    const gappy = [p(1, 0, 0, 12, 2), p(2, 12, 0, 12, 6), p(3, 0, 6, 12, 4)];
    const out = settleLayout(gappy);
    expect(out[2].gridPos).toEqual({ x: 0, y: 2, w: 12, h: 4 }); // floats up beside the taller one
    expect(out[0]).toBe(gappy[0]);
    expect(settleLayout(panels)).toEqual(panels);
  });

  it('resizes on the grid or for phones', () => {
    const wider = resizePanel(panels, 3, 'grid', 16, 6);
    expect(wider[3].gridPos).toEqual({ x: 0, y: 5, w: 16, h: 6 });
    expect(wider[4].gridPos).toEqual({ x: 8, y: 11, w: 8, h: 4 }); // covered, so it moves down
    expect(wider[5].gridPos).toEqual({ x: 16, y: 5, w: 8, h: 4 }); // not covered, so it stays
    // Widened past the right edge, it moves left to stay on the grid.
    expect(resizePanel(panels, 5, 'grid', 12, 4)[5].gridPos).toMatchObject({ x: 12, w: 12 });
    const phone = resizePanel(panels, 3, 'phone', 12, 3);
    expect(phone[3].mobile).toEqual({ span: 12, h: 3 });
    expect(phone[3].gridPos).toEqual(panels[3].gridPos);
  });

  it('hides on phones and back', () => {
    const hidden = setHiddenOnPhones(panels, 0, true);
    expect(hidden[0].mobile).toEqual({ hidden: true });
    expect(setHiddenOnPhones(hidden, 0, false)[0].mobile).toBeUndefined();
  });

  it('inserts, duplicates and removes', () => {
    const { panels: added, index } = insertPanel(panels, { type: 'text', title: 'New', gridPos: { x: 0, y: 0, w: 24, h: 3 } }, 1);
    expect(index).toBe(6);
    expect(added[6].id).toBe(11);
    expect(ids(added)).toEqual([1, 2, 11, 10, 3, 4, 5]);
    const dup = duplicatePanel(panels, 4);
    expect(ids(dup.panels)).toEqual([1, 2, 10, 3, 4, 11, 5]);
    expect(ids(removePanel(panels, 1))).toEqual([1, 10, 3, 4, 5]);
  });

  it('expands a collapsed row', () => {
    const collapsed = [p(1, 0, 0, 24), row(10, 4, { collapsed: true, panels: [p(3, 0, 5, 12), p(4, 12, 5, 12)] }), row(11, 5)];
    const out = expandRow(collapsed, 1);
    expect(out[1]).toMatchObject({ collapsed: false, panels: [] });
    expect(ids(out)).toEqual([1, 10, 3, 4, 11]);
    expect(out[2].gridPos).toEqual({ x: 0, y: 9, w: 24, h: 1 }); // row 11 moves down to make room
  });

  it('collapses a row and expands it back', () => {
    const open = [p(1, 0, 0, 24), row(10, 4), p(3, 0, 5, 12), p(4, 12, 5, 12, 6), row(11, 11), p(5, 0, 12, 24)];
    const { panels: closed, removed } = collapseRow(open, 1);
    expect(removed).toEqual([2, 3]);
    expect(closed[1]).toMatchObject({ collapsed: true, panels: [open[2], open[3]] });
    expect(ids(closed)).toEqual([1, 10, 11, 5]);
    expect(closed.map((x) => x.gridPos.y)).toEqual([0, 4, 5, 6]); // what was below floats up
    const reopened = expandRow(closed, 1);
    expect(Object.fromEntries(reopened.map((x) => [x.id, x.gridPos]))).toEqual(Object.fromEntries(open.map((x) => [x.id, x.gridPos])));
  });

  it('turns ops into edits that reproduce them on the text', () => {
    const text = JSON.stringify({ title: 'T', panels }, null, 2);
    const moved = movePanel(panels, 0, 5);
    expect(JSON.parse(applyJsonEdits(text, panelEdits(panels, moved))).panels).toEqual(moved);
    const removed = removePanel(panels, 2);
    expect(JSON.parse(applyJsonEdits(text, panelEdits(panels, removed, 2))).panels).toEqual(removed);
    const added = insertPanel(panels, { type: 'text', gridPos: { x: 0, y: 0, w: 6, h: 2 } }, null).panels;
    expect(JSON.parse(applyJsonEdits(text, panelEdits(panels, added))).panels).toEqual(added);
    const collapsed = collapseRow(panels, 2);
    expect(JSON.parse(applyJsonEdits(text, panelEdits(panels, collapsed.panels, collapsed.removed))).panels).toEqual(collapsed.panels);
  });
});

describe('canvas', () => {
  const panels = [p(1, 0, 0, 12), p(2, 12, 0, 12, 6), row(10, 6), p(3, 0, 7, 6, 3), p(4, 6, 7, 6, 3, { mobile: { hidden: true } })];
  const order = readingOrder(panels);

  it('lays out in pixels like the app, per mode', () => {
    // 24 columns of 40px including the 8px gap.
    const grid = layoutCanvas(panels, order, 'grid', 952);
    // On the grid each unit of height is 38px (a 30px cell and the gap under it); a row is one unit.
    expect(grid.items.map((c) => [c.index, c.x, c.y, c.width, c.height])).toEqual([
      [0, 0, 0, 472, 144],
      [1, 480, 0, 472, 220],
      [2, 0, 228, 952, 30],
      [3, 0, 266, 232, 106],
      [4, 240, 266, 232, 106],
    ]);
    expect(grid.height).toBe(372);
    const phone = layoutCanvas(panels, order, 'phone', 952);
    expect(phone.hidden).toEqual([4]);
    // w <= 6 goes two-up on phones; alone on its line, it stretches to full width.
    expect(phone.items.find((c) => c.index === 3)).toMatchObject({ span: 24, width: 952 });
  });

  it('previews a resize', () => {
    const c = layoutCanvas(panels, order, 'grid', 952, { index: 0, span: 24, h: 2 });
    expect(c.items[0]).toMatchObject({ width: 952, height: 68 });
    expect(c.items[1].y).toBe(76); // pushed to the next line
  });

  it('previews a panel being dragged on the grid, with the others making way', () => {
    const c = layoutCanvas(panels, order, 'grid', 952, { index: 3, x: 12, y: 0 });
    expect(c.items.find((i) => i.index === 3)).toMatchObject({ x: 480, y: 0 });
    expect(c.items.find((i) => i.index === 1)).toMatchObject({ y: gridOffsetPx(3) }); // pushed under it
  });

  it('snaps a pixel position to a grid cell', () => {
    expect(snapToGrid(952, 0, 0, 12)).toEqual({ x: 0, y: 0 });
    expect(snapToGrid(952, 479, 80, 12)).toEqual({ x: 12, y: 2 });
    expect(snapToGrid(952, 900, -50, 12)).toEqual({ x: 12, y: 0 });
  });

  it('finds where a dragged panel would land', () => {
    const c = layoutCanvas(panels, order, 'grid', 952);
    expect(dropTarget(c, 100, 50, 3)).toBe(0); // left half of 1
    expect(dropTarget(c, 400, 50, 3)).toBe(1); // right half of 1 → before 2
    expect(dropTarget(c, 900, 100, 3)).toBe(2); // right half of 2 → before the row
    expect(dropTarget(c, 500, 238, 0)).toBe(2); // top half of the row
    expect(dropTarget(c, 900, 500, 0)).toBe(null); // past the end
  });
});
