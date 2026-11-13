---
'@modelform/react-native': minor
---

Templates: ready-made forms and dashboards, with the tabs that show them.

- `AppTemplate` (`$modelform: "template"`) holds any number of forms and dashboards, optional tabs, and the metrics they record or read.
- `makeTemplate(manifest, documents, ids, { title, description })` builds one from a config's documents, with the tabs that show only those documents.
- `parseTemplate(text)` reads one or says why it can't. Documents must render; tabs pointing outside the template are dropped; metrics are worked out again.
- `templateNeeds(template, recorded, chosen?, metrics?)` lists metrics worth asking to map, and the template's forms whose data the config already records.
- `applyTemplate(manifestText, paths, template, { documents, metrics, tabs })` returns new files and the manifest's new text. Clashing ids and paths are renamed (`workout-2`), metrics are mapped, and the tabs asked for point at the new ids. The manifest's formatting is kept.
- `renameMetrics` and `panelMetrics` are exported.
