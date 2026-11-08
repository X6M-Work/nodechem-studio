import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseGaussianOutput } from '../src/shared/gaussianOutput.js';
import {
  BOLTZMANN_CONSTANT_J_K,
  CALORIE_TO_JOULE,
  DEFAULT_QUASI_RRHO_CUTOFF_CM1,
  GAS_CONSTANT_J_PER_MOL_K,
  GAS_CONSTANT_KCAL_PER_MOL_K,
  GRIMME_BAV_KG_M2,
  HARTREE_TO_KCAL_PER_MOL,
  PK_UNIT_KCAL_PER_MOL,
  PLANCK_CONSTANT_J_S,
  QUASI_RRHO_ALPHA,
  SPEED_OF_LIGHT_CM_PER_S,
  STANDARD_STATE_CORRECTION_KCAL_PER_MOL,
  STANDARD_STATE_MOLAR_VOLUME_L,
  STANDARD_STATE_TEMPERATURE_K,
  buildThermochemistryReport,
  freeRotorEntropyJPerMolK,
  grimmeDamping,
  harmonicEntropyJPerMolK,
  quasiRRHOEntropyJPerMolK,
} from '../src/shared/thermochemistry.js';
import { mountThermochemistryView, thermochemistryPanelHtml } from '../src/renderer/thermochemistryView.js';

const fixtureText = readFileSync(
  fileURLToPath(new URL('./fixtures/synthetic-lowmode-freq.out', import.meta.url)),
  'utf8',
);
const fixture = parseGaussianOutput(fixtureText);
const fixtureFrequencies = [32.5, 78.4, 210.0, 450.0, 1200.0, 3100.0];

describe('thermochemistry constants', () => {
  it('names the conversion constants required by the issue', () => {
    expect(HARTREE_TO_KCAL_PER_MOL).toBe(627.5095);
    expect(STANDARD_STATE_CORRECTION_KCAL_PER_MOL).toBe(1.89);
    expect(PK_UNIT_KCAL_PER_MOL).toBe(1.364);
  });

  it('derives the standard-state shift from RT ln(24.465)', () => {
    const derived = GAS_CONSTANT_KCAL_PER_MOL_K
      * STANDARD_STATE_TEMPERATURE_K
      * Math.log(STANDARD_STATE_MOLAR_VOLUME_L);
    expect(derived).toBeCloseTo(1.894, 3);
    expect(Math.round(derived * 100) / 100).toBe(STANDARD_STATE_CORRECTION_KCAL_PER_MOL);
    // RT/p for one mole of ideal gas at 1 atm is 24.465 L.
    const litreAtmosphereGasConstant = 0.08205736608096; // L atm mol^-1 K^-1
    expect(litreAtmosphereGasConstant * STANDARD_STATE_TEMPERATURE_K)
      .toBeCloseTo(STANDARD_STATE_MOLAR_VOLUME_L, 2);
  });

  it('derives 1.364 kcal/mol per log10 pKa unit from 2.303 RT', () => {
    expect(Math.LN10 * GAS_CONSTANT_KCAL_PER_MOL_K * STANDARD_STATE_TEMPERATURE_K)
      .toBeCloseTo(PK_UNIT_KCAL_PER_MOL, 3);
  });

  it('keeps the Grimme cutoff and physical constants explicit', () => {
    expect(DEFAULT_QUASI_RRHO_CUTOFF_CM1).toBe(100);
    expect(QUASI_RRHO_ALPHA).toBe(4);
    expect(GRIMME_BAV_KG_M2).toBe(1.0e-44);
    expect(CALORIE_TO_JOULE).toBe(4.184);
    expect(GAS_CONSTANT_J_PER_MOL_K).toBe(8.314462618);
    expect(PLANCK_CONSTANT_J_S).toBe(6.62607015e-34);
    expect(BOLTZMANN_CONSTANT_J_K).toBe(1.380649e-23);
    expect(SPEED_OF_LIGHT_CM_PER_S).toBe(2.99792458e10);
  });
});

describe('Gaussian thermochemistry block parsing', () => {
  it('labels the fixture synthetic before any Gaussian-looking record', () => {
    const firstLine = fixtureText.split('\n')[0];
    expect(firstLine).toContain('FIXTURE OUTPUT');
    expect(firstLine.toLowerCase()).toContain('synthetic');
    expect(firstLine).not.toContain('Entering Gaussian');
  });

  it('parses the temperature and pressure line', () => {
    expect(fixture.thermochemistry.temperatureK).toBeCloseTo(298.15, 6);
    expect(fixture.thermochemistry.pressureAtm).toBeCloseTo(1.0, 9);
  });

  it('parses every correction and sum in the block', () => {
    const thermo = fixture.thermochemistry;
    expect(thermo.zeroPointCorrectionHartree).toBeCloseTo(0.011552, 9);
    expect(thermo.thermalCorrectionEnergyHartree).toBeCloseTo(0.016860, 9);
    expect(thermo.thermalCorrectionEnthalpyHartree).toBeCloseTo(0.017804, 9);
    expect(thermo.thermalCorrectionFreeEnergyHartree).toBeCloseTo(-0.009670, 9);
    expect(thermo.zeroPointEnergyHartree).toBeCloseTo(-100.488448, 9);
    expect(thermo.thermalEnergyHartree).toBeCloseTo(-100.483140, 9);
    expect(thermo.enthalpyHartree).toBeCloseTo(-100.482196, 9);
    expect(thermo.freeEnergyHartree).toBeCloseTo(-100.509670, 9);
    expect(thermo.zeroPointVibrationalEnergyJoulesPerMol).toBeCloseTo(30334.6, 1);
    expect(thermo.zeroPointVibrationalEnergyKcalPerMol).toBeCloseTo(7.249, 3);
  });

  it('keeps the sums consistent with SCF plus each correction', () => {
    const thermo = fixture.thermochemistry;
    const scf = fixture.scf.energyHartree;
    expect(thermo.zeroPointEnergyHartree).toBeCloseTo(scf + thermo.zeroPointCorrectionHartree, 9);
    expect(thermo.thermalEnergyHartree).toBeCloseTo(scf + thermo.thermalCorrectionEnergyHartree, 9);
    expect(thermo.enthalpyHartree).toBeCloseTo(scf + thermo.thermalCorrectionEnthalpyHartree, 9);
    expect(thermo.freeEnergyHartree).toBeCloseTo(scf + thermo.thermalCorrectionFreeEnergyHartree, 9);
  });

  it('parses the E (Thermal), CV and S components separately', () => {
    const thermo = fixture.thermochemistry;
    expect(thermo.thermalEnergyKcalPerMol).toEqual({
      total: 10.58,
      electronic: 0,
      translational: 0.889,
      rotational: 0.889,
      vibrational: 8.802,
    });
    expect(thermo.heatCapacityCalPerMolK).toEqual({
      total: 8,
      electronic: 0,
      translational: 2.981,
      rotational: 2.981,
      vibrational: 2.038,
    });
    expect(thermo.entropyCalPerMolK).toEqual({
      total: 57.837,
      electronic: 0,
      translational: 34.601,
      rotational: 10.754,
      vibrational: 12.482,
    });
  });

  it('parses all frequencies and exposes the lowest ones', () => {
    expect(fixture.frequencies.count).toBe(6);
    expect(fixture.frequencies.values).toEqual(fixtureFrequencies);
    expect(fixture.frequencies.lowest).toEqual(fixtureFrequencies);
    expect(fixture.frequencies.imaginaryCount).toBe(0);
  });

  it('ignores blank tokens when a frequency line has trailing spaces', () => {
    const parsed = parseGaussianOutput([
      ' Frequencies --    100.0000   200.0000   ',
      ' Normal termination of Gaussian 16',
    ].join('\n'));
    expect(parsed.frequencies.values).toEqual([100, 200]);
    expect(parsed.frequencies.count).toBe(2);
    expect(parsed.frequencies.lowest).toEqual([100, 200]);
  });

  it('leaves a missing component null rather than inventing zero', () => {
    const parsed = parseGaussianOutput([
      ' Sum of electronic and thermal Free Energies=        -76.020000',
      ' Normal termination of Gaussian 16',
    ].join('\n'));
    expect(parsed.thermochemistry.freeEnergyHartree).toBeCloseTo(-76.02, 6);
    expect(parsed.thermochemistry.temperatureK).toBeNull();
    expect(parsed.thermochemistry.zeroPointCorrectionHartree).toBeNull();
    expect(parsed.thermochemistry.entropyCalPerMolK.total).toBeNull();
  });
});

describe('quasi-RRHO formulas', () => {
  it('matches a hand-computed harmonic entropy at 100 cm^-1', () => {
    // Literal constants, written out independently of the module under test.
    const x = (6.62607015e-34 * 100 * 2.99792458e10) / (1.380649e-23 * 298.15);
    const expected = 8.314462618
      * (x / Math.expm1(x) - Math.log(-Math.expm1(-x)));
    expect(harmonicEntropyJPerMolK(100, 298.15)).toBeCloseTo(expected, 10);
    expect(harmonicEntropyJPerMolK(100, 298.15)).toBeCloseTo(14.452864, 5);
  });

  it('matches a hand-computed free-rotor entropy at 100 cm^-1', () => {
    const moment = 6.62607015e-34
      / (8 * Math.PI ** 2 * 100 * 2.99792458e10);
    const reduced = (moment * 1.0e-44) / (moment + 1.0e-44);
    const factor = (8 * Math.PI ** 3 * reduced * 1.380649e-23 * 298.15)
      / 6.62607015e-34 ** 2;
    const expected = 8.314462618 * (0.5 + 0.5 * Math.log(factor));
    expect(freeRotorEntropyJPerMolK(100, 298.15)).toBeCloseTo(expected, 10);
    expect(freeRotorEntropyJPerMolK(100, 298.15)).toBeCloseTo(11.944071, 5);
  });

  it('places the damping midpoint at the cutoff and interpolates around it', () => {
    expect(grimmeDamping(100, 100)).toBeCloseTo(0.5, 12);
    expect(grimmeDamping(50, 100)).toBeLessThan(0.5);
    expect(grimmeDamping(200, 100)).toBeGreaterThan(0.5);
    const atCutoff = quasiRRHOEntropyJPerMolK(100, 298.15, 100);
    expect(atCutoff).toBeCloseTo(
      0.5 * harmonicEntropyJPerMolK(100, 298.15)
        + 0.5 * freeRotorEntropyJPerMolK(100, 298.15),
      10,
    );
  });

  it('rejects non-positive wavenumbers, temperatures and cutoffs', () => {
    expect(() => harmonicEntropyJPerMolK(0)).toThrow(RangeError);
    expect(() => harmonicEntropyJPerMolK(100, 0)).toThrow(RangeError);
    expect(() => grimmeDamping(100, 0)).toThrow(RangeError);
    expect(() => freeRotorEntropyJPerMolK(100, 298.15, 0)).toThrow(RangeError);
  });
});

describe('thermochemistry report', () => {
  it('shows the baseline and both corrections as separate lines with constants', () => {
    const report = buildThermochemistryReport(fixture);
    expect(report.available).toBe(true);
    expect(report.baseline.hartree).toBeCloseTo(-100.509670, 9);
    expect(report.baseline.kcalPerMol).toBeCloseTo(-63070.772767, 5);
    expect(report.lines.map((line) => line.id)).toEqual(['quasi-rrho', 'standard-state']);
    expect(report.lines[0].constant).toEqual({
      name: 'DEFAULT_QUASI_RRHO_CUTOFF_CM1', value: 100, unit: 'cm^-1',
    });
    expect(report.lines[1].constant).toEqual({
      name: 'STANDARD_STATE_CORRECTION_KCAL_PER_MOL', value: 1.89, unit: 'kcal/mol',
    });
    expect(report.lines[0].correctionKcalPerMol).toBeCloseTo(0.680210, 5);
    expect(report.lines[0].entropyCorrectionCalPerMolK).toBeCloseTo(-2.2814, 3);
    expect(report.lines[1].correctionKcalPerMol).toBeCloseTo(1.89, 9);
    expect(report.total.deltaKcalPerMol).toBeCloseTo(2.570210, 5);
    expect(report.total.hartree).toBeCloseTo(-100.505574, 6);
    expect(report.total.kcalPerMol).toBeCloseTo(-63068.202557, 4);
    expect(report.constants.hartreeToKcalPerMol).toBe(627.5095);
    expect(report.constants.pKaUnitKcalPerMol).toBe(1.364);
    expect(report.warnings).toEqual([]);
  });

  it('disables each correction independently and updates the total', () => {
    const neither = buildThermochemistryReport(fixture, {
      quasiRRHO: false,
      standardState: false,
    });
    expect(neither.total.hartree).toBe(fixture.thermochemistry.freeEnergyHartree);
    expect(neither.total.deltaKcalPerMol).toBe(0);
    expect(neither.lines[0].enabled).toBe(false);
    expect(neither.lines[0].appliedKcalPerMol).toBe(0);
    expect(neither.lines[0].correctionKcalPerMol).toBeCloseTo(0.680210, 5);

    const standardOnly = buildThermochemistryReport(fixture, { quasiRRHO: false });
    expect(standardOnly.total.deltaKcalPerMol).toBeCloseTo(1.89, 9);

    const quasiOnly = buildThermochemistryReport(fixture, { standardState: false });
    expect(quasiOnly.total.deltaKcalPerMol).toBeCloseTo(0.680210, 5);

    const both = buildThermochemistryReport(fixture);
    expect(both.total.deltaKcalPerMol).toBeCloseTo(
      standardOnly.total.deltaKcalPerMol + quasiOnly.total.deltaKcalPerMol,
      6,
    );
  });

  it('exposes a changed cutoff in the line and recomputes the correction', () => {
    const report = buildThermochemistryReport(fixture, { cutoffCm1: 200 });
    expect(report.cutoffCm1).toBe(200);
    expect(report.lines[0].constant.value).toBe(200);
    expect(report.lines[0].detail).toContain('200 cm^-1');
    expect(report.lines[0].correctionKcalPerMol).toBeCloseTo(0.733042, 5);
    expect(report.lines[0].correctionKcalPerMol).not.toBeCloseTo(0.680210, 4);
  });

  it('rejects an invalid cutoff instead of silently falling back', () => {
    expect(() => buildThermochemistryReport(fixture, { cutoffCm1: 0 })).toThrow(RangeError);
    expect(() => buildThermochemistryReport(fixture, { cutoffCm1: -10 })).toThrow(RangeError);
    expect(() => buildThermochemistryReport(fixture, { cutoffCm1: Number.NaN })).toThrow(RangeError);
  });

  it('falls back to the harmonic entropy computed from frequencies', () => {
    const withoutTable = parseGaussianOutput([
      ' Frequencies --     32.5000    78.4000   210.0000',
      ' Frequencies --    450.0000  1200.0000  3100.0000',
      ' Sum of electronic and thermal Free Energies=         -100.509670',
      ' Normal termination of Gaussian 16',
    ].join('\n'));
    expect(withoutTable.thermochemistry.entropyCalPerMolK.vibrational).toBeNull();
    const report = buildThermochemistryReport(withoutTable);
    expect(report.lines[0].correctionKcalPerMol).toBeCloseTo(0.680210, 5);
  });

  it('returns an unknown total when an enabled correction cannot be computed', () => {
    const withoutFrequencies = parseGaussianOutput([
      ' Sum of electronic and thermal Free Energies=        -76.020000',
      ' Normal termination of Gaussian 16',
    ].join('\n'));
    const report = buildThermochemistryReport(withoutFrequencies);
    expect(report.available).toBe(false);
    expect(report.lines[0].correctionKcalPerMol).toBeNull();
    expect(report.lines[0].entropyCorrectionCalPerMolK).toBeNull();
    expect(report.total.hartree).toBeNull();
    expect(report.total.deltaKcalPerMol).toBeNull();
    expect(report.warnings.join(' ')).toContain('Quasi-RRHO is unavailable');

    const fixed = buildThermochemistryReport(withoutFrequencies, { quasiRRHO: false });
    expect(fixed.available).toBe(true);
    expect(fixed.total.deltaKcalPerMol).toBeCloseTo(1.89, 9);
  });

  it('returns an unknown total when the log has no free energy', () => {
    const withoutFreeEnergy = parseGaussianOutput([
      ' Frequencies --    100.0000   200.0000',
      ' Normal termination of Gaussian 16',
    ].join('\n'));
    const report = buildThermochemistryReport(withoutFreeEnergy);
    expect(report.baseline.hartree).toBeNull();
    expect(report.available).toBe(false);
    expect(report.total.hartree).toBeNull();
    expect(report.warnings.join(' ')).toContain('No free energy was parsed');
  });

  it('flags a temperature that differs from the standard-state reference', () => {
    const warm = parseGaussianOutput([
      ' Temperature   310.000 Kelvin.  Pressure   1.00000 Atm.',
      ' Frequencies --    100.0000   200.0000',
      ' Sum of electronic and thermal Free Energies=        -76.020000',
      ' Normal termination of Gaussian 16',
    ].join('\n'));
    const report = buildThermochemistryReport(warm);
    expect(report.temperatureK).toBeCloseTo(310, 6);
    expect(report.warnings.join(' ')).toContain('defined at 298.15 K');
  });
});

describe('thermochemistry view rows', () => {
  it('renders the two corrections as separate rows with their constants shown', () => {
    const html = thermochemistryPanelHtml(buildThermochemistryReport(fixture));
    expect(html).toContain('Quasi-RRHO entropy');
    expect(html).toContain('cutoff = 100 cm⁻¹');
    expect(html).toContain('Standard state 1 atm');
    expect(html).toContain('1 atm → 1 M = 1.89 kcal/mol');
    expect(html).toContain('data-thermo-toggle="quasiRRHO" checked');
    expect(html).toContain('data-thermo-toggle="standardState" checked');
    expect(html).toContain('Corrected G');
    expect(html).toContain('-100.505574 Eh');
    expect(html).toContain('1 Ha = 627.5095 kcal/mol');
  });

  it('renders a disabled correction unchecked but still shows its computed value', () => {
    const html = thermochemistryPanelHtml(buildThermochemistryReport(fixture, {
      quasiRRHO: false,
    }));
    expect(html).not.toContain('data-thermo-toggle="quasiRRHO" checked');
    expect(html).toContain('data-thermo-toggle="standardState" checked');
    expect(html).toContain('+0.68 kcal/mol');
    expect(html).toContain('-100.506658 Eh');
  });

  it('renders an unknown total when an enabled correction is unavailable', () => {
    const report = buildThermochemistryReport(parseGaussianOutput([
      ' Sum of electronic and thermal Free Energies=        -76.020000',
      ' Normal termination of Gaussian 16',
    ].join('\n')));
    const html = thermochemistryPanelHtml(report);
    expect(html).toContain('unavailable');
    expect(html).toContain('Corrected G');
    expect(html).toContain('unknown');
    expect(html).toContain('Quasi-RRHO is unavailable');
  });

  it('does not offer Gaussian corrections for an xTB thermochemistry panel', () => {
    const container = {
      hidden: true,
      innerHTML: '',
      querySelectorAll: () => [],
    };
    mountThermochemistryView(container, { thermochemistry: { freeEnergyHartree: -1 } }, { engine: 'xtb' });
    expect(container.hidden).toBe(false);
    expect(container.innerHTML).toContain('mRRHO');
    expect(container.innerHTML).not.toContain('Quasi-RRHO');
    expect(container.innerHTML).not.toContain('Standard state');
  });
});
