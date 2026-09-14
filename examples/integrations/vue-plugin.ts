// Vue 3: a plugin that starts recording and forwards errors Vue catches itself.
import type { App } from 'vue';
import { Repro, type ReproOptions } from '@repro/browser-sdk';

export function createReproPlugin(options: ReproOptions) {
  return {
    install(app: App): void {
      const client = Repro.init(options);
      const previous = app.config.errorHandler;
      app.config.errorHandler = (error, instance, info) => {
        client.captureException(error, { vueInfo: String(info) });
        if (previous) previous(error, instance, info);
      };
      app.provide('repro', client);
    },
  };
}

// main.ts
// createApp(App)
//   .use(createReproPlugin({ projectKey: import.meta.env.VITE_REPRO_KEY, endpoint: 'https://repro.internal' }))
//   .mount('#app');
