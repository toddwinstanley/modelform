# modelform

Render Grafana-compatible dashboard JSON as native React Native panels, and build input forms in the
same format. One JSON model describes both what an app records and how it charts it.

- **Dashboards:** `timeseries`, `barchart`, `stat`, `gauge`, `bargauge`, `piechart`, `table`, `text`, `xychart`,
  `trend`, `geomap` and rows, with field config, overrides, value mappings, thresholds, transformations,
  template variables and repeats. Layouts reflow into a single column on phones.
- **Forms:** a form is a dashboard whose panels are `input-*` types (number, slider, select, toggle, rating, text,
  counter, duration). Entries go to an `EntryStore` you provide, and dashboards chart them through the local
  datasource.
- **Datasources:** a local one over recorded entries, and a Grafana one that runs panel queries through a Grafana
  instance's HTTP API. You can also implement your own.
- **Configs:** a manifest format for whole apps (tabs, forms and dashboards), with JSON Schemas, validation that
  reports issues instead of throwing, and a loader with caching and last-good fallback.

modelform is not affiliated with or endorsed by Grafana Labs. It reads the dashboard JSON model that Grafana
exports, and ignores keys it doesn't understand.

## Install

```sh
npm install modelform react-native-svg react-native-safe-area-context
```

`react` and `react-native` are peer dependencies too. It works in Expo apps, including Expo Go.

## Render a dashboard

```tsx
import { DashboardProvider, DashboardToolbar, DashboardView, LocalDataSource, MemoryEntryStore } from 'modelform';
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
```

To chart a Grafana instance instead, use `new GrafanaDataSource(new GrafanaClient({ url, token }))` with a
service-account token. Grafana runs the queries, so any of its datasources works.

## Record with a form

```tsx
import { InputForm } from 'modelform';
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

For anything beyond a demo, implement `EntryStore` over your own storage, such as SQLite.

## Bundled dashboards

`modelform dashboards [dir] [--watch]` writes an `index.ts` that imports every `.json` file in a folder, so
the app can bundle them by name. From `metro.config.js`, `require('modelform/dashboards').watchDashboards(dir)`
keeps that file current while Metro runs.

## Validation and schemas

`modelform/core` holds everything that doesn't render: the types, validation, layout, transformations, the
datasources and the config loader. It runs in Node too, for example to check configs on a server.

`modelform/schema/app.schema.json` (app manifests) and `modelform/schema/dashboard.schema.json` (dashboards
and forms) give editors completion and inline checks.

## License

MIT
