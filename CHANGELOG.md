# @modelform/react-native

## 0.5.0

### Minor Changes

- 8efde64: Templates: ready-made forms and dashboards, with the tabs that show them.

  - `AppTemplate` (`$modelform: "template"`) holds any number of forms and dashboards, optional tabs, and the metrics they record or read.
  - `makeTemplate(manifest, documents, ids, { title, description })` builds one from a config's documents, with the tabs that show only those documents.
  - `parseTemplate(text)` reads one or says why it can't. Documents must render; tabs pointing outside the template are dropped; metrics are worked out again.
  - `templateNeeds(template, recorded, chosen?, metrics?)` lists metrics worth asking to map, and the template's forms whose data the config already records.
  - `applyTemplate(manifestText, paths, template, { documents, metrics, tabs })` returns new files and the manifest's new text. Clashing ids and paths are renamed (`workout-2`), metrics are mapped, and the tabs asked for point at the new ids. The manifest's formatting is kept.
  - `renameMetrics` and `panelMetrics` are exported.

## 0.4.0

### Minor Changes

- e2702a9: Panel snippets, for copying panels between dashboards and, later, templates:

  - `copyPanels(dashboard, indices)` lifts panels out as a snippet: no ids, positions relative to the copied block, the variables they use (and the ones those use), and the metrics they record or read. A row brings its panels.
  - `parseSnippet(text)` reads a snippet, a Grafana panel, an array of panels or a whole dashboard, or says why it can't.
  - `pasteSnippet(dashboard, snippet, options)` drops one in. It gives every panel a fresh id, places the block under a panel or at the bottom (panels below move down), adds missing variables, renames clashing ones (`host_2`) along with the panels that use them, applies a metric mapping, and leaves inputs out of dashboards, reporting them. `previewPaste` says what a paste would add or rename.
  - `settleLayout` accepts several fixed panels.

## 0.3.0

### Minor Changes

- 1cd75f4: Show Grafana's grid on wide screens, and edit it freely:

  - In grid mode, `DashboardView` puts panels where their `gridPos` says, floated up the way Grafana does, instead of packing them into lines. A tall panel can now sit beside two stacked ones. Phones still reflow into lines. Each `LayoutSection` gains a `grid` with every panel's x/y/w/h. `rows` is unchanged.
  - New `compactGrid` (Grafana's vertical compaction) and `gridOffsetPx`.
  - Layout editing works on the grid: new `placePanel`, `settleLayout`, `snapToGrid` and `collapseRow`. `resizePanel`, `insertPanel`, `duplicatePanel`, `removePanel` and `expandRow` keep free placement, and panels in the way move down. `movePanel` (phone reordering) takes the target's place on the grid. `layoutCanvas` lays out the grid like the app does, and can preview a panel being dragged (`SizeOverride` gains `x`/`y`). `panelEdits` accepts several removed indices.
  - `repack` is deprecated: packing into lines throws placement away.

## 0.2.0

### Minor Changes

- 880ad80: Make `ConfigLoader` more robust:

  - `dispose()` cancels a fetch in flight and stops later state and cache writes, so a replaced loader can't overwrite the cache.
  - Fetches time out (`timeoutMs`, 15 seconds by default) instead of leaving the loader stuck in `loading`.
  - A cached copy is checked again on `start()` and ignored if it no longer loads (new `revalidateBundle`).
  - `ConfigState.unreachable` tells a server that couldn't be reached apart from a config with errors; `error` then says why ("HTTP 503", "no answer in 15s").
  - A repeated failure no longer notifies listeners when nothing changed.
  - `defaultFetchJson` and `fetchJsonWithToken` send `If-None-Match` with the last ETag and answer a 304 from memory (new `httpFetchJson`). `FetchJson` takes an optional `signal`.

## 0.1.1

### Patch Changes

- 677cc9b: The README describes how releases are published, with npm provenance.
