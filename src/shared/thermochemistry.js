/**
 * Thermochemistry corrections for parsed Gaussian frequency output.
 *
 * This module is deliberately pure: no Node APIs, no filesystem, no Electron
 * and no network. The parser supplies raw values; this module turns them into
 * separately auditable correction lines. A correction is never folded into
 * another number silently — the caller sees the baseline, every line, whether
 * it is enabled, and the resulting total.
 *
 * References:
 * - Gaussian 16 thermochemistry block (`Zero-point correction=`,
 *   `Thermal correction to ...`, `Sum of electronic and thermal ...`,
 *   the `E (Thermal) / CV / S` table, and the temperature/pressure line).
 * - Grimme, S. Chem. Eur. J. 2012, 18, 9955-9964: quasi-RRHO interpolation.
 * - GoodVibes 4.x `thermo.py`: the same interpolation, damping function and
 *   free-rotor moment of inertia (B_av = 1.0e-44 kg m^2). Quasi-RRHO is applied
 *   to the vibrational entropy only, which is GoodVibes' default `--qs grimme`
 *   behaviour; the enthalpy stays the harmonic value printed by Gaussian.
 */

/** kcal mol^-1 per Hartree. The value named by issue #22 and GoodVibes. */
export const HARTREE_TO_KCAL_PER_MOL = 627.5095;

/** J per calorie (thermochemical). */
export const CALORIE_TO_JOULE = 4.184;

/** J per kcal. */
export const JOULES_PER_KCAL = 4184;

/** Molar gas constant, J mol^-1 K^-1 (CODATA 2018). */
export const GAS_CONSTANT_J_PER_MOL_K = 8.314462618;

/** Molar gas constant, kcal mol^-1 K^-1. */
export const GAS_CONSTANT_KCAL_PER_MOL_K = GAS_CONSTANT_J_PER_MOL_K / JOULES_PER_KCAL;

/** Reference temperature for the standard-state constant, K. */
export const STANDARD_STATE_TEMPERATURE_K = 298.15;

/** Molar volume of an ideal gas at 1 atm and 298.15 K, L mol^-1 (RT/p). */
export const STANDARD_STATE_MOLAR_VOLUME_L = 24.465;

/**
 * 1 atm -> 1 M standard-state free-energy shift at 298.15 K.
 * RT ln(24.465) = 1.894 kcal/mol, reported here to the two decimals the
 * issue specifies. Applied per species, as a separate line.
 */
export const STANDARD_STATE_CORRECTION_KCAL_PER_MOL = 1.89;

/**
 * kcal mol^-1 per log10 unit of pKa at 298.15 K: 2.303 RT = 1.364.
 * Documented because the issue requires the constant to be named and tested.
 * No pKa helper is implemented in this module.
 */
export const PK_UNIT_KCAL_PER_MOL = 1.364;

/** Default Grimme quasi-RRHO entropy cutoff, cm^-1. */
export const DEFAULT_QUASI_RRHO_CUTOFF_CM1 = 100;

/** Grimme damping exponent: w = 1 / (1 + (cutoff / nu)^4). */
export const QUASI_RRHO_ALPHA = 4;

/** Grimme's average moment of inertia for the free-rotor term, kg m^2. */
export const GRIMME_BAV_KG_M2 = 1.0e-44;

/** Planck constant, J s (CODATA 2018). */
export const PLANCK_CONSTANT_J_S = 6.62607015e-34;

/** Boltzmann constant, J K^-1 (CODATA 2018). */
export const BOLTZMANN_CONSTANT_J_K = 1.380649e-23;

/** Speed of light in vacuum, cm s^-1. */
export const SPEED_OF_LIGHT_CM_PER_S = 2.99792458e10;

function assertPositive(value, label, unit) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive number in ${unit}.`);
  }
}

/**
 * Harmonic-oscillator vibrational entropy for one real mode, J mol^-1 K^-1.
 *
 * S = R [ x / (e^x - 1) - ln(1 - e^-x) ],  x = h c nu / (k T)
 */
export function harmonicEntropyJPerMolK(wavenumberCm1, temperatureK = STANDARD_STATE_TEMPERATURE_K) {
  assertPositive(wavenumberCm1, 'Wavenumber', 'cm^-1');
  assertPositive(temperatureK, 'Temperature', 'K');
  const x = (PLANCK_CONSTANT_J_S * wavenumberCm1 * SPEED_OF_LIGHT_CM_PER_S)
    / (BOLTZMANN_CONSTANT_J_K * temperatureK);
  return GAS_CONSTANT_J_PER_MOL_K
    * (x / Math.expm1(x) - Math.log(-Math.expm1(-x)));
}

/**
 * Free-rotor entropy for one mode, J mol^-1 K^-1 (Grimme / GoodVibes).
 *
 * The moment of inertia is inferred from the frequency and capped by B_av:
 *   mu = h / (8 pi^2 nu c),  mu' = mu B_av / (mu + B_av)
 *   S = R [ 1/2 + 1/2 ln(8 pi^3 mu' k T / h^2) ]
 */
export function freeRotorEntropyJPerMolK(
  wavenumberCm1,
  temperatureK = STANDARD_STATE_TEMPERATURE_K,
  averageMomentOfInertiaKgM2 = GRIMME_BAV_KG_M2,
) {
  assertPositive(wavenumberCm1, 'Wavenumber', 'cm^-1');
  assertPositive(temperatureK, 'Temperature', 'K');
  assertPositive(averageMomentOfInertiaKgM2, 'Average moment of inertia', 'kg m^2');
  const moment = PLANCK_CONSTANT_J_S
    / (8 * Math.PI ** 2 * wavenumberCm1 * SPEED_OF_LIGHT_CM_PER_S);
  const reducedMoment = (moment * averageMomentOfInertiaKgM2)
    / (moment + averageMomentOfInertiaKgM2);
  const factor = (8 * Math.PI ** 3 * reducedMoment * BOLTZMANN_CONSTANT_J_K * temperatureK)
    / PLANCK_CONSTANT_J_S ** 2;
  return GAS_CONSTANT_J_PER_MOL_K * (0.5 + 0.5 * Math.log(factor));
}

/**
 * Grimme damping factor for one real mode. 1 is fully harmonic, 0 is fully
 * free-rotor; the factor is 0.5 exactly at the cutoff.
 */
export function grimmeDamping(wavenumberCm1, cutoffCm1 = DEFAULT_QUASI_RRHO_CUTOFF_CM1) {
  assertPositive(wavenumberCm1, 'Wavenumber', 'cm^-1');
  assertPositive(cutoffCm1, 'Quasi-RRHO cutoff', 'cm^-1');
  return 1 / (1 + (cutoffCm1 / wavenumberCm1) ** QUASI_RRHO_ALPHA);
}

/**
 * Per-mode quasi-RRHO entropy, J mol^-1 K^-1:
 * S = w S_harmonic + (1 - w) S_free-rotor.
 */
export function quasiRRHOEntropyJPerMolK(
  wavenumberCm1,
  temperatureK = STANDARD_STATE_TEMPERATURE_K,
  cutoffCm1 = DEFAULT_QUASI_RRHO_CUTOFF_CM1,
) {
  const damping = grimmeDamping(wavenumberCm1, cutoffCm1);
  return damping * harmonicEntropyJPerMolK(wavenumberCm1, temperatureK)
    + (1 - damping) * freeRotorEntropyJPerMolK(wavenumberCm1, temperatureK);
}

function applied(value, enabled) {
  if (value === null) return null;
  return enabled ? value : 0;
}

function correctionLine({ id, label, enabled, constant, detail, correctionKcalPerMol }) {
  const correctionHartree = correctionKcalPerMol === null
    ? null : correctionKcalPerMol / HARTREE_TO_KCAL_PER_MOL;
  return {
    id,
    label,
    enabled,
    constant,
    detail,
    correctionKcalPerMol,
    correctionHartree,
    appliedKcalPerMol: applied(correctionKcalPerMol, enabled),
    appliedHartree: applied(correctionHartree, enabled),
  };
}

/**
 * Build the display-ready thermochemistry report for a `parseGaussianOutput`
 * result.
 *
 * `quasiRRHO` and `standardState` toggle the two corrections independently.
 * A disabled line is still present with its computed value, but contributes
 * zero to the total. If an enabled correction cannot be computed (for example
 * a frequency job without frequencies), the total is `null` rather than a
 * partial number. `cutoffCm1` is the exposed Grimme cutoff; it must be > 0.
 */
export function buildThermochemistryReport(parsed, {
  quasiRRHO = true,
  standardState = true,
  cutoffCm1 = DEFAULT_QUASI_RRHO_CUTOFF_CM1,
} = {}) {
  assertPositive(cutoffCm1, 'Quasi-RRHO cutoff', 'cm^-1');

  const thermochemistry = parsed?.thermochemistry && typeof parsed.thermochemistry === 'object'
    ? parsed.thermochemistry : {};
  const warnings = [];
  if (!parsed) warnings.push('No parsed output was supplied.');

  const temperatureK = Number.isFinite(thermochemistry.temperatureK)
    && thermochemistry.temperatureK > 0
    ? thermochemistry.temperatureK
    : STANDARD_STATE_TEMPERATURE_K;
  if (!Number.isFinite(thermochemistry.temperatureK)) {
    warnings.push(`No temperature was parsed; corrections use ${STANDARD_STATE_TEMPERATURE_K} K.`);
  } else if (Math.abs(temperatureK - STANDARD_STATE_TEMPERATURE_K) > 0.01) {
    warnings.push(
      `The log reports ${temperatureK} K; the standard-state constant is defined at `
      + `${STANDARD_STATE_TEMPERATURE_K} K.`,
    );
  }
  if (standardState && Number.isFinite(thermochemistry.pressureAtm)
    && Math.abs(thermochemistry.pressureAtm - 1) > 1e-6) {
    warnings.push(
      `The log reports ${thermochemistry.pressureAtm} atm; the standard-state line assumes 1 atm.`,
    );
  }

  const baselineHartree = Number.isFinite(thermochemistry.freeEnergyHartree)
    ? thermochemistry.freeEnergyHartree : null;
  if (baselineHartree === null) {
    warnings.push('No free energy was parsed; the corrected total is unknown.');
  }
  const baselineKcalPerMol = baselineHartree === null
    ? null : baselineHartree * HARTREE_TO_KCAL_PER_MOL;

  const frequencies = Array.isArray(parsed?.frequencies?.values)
    ? parsed.frequencies.values.filter((value) => Number.isFinite(value) && value > 0)
    : [];
  let harmonicBaselineJ = null;
  if (Number.isFinite(thermochemistry.entropyCalPerMolK?.vibrational)) {
    harmonicBaselineJ = thermochemistry.entropyCalPerMolK.vibrational * CALORIE_TO_JOULE;
  } else if (frequencies.length > 0) {
    harmonicBaselineJ = frequencies
      .reduce((sum, value) => sum + harmonicEntropyJPerMolK(value, temperatureK), 0);
  }

  let quasiCorrectionKcalPerMol = null;
  let quasiDeltaSJ = null;
  let lowModeCount = 0;
  if (frequencies.length > 0 && harmonicBaselineJ !== null) {
    const quasiEntropyJ = frequencies.reduce(
      (sum, value) => sum + quasiRRHOEntropyJPerMolK(value, temperatureK, cutoffCm1),
      0,
    );
    quasiDeltaSJ = quasiEntropyJ - harmonicBaselineJ;
    quasiCorrectionKcalPerMol = (-temperatureK * quasiDeltaSJ) / JOULES_PER_KCAL;
    lowModeCount = frequencies.filter((value) => value < cutoffCm1).length;
  } else if (quasiRRHO) {
    warnings.push('Quasi-RRHO is unavailable: no real vibrational frequencies were parsed.');
  }

  const lines = [
    correctionLine({
      id: 'quasi-rrho',
      label: 'Quasi-RRHO entropy',
      enabled: quasiRRHO,
      constant: {
        name: 'DEFAULT_QUASI_RRHO_CUTOFF_CM1',
        value: cutoffCm1,
        unit: 'cm^-1',
      },
      detail: `Grimme interpolation, alpha = ${QUASI_RRHO_ALPHA}; `
        + `${lowModeCount} of ${frequencies.length} real mode(s) below ${cutoffCm1} cm^-1; `
        + (quasiDeltaSJ === null
          ? 'entropy correction unavailable; '
          : `dS = ${(quasiDeltaSJ / CALORIE_TO_JOULE).toFixed(3)} cal/mol/K; `)
        + `B_av = ${GRIMME_BAV_KG_M2} kg m^2; T = ${temperatureK} K`,
      correctionKcalPerMol: quasiCorrectionKcalPerMol,
    }),
    correctionLine({
      id: 'standard-state',
      label: 'Standard state 1 atm -> 1 M',
      enabled: standardState,
      constant: {
        name: 'STANDARD_STATE_CORRECTION_KCAL_PER_MOL',
        value: STANDARD_STATE_CORRECTION_KCAL_PER_MOL,
        unit: 'kcal/mol',
      },
      detail: `RT ln(${STANDARD_STATE_MOLAR_VOLUME_L} L/mol) at `
        + `${STANDARD_STATE_TEMPERATURE_K} K; `
        + `R = ${GAS_CONSTANT_KCAL_PER_MOL_K.toFixed(7)} kcal/mol/K`,
      correctionKcalPerMol: STANDARD_STATE_CORRECTION_KCAL_PER_MOL,
    }),
  ];

  lines[0].entropyCorrectionCalPerMolK = quasiDeltaSJ === null
    ? null : quasiDeltaSJ / CALORIE_TO_JOULE;

  const enabledLines = lines.filter((line) => line.enabled);
  const unknown = baselineHartree === null
    || enabledLines.some((line) => line.correctionKcalPerMol === null);
  const deltaKcalPerMol = unknown
    ? null : enabledLines.reduce((sum, line) => sum + line.appliedKcalPerMol, 0);
  const totalHartree = unknown ? null : baselineHartree + (deltaKcalPerMol / HARTREE_TO_KCAL_PER_MOL);
  const totalKcalPerMol = totalHartree === null ? null : totalHartree * HARTREE_TO_KCAL_PER_MOL;

  return {
    available: totalHartree !== null,
    temperatureK,
    cutoffCm1,
    baseline: { hartree: baselineHartree, kcalPerMol: baselineKcalPerMol },
    lines,
    total: {
      hartree: totalHartree,
      kcalPerMol: totalKcalPerMol,
      deltaKcalPerMol,
      deltaHartree: deltaKcalPerMol === null ? null : deltaKcalPerMol / HARTREE_TO_KCAL_PER_MOL,
    },
    constants: {
      hartreeToKcalPerMol: HARTREE_TO_KCAL_PER_MOL,
      calorieToJoule: CALORIE_TO_JOULE,
      gasConstantKcalPerMolK: GAS_CONSTANT_KCAL_PER_MOL_K,
      standardStateTemperatureK: STANDARD_STATE_TEMPERATURE_K,
      standardStateMolarVolumeL: STANDARD_STATE_MOLAR_VOLUME_L,
      standardStateCorrectionKcalPerMol: STANDARD_STATE_CORRECTION_KCAL_PER_MOL,
      pKaUnitKcalPerMol: PK_UNIT_KCAL_PER_MOL,
      quasiRRHOCutoffCm1: cutoffCm1,
      quasiRRHOAlpha: QUASI_RRHO_ALPHA,
      grimmeBavKgM2: GRIMME_BAV_KG_M2,
    },
    warnings,
  };
}
