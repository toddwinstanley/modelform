---
'@modelform/react-native': minor
---

Local queries for input-group data.

- `groupBy: { field: metric }` makes one series per value of another input recorded in the same Save and, inside an input-group, the same item: the top weight of each exercise. Entries recorded before saves had ids are matched by time. Series carry the field as their label, and `LocalDataSourceOptions.label` is asked with the field's metric.
- `bucket: "save"` makes one point per Save, at its time: the calories of each meal rather than of each day.
- `sampleEntries` records a group's fields together (a few items a day sharing `save` and `item`), so previews of these queries have something to show.
- `groupField(target)` is exported.
