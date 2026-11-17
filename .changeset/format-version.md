---
'@modelform/react-native': minor
---

Config format versions. A manifest's `version` is now the oldest format that can show it (a whole number from 1; the schema no longer pins it to 1), and `MANIFEST_VERSION` is the newest this build shows. A newer config gets one error (`code: 'newer-version'`, "Update the app to open it") instead of whatever else a newer format might trip, and `ConfigLoader` sets `needsUpdate` while keeping the last good config. `requiredManifestVersion(bundle)` gives the version a config should declare (1 until a format change it uses), for editors to set when saving.
