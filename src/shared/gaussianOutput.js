/**
 * Minimal, dependency-free Gaussian output reader for the first desktop slice.
 * It classifies termination and exposes the evidence needed by the run gates.
 * The full GaussianHelper parser can replace this module without changing the
 * runner contract.
 */

import { terminationCodeOf } from './engines/canonical.js';

const NUMBER = String.raw`[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[EeDd][-+]?\d+)?`;

// The documented Gaussian banner, e.g. "Gaussian 16, Revision C.01". The
// termination line ("Normal termination of Gaussian 16 at ...") deliberately
// does not match: it carries no revision and says nothing about the build.
const PROGRAM_BANNER = /\bGaussian\s+(\d{1,2}(?:\.\d+)?),\s*Revision\s+([A-Za-z]\.\d{2})\b/;

function toNumber(value) {
  if (value === undefined || value === null) return null;
  const number = Number(String(value).replace(/[Dd]/, 'E'));
  return Number.isFinite(number) ? number : null;
}

const EVIDENCE = [
  ['banner', /\bEntering Gaussian System\b/i],
  ['program', PROGRAM_BANNER],
  ['route', /^[ \t]*#[pPnNtT]?\s*\S/m],
  ['geometry', /^[ \t]*[A-Z][a-z]?[ \t]+[-+]?\d+(?:\.\d+)?[ \t]+[-+]?\d+(?:\.\d+)?[ \t]+[-+]?\d+(?:\.\d+)?/m],
  ['scf', /\bSCF Done:/i],
  ['optimization', /\b(?:Optimization completed|Stationary point found)\b/i],
  ['frequencies', /\bFrequencies\s*--/i],
  ['thermochemistry', /\bSum of electronic and thermal (?:Free Energies|Enthalpies)\b/i],
  ['termination', /\b(?:Normal termination of Gaussian|Error termination)\b/i],
];

/**
 * Which records a piece of output can supply. The runner uses this to say what
 * the head and tail windows of a large file each contributed.
 */
export function outputEvidence(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  return EVIDENCE.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

/**
 * A byte range is partial when the caller says so, when the range itself says
 * so, or when it does not cover the whole file. Never trust a single flag.
 */
function normalizeByteRange(byteRange, truncated) {
  if (!byteRange || typeof byteRange !== 'object') return null;
  const size = Number.isFinite(byteRange.size) ? byteRange.size : null;
  const bytesRead = Number.isFinite(byteRange.bytesRead) ? byteRange.bytesRead : null;
  const partial = truncated === true || byteRange.truncated === true
    || (size !== null && bytesRead !== null && bytesRead < size);
  const windows = Array.isArray(byteRange.windows) ? byteRange.windows.map((entry) => {
    const start = Number.isFinite(entry?.start) ? entry.start : null;
    const end = Number.isFinite(entry?.end) ? entry.end : null;
    return {
      name: typeof entry?.name === 'string' ? entry.name : 'window',
      start,
      end,
      bytes: Number.isFinite(entry?.bytes) ? entry.bytes
        : start !== null && end !== null ? Math.max(0, end - start) : null,
      supplied: Array.isArray(entry?.supplied) ? entry.supplied.map(String) : [],
    };
  }) : [];
  return { size, bytesRead, truncated: partial, windows };
}

/**
 * Parse one output text.
 *
 * `truncated` and `byteRange` describe how much of the file the text came from.
 * A partial parse is recorded as `complete: false`; `evaluateGates` then refuses
 * to pass it. A whole text defaults to complete because the caller supplied it
 * in full.
 */
export function parseGaussianOutput(text, { truncated = false, byteRange = null } = {}) {
  if (typeof text !== 'string') throw new TypeError('Gaussian output must be text.');
  const bytes = normalizeByteRange(byteRange, truncated);
  const complete = bytes ? !bytes.truncated : !truncated;
  const lines = text.split(/\r\n|\n|\r/);
  const joined = lines.join('\n');

  const normalTermination = /\bNormal termination of Gaussian\b/i.test(joined);
  const errorTermination = /\bError termination\b/i.test(joined);
  const status = normalTermination ? 'completed' : errorTermination ? 'error' : 'incomplete';

  const banner = joined.match(PROGRAM_BANNER);
  const program = {
    name: banner ? 'Gaussian' : null,
    version: banner ? banner[1] : null,
    revision: banner ? banner[2].toUpperCase() : null,
  };

  let scf = { status: 'unknown', energyHartree: null, cycles: null, method: null };
  const scfMatch = joined.match(new RegExp(
    String.raw`SCF Done:\s+E\(([^)]+)\)\s*=\s*(${NUMBER})\s+A\.U\.\s+after\s+(\d+)\s+cycles`,
    'i',
  ));
  if (scfMatch) {
    scf = {
      status: 'converged',
      energyHartree: toNumber(scfMatch[2]),
      cycles: Number(scfMatch[3]),
      method: scfMatch[1].trim(),
    };
  } else if (/Convergence failure/i.test(joined) || /\bSCF (?:did not converge|failed)\b/i.test(joined)) {
    scf = { ...scf, status: 'failed' };
  }

  const optimization = {
    completed: /\bOptimization completed\b/i.test(joined),
    stationary: /\bStationary point found\b/i.test(joined),
  };

  const frequencies = [];
  for (const line of lines) {
    const match = line.match(new RegExp(String.raw`Frequencies\s*--\s+(.+)`, 'i'));
    if (!match) continue;
    for (const token of match[1].split(/\s+/)) {
      const value = toNumber(token);
      if (value !== null) frequencies.push(value);
    }
  }
  const imaginaryValues = frequencies.filter((value) => value < 0);
  const imaginaryCount = imaginaryValues.length;
  const minImaginary = imaginaryValues.length ? Math.min(...imaginaryValues) : null;

  let freeEnergy = null;
  const freeEnergyMatch = joined.match(new RegExp(
    String.raw`Sum of electronic and thermal Free Energies\s*=\s*(${NUMBER})`,
    'i',
  ));
  if (freeEnergyMatch) freeEnergy = toNumber(freeEnergyMatch[1]);

  // Correlated (post-HF) energy when present; otherwise the SCF energy is the best record.
  const correlatedMatch = joined.match(new RegExp(
    String.raw`(?:CCSD\(T\)|CCSD|QCISD\(T\)|QCISD|MP4|MP3|MP2)\s*(?:energy)?\s*=\s*(${NUMBER})`,
    'i',
  )) || joined.match(new RegExp(String.raw`E\(CORR\)\s*=\s*(${NUMBER})`, 'i'));
  const correlatedEnergy = correlatedMatch ? toNumber(correlatedMatch[1]) : null;
  const finalEnergyHartree = correlatedEnergy !== null ? correlatedEnergy : scf.energyHartree;
  const finalEnergySource = correlatedEnergy !== null ? 'post-hf' : scf.energyHartree !== null ? 'scf' : null;

  return {
    status,
    termination: normalTermination
      ? 'Normal termination of Gaussian'
      : errorTermination ? 'Error termination' : 'No termination marker',
    program,
    scf,
    optimization,
    frequencies: {
      count: frequencies.length,
      imaginaryCount,
      imaginaryValues: imaginaryValues.slice(0, 20),
      minImaginary,
    },
    thermochemistry: { freeEnergyHartree: freeEnergy },
    finalEnergy: { hartree: finalEnergyHartree, source: finalEnergySource },
    complete,
    bytes,
    lineCount: lines.length,
  };
}

/**
 * Evaluate the first-slice gates. A missing or unjudgeable value is `unknown`,
 * never `pass`. `expectedImaginary` is null when the route has no frequency
 * interpretation.
 *
 * Termination is read through the canonical `terminationCodeOf()` so the same
 * gates work for any engine.
 */
export function evaluateGates(parsed, {
  expectedImaginary = null,
  minMagnitude = 50,
  requireOptimization = false,
  requireFrequency = false,
  requireThermochemistry = false,
  requireFinalEnergy = false,
} = {}) {
  const gates = [];
  const add = (name, required, result, detail) => {
    gates.push({ name, required, result, detail: detail || null });
  };

  const complete = parsed.complete === true;
  const bytes = parsed.bytes || null;
  const byteDetail = bytes && Number.isFinite(bytes.bytesRead)
    ? `read ${bytes.bytesRead} of ${bytes.size ?? '?'} bytes${Array.isArray(bytes.windows) && bytes.windows.length ? ` (${bytes.windows.map((window) => window.name).join('+')})` : ''}`
    : 'the parse does not cover the whole output';
  add('Output complete', true, complete ? 'pass' : 'unknown',
    complete ? (bytes && Number.isFinite(bytes.bytesRead) ? byteDetail : 'full output parsed') : byteDetail);

  const termination = terminationCodeOf(parsed);
  add('Normal termination', true,
    termination === 'normal' ? 'pass'
      : termination === 'error' ? 'fail' : 'unknown',
    parsed.termination);

  add('SCF record', true,
    parsed.scf.status === 'converged' ? 'pass'
      : parsed.scf.status === 'failed' ? 'fail' : 'unknown',
    parsed.scf.status === 'converged'
      ? `${parsed.scf.energyHartree ?? '?'} Eh after ${parsed.scf.cycles ?? '?'} cycles`
      : parsed.scf.status);

  if (requireOptimization) {
    add('Optimization completed', true,
      parsed.optimization.completed ? 'pass' : 'unknown',
      parsed.optimization.completed ? 'Optimization completed' : null);
  }

  if (expectedImaginary !== null) {
    const countPass = Number.isInteger(expectedImaginary) && parsed.frequencies.count > 0
      ? parsed.frequencies.imaginaryCount === expectedImaginary
      : null;
    add('Imaginary mode count', true,
      countPass === true ? 'pass' : countPass === false ? 'fail' : 'unknown',
      `expected ${expectedImaginary}, found ${parsed.frequencies.imaginaryCount}`);

    if (expectedImaginary > 0) {
      const floor = Number.isFinite(Number(minMagnitude)) ? Number(minMagnitude) : 0;
      const magnitude = parsed.frequencies.minImaginary === null
        ? null : Math.abs(parsed.frequencies.minImaginary);
      add('Imaginary magnitude', true,
        magnitude === null ? 'unknown' : magnitude >= floor ? 'pass' : 'fail',
        magnitude === null ? null : `${magnitude.toFixed(1)} cm^-1 (floor ${floor})`);
    }
  }

  if (requireFrequency) {
    add('Frequency record', true,
      parsed.frequencies.count > 0 ? 'pass' : 'unknown',
      `${parsed.frequencies.count} modes`);
  }

  if (requireThermochemistry) {
    add('Thermochemistry record', true,
      parsed.thermochemistry.freeEnergyHartree !== null ? 'pass' : 'unknown',
      parsed.thermochemistry.freeEnergyHartree !== null ? 'free energy parsed' : null);
  }

  if (requireFinalEnergy) {
    const finalEnergy = parsed.finalEnergy || { hartree: null, source: null };
    add('Final energy record', true,
      finalEnergy.hartree !== null ? 'pass' : 'unknown',
      finalEnergy.hartree !== null ? `${finalEnergy.hartree} Eh (${finalEnergy.source})` : null);
  }

  const required = gates.filter((gate) => gate.required);
  const evaluated = required.some((gate) => gate.result === 'fail') ? 'fail'
    : required.every((gate) => gate.result === 'pass') ? 'pass' : 'unknown';
  // Structural guard: no partial parse can ever report a pass, whatever else it found.
  const overall = evaluated === 'pass' && !complete ? 'unknown' : evaluated;
  return { overall, gates, complete };
}
