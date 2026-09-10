/**
 * Navigation capture: the initial load plus SPA route changes. History methods are wrapped
 * (and restored on stop) because the browser fires no event for pushState/replaceState.
 */
import { sanitizeUrl, truncate, LIMITS, type NavigationKind } from '@repro/contracts';
import type { CaptureContext, Stop } from '../types.js';

export function currentUrl(): string {
  return truncate(sanitizeUrl(location.href), LIMITS.maxUrlLength);
}

export function startNavigation(ctx: CaptureContext): Stop {
  const emitNavigation = (kind: NavigationKind) => {
    try {
      const data: { url: string; kind: NavigationKind; title?: string } = { url: currentUrl(), kind };
      if (document.title) data.title = truncate(document.title, 200);
      ctx.emit({ type: 'navigation', data });
    } catch (err) {
      ctx.debug('navigation capture failed', err);
    }
  };

  emitNavigation('load');

  const history = window.history;
  const originalPush = history.pushState;
  const originalReplace = history.replaceState;
  history.pushState = function pushState(this: History, ...args: Parameters<History['pushState']>) {
    const result = originalPush.apply(this, args);
    emitNavigation('push');
    return result;
  };
  history.replaceState = function replaceState(this: History, ...args: Parameters<History['replaceState']>) {
    const result = originalReplace.apply(this, args);
    emitNavigation('replace');
    return result;
  };
  const onPop = () => emitNavigation('pop');
  const onHash = () => emitNavigation('hash');
  window.addEventListener('popstate', onPop);
  window.addEventListener('hashchange', onHash);

  return () => {
    // Only restore if nobody else re-wrapped history after us.
    if (history.pushState.name === 'pushState') history.pushState = originalPush;
    if (history.replaceState.name === 'replaceState') history.replaceState = originalReplace;
    window.removeEventListener('popstate', onPop);
    window.removeEventListener('hashchange', onHash);
  };
}
