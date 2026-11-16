---
'@modelform/react-native': minor
---

Documents can state their kind: an optional top-level `"kind": "form" | "dashboard"` (Grafana ignores it). `documentKind()` reads it, falling back to the old guess (a document with inputs is a form). `newDocument` and `applyTemplate` write it, `makeTemplate` uses it, `parseTemplate` refuses a document whose `kind` contradicts its listing, and `validateBundle` warns when a screen shows a document as the other kind.
