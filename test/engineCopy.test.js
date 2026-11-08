import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BROWSER_PREVIEW_RUN_MESSAGE,
  checkpointHandoffNote,
  dryRunHintFor,
  executableLabelFor,
  runEngineLabel,
} from '../src/renderer/engineCopy.js';

/**
 * Issue #43 — the product has two engines, and the copy must say so.
 *
 * The unit assertions pin the engine-aware helpers; the source scan is the
 * drift guard. Each string in `STALE_CLAIMS` is a specific sentence the
 * Gaussian-only product shipped, so restoring any of them fails this file
 * rather than quietly misleading an xTB user again.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function rendererFiles(relDir = 'src/renderer') {
  const absolute = path.join(ROOT, relDir);
  return fs.readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => path.posix.join(relDir, entry.name));
}

const README = read('README.md');
const HTML = read('index.html');
const RENDERER = rendererFiles().map((rel) => ({ rel, text: read(rel) }));

/** Exact sentences removed in issue #43. Any one of them is a regression. */
const STALE_CLAIMS = [
  'Open the desktop app to start a local Gaussian run.',
  'Dry run writes a synthetic log and evaluates the parser. Uncheck to launch the licensed Gaussian installation.',
  'Preview project · choose a calculation block to run the local Gaussian slice',
  'no Gaussian job has been run',
  'the runner builds real Gaussian input',
  'Gaussian run console',
  'Validation found a blocking issue in a transition-state block.',
  '<label for="run-exe">Gaussian executable</label>',
];

describe('issue #43 — stale Gaussian-only copy cannot drift back', () => {
  it('keeps every removed sentence out of the README, the renderer shell and src/renderer', () => {
    const surfaces = [{ rel: 'README.md', text: README }, { rel: 'index.html', text: HTML }, ...RENDERER];
    for (const claim of STALE_CLAIMS) {
      const offenders = surfaces.filter(({ text }) => text.includes(claim)).map(({ rel }) => rel);
      expect(offenders, `stale copy: "${claim}"`).toEqual([]);
    }
  });

  it('describes the dry run as a fixture, never as a Gaussian log', () => {
    expect(HTML).toContain('Dry run (fixture output)');
    expect(HTML).toContain('synthetic fixture log');
    expect(README).toContain('A dry run is a fixture for both engines');
    expect(README).toContain('FIXTURE OUTPUT');
  });

  it('keeps the executable field label addressable so it can name the engine', () => {
    expect(HTML).toContain('id="run-exe-label"');
  });
});

describe('issue #43 — README documents both engines', () => {
  it('has an Engines section that names both engines and every xTB method', () => {
    expect(README).toMatch(/^## Engines$/m);
    expect(README).toContain('Gaussian 16');
    expect(README).toContain('GFN0-xTB');
    expect(README).toContain('GFN1-xTB');
    expect(README).toContain('GFN2-xTB');
    expect(README).toContain('GFN-FF');
  });

  it('explains what each engine cannot do and that xTB is not a Gaussian substitute', () => {
    expect(README).toContain('An xTB run is not a substitute for a Gaussian result');
    expect(README).toContain('No transition-state search (`Opt=TS`), no IRC and no PES scan');
    expect(README).toContain('No validity checks');
    expect(README).toContain('No checkpoint hand-off');
    expect(README).toContain('licensed separately by Gaussian, Inc.');
  });

  it('documents the xTB setup path end to end', () => {
    expect(README).toContain('### Setting up xTB');
    expect(README).toContain('share/xtb');
    expect(README).toContain('XTBPATH');
    expect(README).toContain('xtb.exe');
    expect(README).toContain('xTB executable');
    expect(README).toContain('`<input>.out`');
    expect(README).toContain('`xtbopt.xyz`');
  });

  it('has a settings-ownership table for the two engines', () => {
    expect(README).toMatch(/^### Which settings belong to which engine$/m);
    expect(README).toContain('| Setting | Gaussian 16 | xTB |');
    expect(README).toContain('ALPB / GBSA (builder only; not in the current inspector)');
    expect(README).toContain('Not supported');
  });
});

describe('issue #43 — engine-aware helper copy', () => {
  it('names xTB, not Gaussian, in the xTB dry-run hint', () => {
    const hint = dryRunHintFor('xtb');
    expect(hint).toContain('xTB');
    expect(hint).toContain('fixture');
    expect(hint).not.toMatch(/Gaussian/i);
  });

  it('keeps the licence wording for a Gaussian dry run', () => {
    const hint = dryRunHintFor('gaussian');
    expect(hint).toContain('fixture');
    expect(hint).toContain('licensed Gaussian 16 installation');
  });

  it('makes the browser-preview message engine-neutral', () => {
    expect(BROWSER_PREVIEW_RUN_MESSAGE).toBe('Open the desktop app to start a local run.');
    expect(BROWSER_PREVIEW_RUN_MESSAGE).not.toMatch(/Gaussian|xTB/i);
  });

  it('labels the executable field with the engine that will run', () => {
    expect(executableLabelFor('xtb')).toBe('xTB executable');
    expect(executableLabelFor('gaussian')).toBe('Gaussian 16 executable');
  });

  it('reports the run engine instead of assuming Gaussian', () => {
    expect(runEngineLabel('xtb')).toBe('xTB (GFN-xTB)');
    expect(runEngineLabel('gaussian')).toBe('Gaussian 16');
    expect(runEngineLabel('xtb', { dryRun: true })).toBe('dry run');
  });

  it('does not promise Gaussian checkpoint keywords to an xTB block', () => {
    expect(checkpointHandoffNote('gaussian')).toContain('%OldChk');
    const xtb = checkpointHandoffNote('xtb');
    expect(xtb).toContain('xtbrestart');
    expect(xtb).not.toContain('%OldChk');
  });
});
