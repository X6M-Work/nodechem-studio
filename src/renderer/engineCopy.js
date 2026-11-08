/**
 * Engine-aware copy for the run console and inspector.
 *
 * The product drives two engines. Wording has to name the engine that will
 * actually run, and must never tell an xTB user to install or licence
 * Gaussian. These helpers are pure functions of the engine id so the
 * distinction can be tested without a DOM.
 */

import { engineOrDefault } from '../shared/engines/index.js';

export const BROWSER_PREVIEW_RUN_MESSAGE = 'Open the desktop app to start a local run.';
export const BROWSER_PREVIEW_CONSOLE_HINT = 'Browser preview: the local runner is unavailable. '
  + 'Start the Electron app with "npm run dev" or "npm start".';

const FIXTURE_HINT = 'Dry run writes a synthetic fixture log and evaluates the parser.';

/** Label above the executable field — the engine named is the one that runs. */
export function executableLabelFor(engineId) {
  return engineOrDefault(engineId).id === 'xtb' ? 'xTB executable' : 'Gaussian 16 executable';
}

/** Example path shown in the empty executable field. */
export function executablePlaceholderFor(engineId) {
  return engineOrDefault(engineId).id === 'xtb'
    ? '/usr/local/bin/xtb or C:\\xtb\\bin\\xtb.exe'
    : 'C:\\G16W\\g16.exe';
}

/** Run-console hint under the dry-run checkbox. Dry run stays a fixture. */
export function dryRunHintFor(engineId) {
  return engineOrDefault(engineId).id === 'xtb'
    ? `${FIXTURE_HINT} Uncheck to run the xTB executable.`
    : `${FIXTURE_HINT} Uncheck to launch the licensed Gaussian 16 installation.`;
}

/** Status label for a run: `dry run`, or the engine that produced the record. */
export function runEngineLabel(engineId, { dryRun = false } = {}) {
  return dryRun ? 'dry run' : engineOrDefault(engineId).label;
}

/**
 * Inspector note under the checkpoint hand-off select. Gaussian stages a
 * `.chk`; xTB has no checkpoint file to hand off, so the note must say so
 * rather than promise Gaussian keywords that are never emitted.
 */
export function checkpointHandoffNote(engineId) {
  return engineOrDefault(engineId).id === 'xtb'
    ? 'Gaussian checkpoint hand-off is not applied to xTB; xTB re-reads '
      + '<code>xtbrestart</code> from its own run directory.'
    : 'Adds <code>%OldChk</code>, <code>Geom=Checkpoint</code> and <code>Guess=Read</code> to this task.';
}
