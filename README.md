# modelform

Render Grafana-compatible dashboard JSON as native React Native panels, and build input forms in the
same format. One JSON model describes both what an app records and how it charts it.

- **Dashboards:** `timeseries`, `barchart`, `stat`, `gauge`, `bargauge`, `piechart`, `table`, `text`, `xychart`,
  `trend`, `geomap` and rows, with field config, overrides, value mappings, thresholds, transformations,
  template variables and repeats. Layouts reflow into a single column on phones.
- **Forms:** a form is a dashboard whose panels are `input-*` types (number, slider, select, toggle, rating, text,
  counter, duration). Entries go to an `EntryStore` you provide, and dashboards chart them through the local
  datasource. A document can say what it is with `"kind": "form"` or `"kind": "dashboard"`; without it, one with
  inputs counts as a form.
- **Datasources:** a local one over recorded entries, and a Grafana one that runs panel queries through a Grafana
  instance's HTTP API. You can also implement your own.
- **Configs:** a manifest format for whole apps (tabs, forms and dashboards), with JSON Schemas, validation that
  reports issues instead of throwing, and a loader with caching and last-good fallback. A manifest's `version` is the
  oldest format that can show it; an app older than that gets `needsUpdate` and keeps its last good config.
- **AI assistants:** `templatePrompt()` writes a prompt for making a template with any assistant (Claude, ChatGPT…),
  and `readTemplateAnswer()` reads the template back out of its reply. `documentPrompt()` and `readDocumentAnswer()` do
  the same for changing one form or dashboard, and `documentChanges()` lists what a change does. Nothing calls a model.

modelform is not affiliated with or endorsed by Grafana Labs. It reads the dashboard JSON model that Grafana
exports, and ignores keys it doesn't understand.

## Install

```sh
npm install @modelform/react-native react-native-svg react-native-safe-area-context
```

`react` and `react-native` are peer dependencies too. It works in Expo apps, including Expo Go.

## Render a dashboard

```tsx
import { DashboardProvider, DashboardToolbar, DashboardView, LocalDataSource, MemoryEntryStore } from '@modelform/react-native';
import dashboard from './dashboards/weight.json';

const store = new MemoryEntryStore();
const local = new LocalDataSource(store);

export function Weight() {
  return (
    <DashboardProvider dashboard={dashboard} resolve={() => local}>
      <DashboardView header={<DashboardToolbar />} />
    </DashboardProvider>
  );
}
```

`resolve` maps each panel's `datasource` to a `DataSource`. Panels read recorded entries with
`"datasource": { "type": "modelform-local" }` and targets such as:

```json
{ "refId": "A", "metric": "weight" }
{ "refId": "A", "metric": "water", "aggregate": "sum", "bucket": "1d" }
{ "refId": "A", "metric": "sets-weight", "aggregate": "max", "bucket": "1w", "groupBy": { "field": "sets-exercise" } }
{ "refId": "A", "metric": "meal-calories", "aggregate": "sum", "bucket": "save" }
```

`groupBy: { "field": metric }` makes one series per value of another input saved alongside (in an `input-group`,
the same item's), and `bucket: "save"` one point per Save.

To chart a Grafana instance instead, use `new GrafanaDataSource(new GrafanaClient({ url, token }))` with a
service-account token. Grafana runs the queries, so any of its datasources works.

## Record with a form

```tsx
import { InputForm } from '@modelform/react-native';
import form from './forms/daily.json';

<InputForm dashboard={form} store={store} onSaved={(count) => console.log(`saved ${count}`)} />;
```

```json
{
  "title": "Daily",
  "panels": [
    {
      "type": "input-number",
      "title": "Weight",
      "gridPos": { "x": 0, "y": 0, "w": 12, "h": 3 },
      "options": { "metric": "weight", "unit": "kg", "step": 0.1, "default": "last" }
    }
  ]
}
```

Fields that repeat once per item, like the sets of a workout, go in an `input-group`. Each field records under its own
metric, and entries of one item share `save` and `item`:

```json
{
  "type": "input-group",
  "title": "Sets",
  "gridPos": { "x": 0, "y": 3, "w": 24, "h": 12 },
  "options": {
    "itemTitle": "Set", "titleFrom": "sets-exercise", "start": "last",
    "fields": [
      { "type": "input-text", "title": "Exercise", "options": { "metric": "sets-exercise", "suggest": true, "required": true } },
      { "type": "input-number", "title": "Weight", "span": 12, "options": { "metric": "sets-weight", "unit": "kg", "step": 2.5 } },
      { "type": "input-number", "title": "Reps", "span": 12, "options": { "metric": "sets-reps" } }
    ]
  }
}
```

For anything beyond a demo, implement `EntryStore` over your own storage, such as SQLite. Keep each entry's `save` and
`item` so groups can be read back.

### Dictation

Number, duration, text and choice inputs show a microphone button when the form has a speech recognizer. What's said
becomes the value ("seventy two point five" → 72.5, "went for a swim" picks Swim), and dictated text is added after a
multi-line field's text. On the web, the browser's speech recognition is used where there is one (Chrome, Edge,
Safari; not Firefox). On phones, pass a `SpeechRecognizer`, for example over
[expo-speech-recognition](https://github.com/jamsch/expo-speech-recognition):

```tsx
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import type { SpeechRecognizer } from '@modelform/react-native';

const speech: SpeechRecognizer = {
  start(o) {
    const subs: { remove(): void }[] = [];
    const end = () => {
      subs.forEach((s) => s.remove());
      o.onEnd();
    };
    ExpoSpeechRecognitionModule.requestPermissionsAsync().then(({ granted }) => {
      if (!granted) return o.onError('Microphone access is off'), end();
      subs.push(
        ExpoSpeechRecognitionModule.addListener('result', (e) => o.onText(e.results[0]?.transcript ?? '', e.isFinal)),
        ExpoSpeechRecognitionModule.addListener('error', (e) => e.error !== 'aborted' && o.onError(e.message)),
        ExpoSpeechRecognitionModule.addListener('end', end),
      );
      ExpoSpeechRecognitionModule.start({ lang: o.lang ?? 'en-US', interimResults: true, contextualStrings: o.hints });
    });
    return { stop: () => ExpoSpeechRecognitionModule.stop(), abort: () => ExpoSpeechRecognitionModule.abort() };
  },
};

<InputForm dashboard={form} store={store} speech={speech} />;
```

`speech={null}` turns dictation off. `spokenValue(panel, text)` and the parsers behind it are exported for filling
forms by other means. The native recognizer is shared, so a real adapter should also wait for the previous session's
`end` before starting the next one; otherwise that late event ends the new session too.

## Bundled dashboards

`modelform dashboards [dir] [--watch]` writes an `index.ts` that imports every `.json` file in a folder, so
the app can bundle them by name. From `metro.config.js`, `require('@modelform/react-native/dashboards').watchDashboards(dir)`
keeps that file current while Metro runs.

## Validation and schemas

`@modelform/react-native/core` holds everything that doesn't render: the types, validation, layout, transformations, the
datasources and the config loader. It runs in Node too, for example to check configs on a server.

`@modelform/react-native/schema/app.schema.json` (app manifests) and `@modelform/react-native/schema/dashboard.schema.json` (dashboards
and forms) give editors completion and inline checks.

## Releases

From 0.1.1 on, versions are built and staged on npm by this repo's GitHub Actions release workflow, through trusted publishing, so each
one carries npm provenance linking it to the commit it was built from. A maintainer approves each staged version,
with 2FA, before it goes live. Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

MIT
