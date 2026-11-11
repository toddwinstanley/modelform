import { Component, type ReactNode } from 'react';

interface Props {
  /** Shown in place of the children after they throw while rendering. */
  fallback(error: Error): ReactNode;
  /** When any of these change (by identity), the children get another try, e.g. after the config is edited. */
  resetKeys: readonly unknown[];
  children: ReactNode;
}

interface State {
  error: Error | null;
  keys: readonly unknown[];
}

const changed = (a: readonly unknown[], b: readonly unknown[]) => a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));

/**
 * Keeps a render error in one part of the screen (a panel, a dashboard) from taking down the
 * rest. Configs come from users at runtime, so anything the validator lets through has to
 * fail here rather than crash the app.
 */
export class RenderBoundary extends Component<Props, State> {
  state: State = { error: null, keys: this.props.resetKeys };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return changed(props.resetKeys, state.keys) ? { error: null, keys: props.resetKeys } : null;
  }

  componentDidCatch(error: Error) {
    console.warn('[modelform] render failed:', error.message);
  }

  render() {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}
