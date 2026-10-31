import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { SafeAreaProvider } from 'react-native-safe-area-context';
// Also installs the layout shim, before anything renders.
import { VIEWPORT } from './dom';

const METRICS = { frame: { x: 0, y: 0, ...VIEWPORT }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

/** Lets effects, data queries and layout callbacks run. */
export async function settle(rounds = 3) {
  for (let i = 0; i < rounds; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
}

/** Renders into a detached root, lets it settle, and returns the container and a cleanup. */
export async function render(node: ReactNode) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => root.render(<SafeAreaProvider initialMetrics={METRICS}>{node}</SafeAreaProvider>));
  await settle();
  return {
    el,
    unmount: async () => {
      await act(async () => root.unmount());
      el.remove();
    },
  };
}
