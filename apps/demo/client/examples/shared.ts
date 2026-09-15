// Shared by the example bundles: the same SDK initialisation as the Northwind checkout plus a few
// DOM helpers. Each example is bundled separately by scripts/build-client.mjs, so this is inlined.

// ---- Repro SDK surface (mirrors packages/browser-sdk, loaded as an IIFE from /vendor/repro.iife.js) ----
export interface ReproOptions {
  projectKey: string;
  endpoint: string;
  release?: string;
  environment?: string;
}
export interface ReproClient {
  start(): void;
  stop(): void;
  captureException(error: unknown, context?: Record<string, string | number | boolean>): void;
  identify(userId: string, traits?: Record<string, string | number | boolean>): void;
  annotate(name: string, data?: Record<string, string | number | boolean>): void;
  flush(): Promise<void>;
  getSessionId(): string | null;
  isRecording(): boolean;
}
export interface DemoConfig {
  projectKey: string;
  endpoint: string;
  mode: 'broken' | 'fixed';
  release: string;
}
interface DemoWindow {
  Repro: { init(options: ReproOptions): ReproClient };
  __DEMO__: DemoConfig;
}

// The checkout bundle declares these on Window globally; the examples read them through a
// cast instead so that both bundles can be type-checked in one program.
const demoWindow = window as unknown as DemoWindow;

export const demo: DemoConfig = demoWindow.__DEMO__;

export const repro: ReproClient = demoWindow.Repro.init({
  projectKey: demo.projectKey,
  endpoint: demo.endpoint,
  release: demo.release,
  environment: 'demo',
});

export const JSON_HEADERS = { 'content-type': 'application/json' } as const;

export function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

export function query<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element ${selector}`);
  return element;
}

export function showAlert(element: HTMLElement, message: string): void {
  element.textContent = message;
  element.dataset.visible = 'true';
}

export function hideAlert(element: HTMLElement): void {
  element.textContent = '';
  element.dataset.visible = 'false';
}

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
