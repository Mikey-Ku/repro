/**
 * Script-tag build. tsup wraps these exports in `window.Repro`, so both
 * `Repro.init({...})` and `Repro.Repro.init({...})` work from a plain <script>.
 */
import { Repro, version } from './index.js';

export { Repro, version };
export const { init, start, stop, captureException, identify, annotate, flush, getSessionId, isRecording } = Repro;
