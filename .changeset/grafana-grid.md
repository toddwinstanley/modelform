---
'@modelform/react-native': minor
---

Show Grafana's grid on wide screens, and edit it freely:

- In grid mode, `DashboardView` puts panels where their `gridPos` says, floated up the way Grafana does, instead of packing them into lines. A tall panel can now sit beside two stacked ones. Phones still reflow into lines. Each `LayoutSection` gains a `grid` with every panel's x/y/w/h. `rows` is unchanged.
- New `compactGrid` (Grafana's vertical compaction) and `gridOffsetPx`.
- Layout editing works on the grid: new `placePanel`, `settleLayout`, `snapToGrid` and `collapseRow`. `resizePanel`, `insertPanel`, `duplicatePanel`, `removePanel` and `expandRow` keep free placement, and panels in the way move down. `movePanel` (phone reordering) takes the target's place on the grid. `layoutCanvas` lays out the grid like the app does, and can preview a panel being dragged (`SizeOverride` gains `x`/`y`). `panelEdits` accepts several removed indices.
- `repack` is deprecated: packing into lines throws placement away.
