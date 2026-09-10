/** The SDK's IIFE build exposes window.Repro; the benchmarks only need these three methods. */
declare global {
  interface Window {
    Repro?: { getSessionId(): string | null; flush(): Promise<void>; stop(): void };
    __longTasks?: number;
  }
}
export {};
