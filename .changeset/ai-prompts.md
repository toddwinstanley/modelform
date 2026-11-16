---
'@modelform/react-native': minor
---

Prompts for making templates with an AI assistant the user already has. `templatePrompt(request, { recorded, icons })` writes a prompt with an authoring guide (`AUTHORING_GUIDE`) and a complete example (`EXAMPLE_TEMPLATE`); `readTemplateAnswer(text)` pulls the template out of the reply (code blocks or bare JSON), validates it with `parseTemplate`, and lists warnings for anything dropped or inconsistent; `fixTemplatePrompt(problems)` asks the assistant to fix them. Nothing calls a model.
