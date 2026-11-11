// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const globals = require('globals');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/**'],
  },
  {
    // tsc already resolves imports; the import plugin can't follow package exports to .ts sources.
    files: ['**/*.ts', '**/*.tsx'],
    rules: { 'import/no-unresolved': 'off' },
  },
  {
    // Node-only: the bin, the Metro helper and the schema generator.
    files: ['tools/**'],
    languageOptions: { globals: globals.node },
  },
]);
