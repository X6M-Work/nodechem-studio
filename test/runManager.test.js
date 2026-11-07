import { describe, it, expect, afterEach } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RunManager } from '../electron/runner/runManager.js';

const roots = [];

async function makeManager() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'gaussian-studio-run-'));
  roots.push(root);
  const events = [];
  const manager = new RunManager({ runsRoot: root, emit: (event) => events.push(event) });
  return { manager, events, root };
}

function waitForDone(events) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const done = events.find((event) => event.type === 'done');
      if (done) { clearInterval(timer); resolve(done); }
      else if (Date.now() - started > 3000) { clearInterval(timer); reject(new Error('run did not finish')); }
    }, 20);
  });
}

afterEach(async () => {
  await Promise.all(roots.map((root) => fsp.rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

describe('RunManager dry-run path', () => {
  it('writes a run record and evaluates the fixture output', async () => {
    const { manager, events, root } = await makeManager();
    const response = await manager.start({
      title: 'Fixture frequency',
      inputText: '%Chk=fixture.chk\n#p B3LYP/6-31G(d) Freq\n\nFixture\n\n0 1\nO 0 0 0\n',
      inputName: 'fixture.gjf',
      outputName: 'fixture.out',
      dryRun: true,
      gates: { expectedImaginary: 0, minMagnitude: 50, requireFrequency: true },
    });
    const done = await waitForDone(events);
    expect(done.runId).toBe(response.runId);
    expect(done.record.status).toBe('completed');
    expect(done.record.gates.overall).toBe('pass');
    expect(done.record.dryRun).toBe(true);

    const runJson = JSON.parse(await fsp.readFile(path.join(root, response.runId, 'run.json'), 'utf8'));
    expect(runJson.status).toBe('completed');
    expect(runJson.gates.overall).toBe('pass');
    expect(runJson.parsed.termination).toBe('Normal termination of Gaussian');
  });

  it('lists completed runs newest first', async () => {
    const { manager, events } = await makeManager();
    await manager.start({
      inputText: '#p HF/STO-3G SP\n\nFixture\n\n0 1\nH 0 0 0\n',
      inputName: 'a.gjf',
      outputName: 'a.out',
      dryRun: true,
      gates: {},
    });
    await waitForDone(events);
    const list = await manager.list();
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('completed');
  });
});
