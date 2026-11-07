import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluateGates, parseGaussianOutput } from '../src/shared/gaussianOutput.js';

const multilinkText = readFileSync(
  fileURLToPath(new URL('./fixtures/synthetic-opt-freq-multilink.out', import.meta.url)),
  'utf8',
);
const parsed = parseGaussianOutput(multilinkText);

describe('multi-link Gaussian parsing', () => {
  it('labels the fixture synthetic before any Gaussian-looking record', () => {
    const firstLine = multilinkText.split('\n')[0];
    expect(firstLine).toContain('FIXTURE OUTPUT');
    expect(firstLine.toLowerCase()).toContain('synthetic');
    expect(firstLine).not.toContain('Entering Gaussian');
  });

  it('splits a two-link job on --Link1--', () => {
    expect(parsed.links).toHaveLength(2);
    expect(parsed.links.map((link) => link.index)).toEqual([0, 1]);
    expect(parsed.links.map((link) => link.termination)).toEqual(['normal', 'normal']);
    expect(parsed.links[0].line).toBe(1);
    expect(parsed.links[1].line).toBeGreaterThan(parsed.links[0].line);
  });

  it('regression: imaginary modes come from the frequency link, not every Frequencies line', () => {
    // The Opt=CalcAll link carries an intermediate Hessian with one imaginary
    // mode at step 1. Flattening every Frequencies line would report that mode
    // against the final structure and fail a minimum gate.
    const optLink = parsed.links[0];
    expect(optLink.frequencyBlocks).toHaveLength(2);
    expect(optLink.frequencyBlocks[0].imaginaryCount).toBe(1);
    expect(optLink.frequencyBlocks[0].imaginaryValues).toEqual([-25.6]);
    expect(optLink.frequencyBlocks[1].imaginaryCount).toBe(0);

    const finalLink = parsed.links[1];
    expect(finalLink.frequencyBlocks).toHaveLength(1);

    // Root-level summary is the frequency link alone.
    expect(parsed.frequencies.count).toBe(4);
    expect(parsed.frequencies.values).toEqual([610, 1580, 3650, 3760]);
    expect(parsed.frequencies.values).not.toContain(-25.6);
    expect(parsed.frequencies.imaginaryCount).toBe(0);
    expect(parsed.frequencies.minImaginary).toBeNull();

    const gates = evaluateGates(parsed, { expectedImaginary: 0, requireFrequency: true });
    expect(gates.overall).toBe('pass');
    expect(gates.gates.find((gate) => gate.name === 'Imaginary mode count').result).toBe('pass');
  });

  it('keeps a per-link frequency summary that does not leak across links', () => {
    expect(parsed.links[0].frequencies.count).toBe(4);
    expect(parsed.links[0].frequencies.imaginaryCount).toBe(0);
    expect(parsed.links[0].frequencies.values).toEqual([612.4, 1581.2, 3651, 3762]);
    expect(parsed.links[1].frequencies.values).toEqual([610, 1580, 3650, 3760]);
  });

  it('takes the final SCF record and free energy from the last relevant link', () => {
    expect(parsed.scf.energyHartree).toBeCloseTo(-76, 9);
    expect(parsed.scf.cycles).toBe(1);
    expect(parsed.thermochemistry.freeEnergyHartree).toBeCloseTo(-76.02, 9);
    expect(parsed.links[0].thermochemistry.freeEnergyHartree).toBeNull();
  });
});
