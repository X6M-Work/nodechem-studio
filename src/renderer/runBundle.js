/**
 * Run-console action for the publishable run bundle.
 *
 * Renderer-only: no Node APIs, no filesystem, no archive and no network. The
 * main process chooses the target folder and writes the bundle; this module
 * only sends the run id and reports the outcome.
 */

export async function exportRunBundleAction({ desktop, runId, notify } = {}) {
  const say = typeof notify === 'function' ? notify : () => {};

  if (!desktop?.exportRunBundle) {
    say('Open the desktop app to export a run bundle to disk.');
    return { canceled: true };
  }
  if (!runId) {
    say('Run a calculation before exporting a run bundle.');
    return { error: 'no-run' };
  }

  try {
    const result = await desktop.exportRunBundle(runId);
    if (result?.canceled) return result;
    if (result?.error) {
      say(`Could not export run bundle: ${result.error.message}`);
      return result;
    }
    say(`Exported run bundle to ${result.path}`);
    return result;
  } catch (error) {
    say(`Could not export run bundle: ${error.message}`);
    return { error: error.message };
  }
}
