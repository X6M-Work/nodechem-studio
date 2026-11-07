/**
 * Transition-state force-constant options (issue #15).
 *
 * A Berny transition-state search needs real curvature information. Without it
 * Gaussian starts from a valence-force-field Hessian guessed from atomic radii,
 * and the G16 manual is explicit that for optimizations to transition states
 * "some knowledge of the curvature around the saddle point is essential, and
 * the default approximate Hessian must always be improved". A bare `Opt=TS`
 * therefore either stalls or walks to a different stationary point.
 *
 * This module is the single place that turns a job type plus a force-constant
 * choice into the route's job keyword, so composing `Opt=TS` with force
 * constants can never emit two `Opt` keywords.
 *
 * NoEigenTest: Gaussian runs the curvature test by default for TS searches. It
 * is suppressed only for `CalcFC`, where the Hessian is computed once at a
 * starting geometry that is often a rough guess and the job would otherwise
 * abort before the first step. `CalcAll` recomputes the Hessian at every point
 * and `ReadFC` reads one written by a real frequency job, so both keep the
 * test: it is the guard that the curvature really is a single saddle.
 */

export const TS_JOB_TYPE = 'Opt=TS';

/** Force-constant choices, in inspector order. `default` adds no Opt flag. */
export const TS_FORCE_CONSTANT_OPTIONS = Object.freeze([
  {
    id: 'CalcFC',
    label: 'CalcFC — compute at the first point',
    flags: Object.freeze(['CalcFC', 'NoEigenTest']),
  },
  {
    id: 'CalcAll',
    label: 'CalcAll — compute at every point',
    flags: Object.freeze(['CalcAll']),
  },
  {
    id: 'ReadFC',
    label: 'ReadFC — read from the checkpoint',
    flags: Object.freeze(['ReadFC']),
  },
  {
    id: 'default',
    label: 'Default (unsafe) — estimated Hessian',
    flags: Object.freeze([]),
  },
]);

export const TS_FORCE_CONSTANT_IDS = Object.freeze(
  TS_FORCE_CONSTANT_OPTIONS.map((option) => option.id),
);

export const DEFAULT_TS_FORCE_CONSTANTS = 'CalcFC';

/** An `Opt` keyword at the start of a token, e.g. `Opt`, `Opt=TS`, `Opt=(TS,CalcFC)`. */
const OPT_KEYWORD = /(^|[^A-Za-z0-9])opt\s*(=|\(|\s|$)/i;

function oneLine(value, fallback = '') {
  return String(value ?? fallback).replace(/[\r\n]+/g, ' ').trim();
}

export function isTsJob(jobType) {
  return oneLine(jobType) === TS_JOB_TYPE;
}

/** True when extra route keywords already carry an `Opt` keyword of their own. */
export function hasOptKeyword(text) {
  return OPT_KEYWORD.test(String(text ?? ''));
}

/**
 * The stored force-constant choice, or the safe default. An unknown value is
 * never emitted as route syntax; it falls back to CalcFC, the safe direction.
 */
export function forceConstantsFor(settings = {}) {
  const value = settings.forceConstants;
  return TS_FORCE_CONSTANT_IDS.includes(value) ? value : DEFAULT_TS_FORCE_CONSTANTS;
}

/** The `Opt=(...)` flags for the stored choice. Empty for the unsafe default. */
export function forceConstantFlags(settings = {}) {
  const option = TS_FORCE_CONSTANT_OPTIONS.find((item) => item.id === forceConstantsFor(settings));
  return option ? [...option.flags] : [];
}

/**
 * The job keyword for a route: `Opt`, `Opt Freq`, `Opt=(TS,CalcFC,NoEigenTest)`,
 * `Freq`, `IRC(forward,reverse)`, `SP`, `Scan`. Always exactly one job keyword.
 */
export function jobKeywordFor(settings = {}) {
  const jobType = oneLine(settings.jobType, 'Opt');
  if (jobType === 'IRC') {
    const direction = settings.ircDirection === 'both'
      ? 'forward,reverse'
      : (oneLine(settings.ircDirection, 'forward') || 'forward');
    return `IRC(${direction})`;
  }
  if (jobType !== TS_JOB_TYPE) return jobType;
  const flags = forceConstantFlags(settings);
  return flags.length === 0 ? TS_JOB_TYPE : `Opt=(${['TS', ...flags].join(',')})`;
}

/**
 * True when a job is known to write force constants to its checkpoint:
 * a `Freq` job, or an `Opt=TS` job that computes them with `CalcFC`.
 * Deliberately an allow-list — reading a checkpoint that never received a
 * Hessian fails at run time, after the user has paid for the job.
 */
export function upstreamProvidesForceConstants(settings = {}) {
  const jobType = oneLine(settings.jobType);
  if (jobType === 'Freq') return true;
  return jobType === TS_JOB_TYPE && forceConstantsFor(settings) === 'CalcFC';
}

/**
 * Check one node's force-constant choice. `upstream` is the checkpoint source
 * node (`{ id, title, settings }`) or null. Returns human-readable messages;
 * the caller supplies the JSON path and decides how to report them.
 */
export function checkTsForceConstants({ settings = {}, upstream = null } = {}) {
  const errors = [];
  const warnings = [];
  if (!isTsJob(settings.jobType)) return { errors, warnings };

  const choice = forceConstantsFor(settings);
  if (choice === 'default') {
    warnings.push(
      'uses the estimated initial Hessian for a transition-state search. Berny needs '
      + 'real curvature there, so the search often stalls or converges to the wrong '
      + 'saddle. CalcFC is the safe default.',
    );
  }
  if (choice === 'ReadFC') {
    if (!upstream) {
      errors.push(
        'ReadFC reads force constants from a checkpoint, but this transition-state '
        + 'block has no checkpoint hand-off. Connect a Freq or Opt=CalcFC block as its '
        + 'checkpoint source, or choose CalcFC.',
      );
    } else if (!upstreamProvidesForceConstants(upstream.settings || {})) {
      const title = oneLine(upstream.title) || oneLine(upstream.id) || 'the upstream block';
      const jobType = oneLine(upstream.settings?.jobType) || 'an unknown job type';
      errors.push(
        `ReadFC needs force constants in the upstream checkpoint, but "${title}" is `
        + `${jobType} and does not write them. Use a Freq or Opt=CalcFC block as the `
        + 'checkpoint source, or choose CalcFC.',
      );
    }
  }
  return { errors, warnings };
}
