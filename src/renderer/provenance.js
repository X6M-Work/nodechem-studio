/**
 * Run-console wiring for the provenance manifest.
 *
 * Renderer-only: no Node APIs, no filesystem, no network. The hashes are
 * recomputed in the main process; this module only asks and formats the answer.
 */

export { provenanceSummary, verifyRunInput } from '../shared/provenance.js';

/** Enable the Verify button only when the console has a run to check. */
export function syncVerifyButton(button, runId) {
  if (!button) return;
  button.toggleAttribute('disabled', !runId);
}
