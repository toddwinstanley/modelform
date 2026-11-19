---
'@modelform/react-native': minor
---

Dictation. Number, duration, text and choice inputs get a microphone button that fills them from what's said: "seventy two point five" → 72.5, "one twenty-five" → 125, "one minute thirty two" → 92 seconds, "went for a swim" picks Swim, and dictated text is added after a multi-line field's text. Only one input listens at a time, what's heard shows under the input, and a phrase that doesn't fit ("Heard “banana”, not a number") leaves the value alone. `InputForm` takes `speech` (a `SpeechRecognizer`) and `speechLang`; on the web it uses the browser's speech recognition where there is one, elsewhere there's no microphone until the app passes a recognizer, and `speech={null}` turns it off. The parsing is exported for other fillers: `spokenValue`, `parseSpokenNumber`, `parseSpokenDuration`, `matchChoices`, `parseSpokenYesNo`.
