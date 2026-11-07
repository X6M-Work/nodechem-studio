import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { routeFor } from '../src/shared/gaussianInput.js';
import {
  SCHEMA_VERSION,
  defaultGates,
  defaultSettings,
  kindForJob,
  parseProjectText,
  stringifyProject,
  validateProject,
} from '../src/shared/projectSchema.js';
import {
  DEFAULT_TS_FORCE_CONSTANTS,
  TS_FORCE_CONSTANT_IDS,
  checkTsForceConstants,
  forceConstantsFor,
  jobKeywordFor,
} from '../src/shared/tsForceConstants.js';

function baseProject(nodes, edges = []) {
  return {
    schemaVersion: SCHEMA_VERSION,
    name: 'TS force constants',
    molecule: {
      smiles: 'C=CC=C.C=C',
      charge: 0,
      multiplicity: 1,
      fragments: ['C=CC=C', 'C=C'],
      coords: [],
      geometry: { source: 'demo', file: '', format: '' },
    },
    defaults: { method: 'B3LYP', basis: 'def2-SVP', memory: '4', memoryUnit: 'GB', nproc: 4 },
    nodes,
    edges,
  };
}

function calcNode(id, title, settings = {}, extra = {}) {
  return {
    id,
    type: 'calc',
    kind: kindForJob(settings.jobType || 'Opt'),
    title,
    state: 'ready',
    x: 0,
    y: 0,
    settings: defaultSettings(settings),
    output: null,
    checkpointFrom: null,
    ...extra,
  };
}

const checkpointEdge = (from, to) => ({
  from, to, type: 'checkpoint', fromPort: 'bottom', toPort: 'top',
});

describe('issue #15 — the force-constant options', () => {
  it('defaults to CalcFC and never invents a fifth choice', () => {
    expect(DEFAULT_TS_FORCE_CONSTANTS).toBe('CalcFC');
    expect(TS_FORCE_CONSTANT_IDS).toEqual(['CalcFC', 'CalcAll', 'ReadFC', 'default']);
    expect(defaultSettings().forceConstants).toBe('CalcFC');
    expect(forceConstantsFor({ forceConstants: 'not-a-choice' })).toBe('CalcFC');
  });

  it('maps every choice to exactly one Opt group', () => {
    const expected = {
      CalcFC: 'Opt=(TS,CalcFC,NoEigenTest)',
      CalcAll: 'Opt=(TS,CalcAll)',
      ReadFC: 'Opt=(TS,ReadFC)',
      default: 'Opt=TS',
    };
    for (const choice of TS_FORCE_CONSTANT_IDS) {
      const keyword = jobKeywordFor({ jobType: 'Opt=TS', forceConstants: choice });
      expect(keyword).toBe(expected[choice]);
      expect(keyword.match(/Opt/g)).toHaveLength(1);
    }
  });

  it('does not apply force constants to a non-TS job', () => {
    expect(jobKeywordFor({ jobType: 'Freq', forceConstants: 'CalcFC' })).toBe('Freq');
    expect(jobKeywordFor({ jobType: 'SP', forceConstants: 'CalcAll' })).toBe('SP');
  });
});

describe('issue #15 — ReadFC needs a checkpoint that holds force constants', () => {
  const readFc = (overrides = {}) => defaultSettings({
    jobType: 'Opt=TS', forceConstants: 'ReadFC', ...overrides,
  });

  it('fails with a specific message when the TS block has no checkpoint edge', () => {
    const { errors, warnings } = checkTsForceConstants({ settings: readFc(), upstream: null });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/ReadFC/);
    expect(errors[0]).toMatch(/no checkpoint hand-off/);
    expect(errors[0]).toMatch(/Freq or Opt=CalcFC/);
    expect(warnings).toEqual([]);
  });

  it('names the upstream job when it cannot have written force constants', () => {
    const upstream = {
      id: 'r-opt',
      title: 'Reactant optimization',
      settings: defaultSettings({ jobType: 'Opt' }),
    };
    const { errors } = checkTsForceConstants({ settings: readFc(), upstream });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"Reactant optimization"');
    expect(errors[0]).toContain('is Opt and does not write them');
  });

  it('accepts a Freq upstream and an Opt=CalcFC upstream', () => {
    const freq = { id: 'r-freq', title: 'Reactant frequency', settings: defaultSettings({ jobType: 'Freq' }) };
    const optCalcFc = {
      id: 'r-opt',
      title: 'Reactant optimization',
      settings: defaultSettings({ jobType: 'Opt=TS', forceConstants: 'CalcFC' }),
    };
    expect(checkTsForceConstants({ settings: readFc(), upstream: freq }).errors).toEqual([]);
    expect(checkTsForceConstants({ settings: readFc(), upstream: optCalcFc }).errors).toEqual([]);
  });

  it('rejects an upstream that only computes curvature with CalcAll', () => {
    const upstream = {
      id: 'r-opt',
      title: 'Reactant optimization',
      settings: defaultSettings({ jobType: 'Opt=TS', forceConstants: 'CalcAll' }),
    };
    const { errors } = checkTsForceConstants({ settings: readFc(), upstream });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Freq or Opt=CalcFC/);
  });

  it('warns — but never blocks — the estimated-Hessian default', () => {
    const settings = defaultSettings({ jobType: 'Opt=TS', forceConstants: 'default' });
    const { errors, warnings } = checkTsForceConstants({ settings, upstream: null });
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/estimated initial Hessian/);
    expect(warnings[0]).toContain('CalcFC is the safe default');
  });

  it('says nothing for CalcFC and CalcAll', () => {
    for (const forceConstants of ['CalcFC', 'CalcAll']) {
      const settings = defaultSettings({ jobType: 'Opt=TS', forceConstants });
      expect(checkTsForceConstants({ settings, upstream: null })).toEqual({ errors: [], warnings: [] });
    }
  });

  it('does not apply TS rules to a non-TS job that stores a force-constant value', () => {
    const settings = defaultSettings({ jobType: 'Freq', forceConstants: 'default' });
    expect(checkTsForceConstants({ settings, upstream: null })).toEqual({ errors: [], warnings: [] });
  });
});

describe('issue #15 — project validation', () => {
  it('fails ReadFC without a checkpoint edge and points at the field', () => {
    const result = validateProject(baseProject([
      calcNode('r-opt', 'Reactant optimization', { jobType: 'Opt', checkpoint: 'r_opt.chk' }),
      calcNode('ts-opt', 'TS guess optimization', {
        jobType: 'Opt=TS', forceConstants: 'ReadFC', checkpoint: 'ts_opt.chk',
      }),
    ], [{ from: 'r-opt', to: 'ts-opt', type: 'dependency', fromPort: 'right', toPort: 'left' }]));

    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toBe('nodes[1].settings.forceConstants');
    expect(result.errors[0].message).toMatch(/no checkpoint hand-off/);
  });

  it('fails ReadFC when the checkpoint edge comes from an Opt block', () => {
    const result = validateProject(baseProject([
      calcNode('r-opt', 'Reactant optimization', { jobType: 'Opt', checkpoint: 'r_opt.chk' }),
      calcNode('ts-opt', 'TS guess optimization', {
        jobType: 'Opt=TS', forceConstants: 'ReadFC', checkpoint: 'ts_opt.chk',
      }),
    ], [checkpointEdge('r-opt', 'ts-opt')]));

    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toBe('nodes[1].settings.forceConstants');
    expect(result.errors[0].message).toContain('"Reactant optimization"');
    expect(result.errors[0].message).toMatch(/Freq or Opt=CalcFC/);
  });

  it('accepts ReadFC when a Freq block is the checkpoint source', () => {
    const result = validateProject(baseProject([
      calcNode('r-freq', 'Reactant frequency', { jobType: 'Freq', checkpoint: 'r_freq.chk' }),
      calcNode('ts-opt', 'TS guess optimization', {
        jobType: 'Opt=TS', forceConstants: 'ReadFC', checkpoint: 'ts_opt.chk',
      }, { checkpointFrom: 'r-freq' }),
    ], [checkpointEdge('r-freq', 'ts-opt')]));

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('warns about Default (unsafe) without failing the project', () => {
    const result = validateProject(baseProject([
      calcNode('ts-opt', 'TS guess optimization', {
        jobType: 'Opt=TS', forceConstants: 'default', checkpoint: 'ts_opt.chk',
      }),
    ]));

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].path).toBe('nodes[0].settings.forceConstants');
    expect(result.warnings[0].message).toMatch(/estimated initial Hessian/);
  });

  it('round-trips the choice byte-stably', () => {
    const result = validateProject(baseProject([
      calcNode('r-freq', 'Reactant frequency', { jobType: 'Freq', checkpoint: 'r_freq.chk' }),
      calcNode('ts-opt', 'TS guess optimization', {
        jobType: 'Opt=TS', forceConstants: 'ReadFC', checkpoint: 'ts_opt.chk',
      }, { checkpointFrom: 'r-freq' }),
    ], [checkpointEdge('r-freq', 'ts-opt')]));

    const saved = stringifyProject(result.project);
    expect(saved.ok).toBe(true);
    expect(saved.text).toContain('"forceConstants": "ReadFC"');
    expect(stringifyProject(parseProjectText(saved.text).project).text).toBe(saved.text);
  });

  it('migrates an older TS block that has no stored choice to CalcFC', () => {
    const legacy = {
      name: 'Old TS project',
      molecule: {
        smiles: 'C=CC=C.C=C',
        charge: 0,
        multiplicity: 1,
        fragments: ['C=CC=C', 'C=C'],
        coords: [],
      },
      defaults: { method: 'B3LYP', basis: '6-31G(d)', memory: '4', memoryUnit: 'GB', nproc: 4 },
      nodes: [{
        id: 'ts-opt',
        type: 'calc',
        kind: 'TS',
        title: 'TS guess optimization',
        state: 'ready',
        x: 0,
        y: 0,
        settings: {
          jobType: 'Opt=TS',
          method: 'B3LYP',
          basis: '6-31G(d)',
          memory: '4',
          memoryUnit: 'GB',
          nproc: '4',
          checkpoint: 'ts_opt.chk',
          charge: 0,
          multiplicity: 1,
          dispersion: '',
          scf: '',
          grid: '',
          population: '',
          verbosity: '',
          solvation: false,
          solvationModel: 'PCM',
          solvent: 'Water',
          customKeywords: '',
          ircDirection: 'forward',
          gates: defaultGates(),
        },
        output: null,
        checkpointFrom: null,
      }],
      edges: [],
    };

    const result = validateProject(legacy);
    expect(result.ok).toBe(true);
    expect(result.migrated).toBe(true);
    const node = result.project.nodes[0];
    expect(node.settings.forceConstants).toBe('CalcFC');
    expect(routeFor(node.settings)).toBe('#p B3LYP/6-31G(d) Opt=(TS,CalcFC,NoEigenTest)');
  });

  it('warns when extra keywords add their own Opt keyword', () => {
    const result = validateProject(baseProject([
      calcNode('ts-opt', 'TS guess optimization', {
        jobType: 'Opt=TS', checkpoint: 'ts_opt.chk', customKeywords: 'Opt=(TS,CalcAll)',
      }),
    ]));

    expect(result.ok).toBe(true);
    expect(result.warnings.some((warning) => warning.path === 'nodes[0].settings.customKeywords')).toBe(true);
  });
});

describe('issue #15 — seeded Diels–Alder project', () => {
  const source = readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');

  it('seeds the TS block with the safe force-constant form', () => {
    const block = source.match(/calcNode\('ts-opt'[\s\S]*?\}\),/);
    expect(block).not.toBeNull();
    expect(block[0]).toContain("jobType: 'Opt=TS'");
    expect(block[0]).toContain("forceConstants: 'CalcFC'");
    expect(source).not.toMatch(/forceConstants:\s*'default'/);
  });

  it('emits the safe route for the seeded TS settings', () => {
    const seeded = defaultSettings({
      jobType: 'Opt=TS', forceConstants: 'CalcFC', checkpoint: 'ts_opt.chk',
    });
    expect(routeFor(seeded))
      .toBe('#p B3LYP/def2-SVP Opt=(TS,CalcFC,NoEigenTest) EmpiricalDispersion=GD3BJ');
  });
});

describe('issue #15 — documentation', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

  it('explains why CalcFC is the transition-state default', () => {
    expect(readme).toContain('Opt=(TS,CalcFC,NoEigenTest)');
    expect(readme).toContain('`CalcFC` (default)');
    expect(readme).toMatch(/default\s+approximate Hessian must always be improved/);
    expect(readme).toContain('`ReadFC` needs an explicit checkpoint edge');
  });
});
