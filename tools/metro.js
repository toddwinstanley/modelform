// Metro settings every app that bundles modelform needs.
// Plain CommonJS so metro.config.js can load it without a build step.
const path = require('node:path');

// jsonc-parser's `main` is a UMD build that calls `require` through a factory parameter,
// which Metro's dependency collector can't see: its ./impl/* modules are left out of the
// bundle and the app dies on load with `Requiring unknown module "./impl/format"`. Its ESM
// build uses plain imports, so point Metro there.
const JSONC_PARSER_ESM = path.join(path.dirname(require.resolve('jsonc-parser/package.json')), 'lib/esm/main.js');

/** Adjusts an Expo Metro config so modelform's dependencies bundle correctly. */
function withModelform(config) {
  const resolveRequest = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName === 'jsonc-parser') return { type: 'sourceFile', filePath: JSONC_PARSER_ESM };
    return (resolveRequest ?? context.resolveRequest)(context, moduleName, platform);
  };
  return config;
}

module.exports = { withModelform };
