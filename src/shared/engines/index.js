/**
 * Engine registry.
 *
 * One place that knows which calculation engines exist and how to drive them.
 * The renderer uses `buildInput` to produce a run payload; the runner uses
 * `parse`, `classify` and the name validators. Gates and condition fields only
 * ever see the canonical result (see ./canonical.js).
 */

import { buildGaussianInput, outputNameFor as gaussianOutputNameFor } from '../gaussianInput.js';
import { parseGaussianOutput } from '../gaussianOutput.js';
import { makeFixtureOutput } from '../fixtureOutput.js';
import { terminationCodeOf } from './canonical.js';
import {
  XTB_CAPABILITIES,
  XTB_ENGINE_ID,
  buildXtbInput,
  classifyXtbTermination,
  isSafeXtbInputName,
  isSafeXtbOutputName,
  makeXtbFixtureOutput,
  parseXtbOutput,
} from './xtb.js';

const GAUSSIAN_INPUT = /^[A-Za-z0-9._-]+\.(gjf|com)$/i;
const GAUSSIAN_OUTPUT = /^[A-Za-z0-9._-]+\.(out|log)$/i;

export const GAUSSIAN_ENGINE = Object.freeze({
  id: 'gaussian',
  label: 'Gaussian 16',
  capabilities: Object.freeze({
    id: 'gaussian',
    label: 'Gaussian 16',
    inputExtension: '.gjf',
    outputExtension: '.out',
    capturesStdout: false,
    restartArtifact: 'chk',
    exitCodes: Object.freeze({ success: 0 }),
    builtInDispersion: null,
    unsupportedFeatures: Object.freeze([]),
  }),

  acceptsInputName: (name) => GAUSSIAN_INPUT.test(String(name)),
  acceptsOutputName: (name) => GAUSSIAN_OUTPUT.test(String(name)),

  /** Thin wrapper so callers can build either engine's input the same way. */
  buildInput({ title, settings, molecule, inputName, oldCheckpoint = '' }) {
    const text = buildGaussianInput({ title, settings, molecule, inputName, oldCheckpoint });
    return {
      engine: 'gaussian',
      inputName,
      inputText: text,
      outputName: gaussianOutputNameFor(inputName),
      argv: [inputName],
      captureStdout: false,
      route: '',
    };
  },

  parse(text, options = {}) {
    return parseGaussianOutput(text, options);
  },

  makeFixture({ imaginary = 0 } = {}) {
    return makeFixtureOutput({ imaginary });
  },

  classify(text, exitCode) {
    const parsed = parseGaussianOutput(String(text || ''));
    const code = terminationCodeOf(parsed);
    if (code === 'normal') return { code, reason: 'Normal termination of Gaussian' };
    if (code === 'error') return { code, reason: 'Error termination' };
    const numeric = Number(exitCode);
    if (Number.isFinite(numeric) && numeric !== 0) {
      return { code: 'error', reason: `Gaussian exited with code ${numeric} and produced no termination record` };
    }
    return { code: 'none', reason: 'no termination marker' };
  },
});

export const XTB_ENGINE = Object.freeze({
  id: XTB_ENGINE_ID,
  label: XTB_CAPABILITIES.label,
  capabilities: XTB_CAPABILITIES,

  acceptsInputName: isSafeXtbInputName,
  acceptsOutputName: isSafeXtbOutputName,

  buildInput: buildXtbInput,
  parse: parseXtbOutput,

  makeFixture({ imaginary = 0 } = {}) {
    return makeXtbFixtureOutput({ imaginary });
  },

  classify: classifyXtbTermination,
});

export const ENGINES = Object.freeze({
  gaussian: GAUSSIAN_ENGINE,
  xtb: XTB_ENGINE,
});

export const ENGINE_IDS = Object.freeze(Object.keys(ENGINES));

export const DEFAULT_ENGINE_ID = 'gaussian';

export function isEngineId(id) {
  return Object.prototype.hasOwnProperty.call(ENGINES, String(id));
}

/** Resolve an engine id, falling back to Gaussian for missing or unknown values. */
export function engineOrDefault(id) {
  return isEngineId(id) ? ENGINES[String(id)] : ENGINES[DEFAULT_ENGINE_ID];
}

/** Resolve an engine id and throw on an unknown one — for user-facing input. */
export function engineFor(id) {
  const key = String(id ?? DEFAULT_ENGINE_ID);
  if (!isEngineId(key)) {
    throw new Error(`Unknown engine "${key}". Supported: ${ENGINE_IDS.join(', ')}.`);
  }
  return ENGINES[key];
}
