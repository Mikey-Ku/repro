// Buffer healthy sessions in memory and upload only when something goes wrong.
// Nothing leaves the browser, and no session row is created, unless a trigger fires:
// an uncaught error, an unhandled rejection, captureException, a failed request, or flagIncident.
import { Repro } from '@repro/browser-sdk';

const repro = Repro.init({
  projectKey: 'rp_replace_with_a_key_from_settings',
  endpoint: 'https://repro.internal',
  mode: 'on-incident',
  bufferSeconds: 30,
  bufferEvents: 2000,
});

// Application-level failures that are not exceptions can still trigger an upload.
export function onPaymentDeclinedUnexpectedly(code: string): void {
  repro.flagIncident('payment-declined', { code });
}
