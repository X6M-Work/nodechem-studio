import { describe, it, expect } from 'vitest';
import { buildGaussianInput, DEMO_WATER, routeFor, outputNameFor } from '../src/shared/gaussianInput.js';

const baseSettings = {
  jobType: 'Opt',
  method: 'B3LYP',
  basis: '6-31G(d)',
  memory: '4',
  memoryUnit: 'GB',
  nproc: '4',
  checkpoint: 'task.chk',
  charge: 0,
  multiplicity: 1,
  dispersion: '',
  scf: '',
  grid: '',
  population: '',
  verbosity: '',
  solvation: false,
  customKeywords: '',
};

const molecule = { charge: 0, multiplicity: 1, coords: DEMO_WATER };

describe('Gaussian input builder', () => {
  it('emits link0, route, title, charge and Cartesian coordinates', () => {
    const text = buildGaussianInput({
      title: 'Water optimization',
      settings: baseSettings,
      molecule,
      inputName: 'water_opt.gjf',
    });
    expect(text).toContain('%Mem=4GB');
    expect(text).toContain('%NProcShared=4');
    expect(text).toContain('%Chk=task.chk');
    expect(text).toContain('#p B3LYP/6-31G(d) Opt');
    expect(text).toContain('Water optimization');
    expect(text).toContain('0 1');
    expect(text).toContain('O');
    expect(text.endsWith('\n\n')).toBe(true);
  });

  it('adds solvation, dispersion and custom route keywords', () => {
    const text = buildGaussianInput({
      settings: {
        ...baseSettings,
        dispersion: 'GD3BJ',
        solvation: true,
        solvationModel: 'SMD',
        solvent: 'Water',
        customKeywords: 'Nosymm',
      },
      molecule,
      inputName: 'water.gjf',
    });
    expect(text).toContain('EmpiricalDispersion=GD3BJ');
    expect(text).toContain('SCRF=(SMD,Solvent=Water)');
    expect(text).toContain('Nosymm');
  });

  it('supports an explicit checkpoint hand-off', () => {
    const text = buildGaussianInput({
      settings: { ...baseSettings, checkpoint: 'ts_freq.chk' },
      molecule,
      inputName: 'ts_freq.gjf',
      oldCheckpoint: 'ts_opt.chk',
    });
    expect(text).toContain('%OldChk=ts_opt.chk');
    expect(text).toContain('%Chk=ts_freq.chk');
    expect(text).toContain('Geom=Check');
    expect(text).toContain('Guess=Read');
  });

  it('does not duplicate Geom or Guess when the route already sets them', () => {
    const text = buildGaussianInput({
      settings: { ...baseSettings, customKeywords: 'Geom=AllCheck Guess=Read' },
      molecule,
      inputName: 'continue.gjf',
      oldCheckpoint: 'previous.chk',
    });
    expect(text.match(/Geom=/g)).toHaveLength(1);
    expect(text.match(/Guess=/g)).toHaveLength(1);
  });

  it('rejects an input name that could escape the run directory', () => {
    expect(() => buildGaussianInput({
      settings: baseSettings,
      molecule,
      inputName: '../escape.gjf',
    })).toThrow(/safe/);
  });

  it('rejects a molecule without coordinates', () => {
    expect(() => buildGaussianInput({
      settings: baseSettings,
      molecule: { coords: [] },
      inputName: 'empty.gjf',
    })).toThrow(/coordinates/);
  });

  it('builds an IRC route with both directions', () => {
    expect(routeFor({ ...baseSettings, jobType: 'IRC', ircDirection: 'both' }))
      .toContain('IRC(forward,reverse)');
  });

  it('maps input names to Gaussian output names', () => {
    expect(outputNameFor('water_opt.gjf')).toBe('water_opt.out');
    expect(outputNameFor('water.com')).toBe('water.out');
  });
});
