import { defineConfig } from 'tsup';

// JavaScript only; tsc writes the declarations (see tsconfig.build.json).
export default defineConfig({
  entry: { index: 'src/index.ts', 'core/index': 'src/core/index.ts' },
  format: ['esm', 'cjs'],
  // One copy of shared modules for both entry points, so `@modelform/react-native` and `@modelform/react-native/core` hand out the same classes.
  splitting: true,
  clean: true,
  target: 'es2022',
  // jsonc-parser's `main` is a UMD build that Metro can't follow (see tools/metro.js). Bundling its ESM build
  // means apps that install modelform from npm need no Metro setup for it. It stays a dependency for its types,
  // which the declarations reference.
  noExternal: ['jsonc-parser'],
  esbuildOptions(options) {
    options.mainFields = ['module', 'main'];
  },
});
