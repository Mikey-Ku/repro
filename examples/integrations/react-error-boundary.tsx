// React: initialise once at module scope, report render errors from an error boundary,
// and annotate user-meaningful steps so they show up in the timeline.
import { Component, type ReactNode } from 'react';
import { Repro } from '@repro/browser-sdk';

export const repro = Repro.init({
  projectKey: import.meta.env.VITE_REPRO_KEY as string,
  endpoint: import.meta.env.VITE_REPRO_ENDPOINT as string,
  release: import.meta.env.VITE_APP_VERSION as string,
});

interface Props {
  children: ReactNode;
  fallback: ReactNode;
}

interface State {
  failed: boolean;
}

/** Render errors are caught by React and never reach window.onerror, so report them here. */
export class ReproErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: { componentStack?: string | null }): void {
    repro.captureException(error, {
      boundary: 'app',
      componentStack: (info.componentStack ?? '').slice(0, 500),
    });
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// Somewhere in a form submit handler:
export function onCheckoutSubmitted(itemCount: number): void {
  repro.annotate('checkout:submitted', { items: itemCount });
}

// After sign-in, with an opaque id (never an email address):
export function onSignedIn(userId: string, plan: string): void {
  repro.identify(userId, { plan });
}
