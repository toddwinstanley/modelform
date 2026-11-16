---
'@modelform/react-native': minor
---

Changing one form or dashboard with an AI assistant. `documentPrompt(request, document, { recorded })` asks for the whole changed document back, with the document guide (`DOCUMENT_GUIDE`, now also part of `AUTHORING_GUIDE`); `readDocumentAnswer(text, kind)` reads it (a bare document or a one-document template), refuses the wrong kind, and lists warnings; `fixDocumentPrompt(problems, kind)` asks for fixes; `documentChanges(before, after)` lists the panels added, removed and changed (by id, inside rows too) and the document settings that changed.
