# @modelform/react-native

## 0.2.0

### Minor Changes

- 880ad80: Make `ConfigLoader` more robust:

  - `dispose()` cancels a fetch in flight and stops later state and cache writes, so a replaced loader can't overwrite the cache.
  - Fetches time out (`timeoutMs`, 15 seconds by default) instead of leaving the loader stuck in `loading`.
  - A cached copy is checked again on `start()` and ignored if it no longer loads (new `revalidateBundle`).
  - `ConfigState.unreachable` tells a server that couldn't be reached apart from a config with errors; `error` then says why ("HTTP 503", "no answer in 15s").
  - A repeated failure no longer notifies listeners when nothing changed.
  - `defaultFetchJson` and `fetchJsonWithToken` send `If-None-Match` with the last ETag and answer a 304 from memory (new `httpFetchJson`). `FetchJson` takes an optional `signal`.

## 0.1.1

### Patch Changes

- 677cc9b: The README describes how releases are published, with npm provenance.
