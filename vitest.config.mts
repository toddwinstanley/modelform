import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);
/** A package's ES module build, which Vite can transform (its CommonJS build would load react-native itself). */
const esm = (name: string) => path.join(path.dirname(require.resolve(`${name}/package.json`)), 'lib/module/index.js');

export default defineConfig({
  // Render tests (*.render.test.tsx) draw the React Native UI with react-native-web in jsdom.
  resolve: {
    alias: [
      { find: /^react-native$/, replacement: 'react-native-web' },
      { find: /^react-native-svg$/, replacement: esm('react-native-svg') },
      { find: /^react-native-safe-area-context$/, replacement: esm('react-native-safe-area-context') },
      { find: /^@react-native\/assets-registry\/registry$/, replacement: path.resolve('test/stubs/assets-registry.ts') },
    ],
    extensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.mjs', '.js', '.json'],
  },
  define: { __DEV__: 'true' },
  test: {
    server: { deps: { inline: [/react-native-svg/, /react-native-safe-area-context/] } },
  },
});
