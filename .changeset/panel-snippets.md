---
'@modelform/react-native': minor
---

Panel snippets, for copying panels between dashboards and, later, templates:

- `copyPanels(dashboard, indices)` lifts panels out as a snippet: no ids, positions relative to the copied block, the variables they use (and the ones those use), and the metrics they record or read. A row brings its panels.
- `parseSnippet(text)` reads a snippet, a Grafana panel, an array of panels or a whole dashboard, or says why it can't.
- `pasteSnippet(dashboard, snippet, options)` drops one in. It gives every panel a fresh id, places the block under a panel or at the bottom (panels below move down), adds missing variables, renames clashing ones (`host_2`) along with the panels that use them, applies a metric mapping, and leaves inputs out of dashboards, reporting them. `previewPaste` says what a paste would add or rename.
- `settleLayout` accepts several fixed panels.
