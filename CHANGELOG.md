# @modelform/react-native

## 0.10.0

### Minor Changes

- 4ebf3dd: Prompts for making templates with an AI assistant the user already has. `templatePrompt(request, { recorded, icons })` writes a prompt with an authoring guide (`AUTHORING_GUIDE`) and a complete example (`EXAMPLE_TEMPLATE`); `readTemplateAnswer(text)` pulls the template out of the reply (code blocks or bare JSON), validates it with `parseTemplate`, and lists warnings for anything dropped or inconsistent; `fixTemplatePrompt(problems)` asks the assistant to fix them. Nothing calls a model.

## 0.9.0

### Minor Changes

- fbcb1f9: Documents can state their kind: an optional top-level `"kind": "form" | "dashboard"` (Grafana ignores it). `documentKind()` reads it, falling back to the old guess (a document with inputs is a form). `newDocument` and `applyTemplate` write it, `makeTemplate` uses it, `parseTemplate` refuses a document whose `kind` contradicts its listing, and `validateBundle` warns when a screen shows a document as the other kind.

## 0.8.0

### Minor Changes

- 9e92863: Local queries for input-group data.

  - `groupBy: { field: metric }` makes one series per value of another input recorded in the same Save and, inside an input-group, the same item: the top weight of each exercise. Entries recorded before saves had ids are matched by time. Series carry the field as their label, and `LocalDataSourceOptions.label` is asked with the field's metric.
  - `bucket: "save"` makes one point per Save, at its time: the calories of each meal rather than of each day.
  - `sampleEntries` records a group's fields together (a few items a day sharing `save` and `item`), so previews of these queries have something to show.
  - `groupField(target)` is exported.

## 0.7.0

### Minor Changes

- e8bd7f2: Input groups: collapse items and drag them to reorder.

  - Tapping an item's title collapses it to one line with a summary of its values ("100 kg · 5"). Adding or duplicating an item collapses the other filled ones; an item with a problem stays open; a save or discard opens them all again.
  - The handle (≡) drags an item past the others. The list keeps its order until the item is dropped, so the gesture isn't interrupted on the web. The ↑/↓ buttons stay for accessibility.
  - `FormGroup` gains an optional `edited` flag.
  - Fix: a group's field problems showed as soon as any field in it was edited. Like plain inputs, they now show for edited fields, and for all fields once a Save is refused.

## 0.6.0

### Minor Changes

- 3ea82e8: Input groups: fields a form repeats once per item, such as the entree and sides of a meal or the sets of a workout.

  - New panel type `input-group`. Its `options.fields` are input panels without `id` or `gridPos`, each with an optional `span` (out of 24). Other options: `itemTitle`, `titleFrom`, `min`, `max`, `start` (a number of empty items, or `"last"` to start from the last save's items) and `addLabel`.
  - Each item shows as a card that can be duplicated, moved and removed. Items left completely empty aren't recorded. Problems name the item: "Set 3: Reps is required".
  - Every field records under its own metric, so existing local queries chart group data as they are.
  - `Entry` gains `save` (the id of the Save that recorded it, now set on every entry an `InputForm` records) and `item` (the position of the group item it belongs to). Both are optional, so existing stores keep working; a store has to keep them for groups to be read back.
  - `entriesSavedWith` matches by `save` where entries have one, and falls back to the timestamp for older entries.
  - Helpers: `isInputGroup`, `inputGroups`, `plainInputPanels`, `groupFields`, `groupToEntries`, `entriesToItems`, `groupProblems`, `isEmptyItem`, `sameSave`, `newSaveId`. `inputPanels` now includes groups' fields.
  - Validation warns about a group with no fields, a counter in a group, a field metric another input also records, and a `titleFrom` that isn't one of the group's fields.

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
