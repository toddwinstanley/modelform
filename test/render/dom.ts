/**
 * Enough of a browser layout for react-native-web in jsdom, which has none: an element is as
 * big as its inline style says, or else as its parent, and a stand-in ResizeObserver reports
 * that, so onLayout fires and charts get a size to draw at.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export const VIEWPORT = { width: 1024, height: 768 };

function size(el: HTMLElement | null, dim: 'width' | 'height'): number {
  for (let node = el; node; node = node.parentElement) {
    const px = parseFloat(node.style?.[dim] ?? '');
    if (Number.isFinite(px)) return px;
  }
  return VIEWPORT[dim];
}

Object.defineProperties(HTMLElement.prototype, {
  offsetWidth: { configurable: true, get(this: HTMLElement) { return size(this, 'width'); } },
  offsetHeight: { configurable: true, get(this: HTMLElement) { return size(this, 'height'); } },
});
Object.defineProperties(document.documentElement, {
  clientWidth: { configurable: true, get: () => VIEWPORT.width },
  clientHeight: { configurable: true, get: () => VIEWPORT.height },
});

class FakeResizeObserver {
  constructor(private callback: ResizeObserverCallback) {}
  observe(target: Element) {
    queueMicrotask(() => this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver));
  }
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
