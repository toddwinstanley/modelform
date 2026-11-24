---
'@modelform/react-native': minor
---

Fill the whole form by voice

InputForm gets a microphone beside Save when it has a speech recognizer. Say several values in one go, tap again to
stop, and the form fills what it understood: filled inputs are outlined and marked "From voice", nothing is recorded
until Save, and Undo restores the form as it was before the fill.

- `filler` prop: a `FormFiller` (`(form, said) => Promise<FillResult>`). Defaults to `ruleFiller` (no model); `null` turns it off.
- `modelFiller(generate, fallback?)` wraps a model in the filler interface through `fillPrompt`, `fillSchema` and `readFill`.
- `fillForm`, `fillSchema`, `fillPrompt`, `parseFillAnswer`, `readFill`, `ruleFill` and `fillHints` are exported.
- `DictationOptions.continuous`: keep listening through pauses and deliver one final transcript when stopped. The web recognizer supports it; adapters should pass it on.
