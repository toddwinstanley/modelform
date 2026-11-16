---
'@modelform/react-native': minor
---

Input groups: fields a form repeats once per item, such as the entree and sides of a meal or the sets of a workout.

- New panel type `input-group`. Its `options.fields` are input panels without `id` or `gridPos`, each with an optional `span` (out of 24). Other options: `itemTitle`, `titleFrom`, `min`, `max`, `start` (a number of empty items, or `"last"` to start from the last save's items) and `addLabel`.
- Each item shows as a card that can be duplicated, moved and removed. Items left completely empty aren't recorded. Problems name the item: "Set 3: Reps is required".
- Every field records under its own metric, so existing local queries chart group data as they are.
- `Entry` gains `save` (the id of the Save that recorded it, now set on every entry an `InputForm` records) and `item` (the position of the group item it belongs to). Both are optional, so existing stores keep working; a store has to keep them for groups to be read back.
- `entriesSavedWith` matches by `save` where entries have one, and falls back to the timestamp for older entries.
- Helpers: `isInputGroup`, `inputGroups`, `plainInputPanels`, `groupFields`, `groupToEntries`, `entriesToItems`, `groupProblems`, `isEmptyItem`, `sameSave`, `newSaveId`. `inputPanels` now includes groups' fields.
- Validation warns about a group with no fields, a counter in a group, a field metric another input also records, and a `titleFrom` that isn't one of the group's fields.
