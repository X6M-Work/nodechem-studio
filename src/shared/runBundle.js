/**
 * Publishable run-bundle layout and text for NodeChem Studio.
 *
 * Pure module: no filesystem, no Electron, no archive library and no network.
 * It validates the names a bundle may contain, generates `methods.md` from the
 * run record, writes the README and builds the manifest shape. The Electron
 * writer (`electron/runner/runBundle.js`) performs the only file I/O.
 *
 * A bundle is a folder, not a zip: `manifest.json` hashes every other file so
 * `sha256sum` can verify the copy without a proprietary archive reader.
 */

import { methodsParagraphFor } from './methodsParagraph.js';

export const RUN_BUNDLE_KIND = 'nodechem-studio-run-bundle';
export const RUN_BUNDLE_VERSION = 1;

export const RUN_BUNDLE_FILES = Object.freeze({
  manifest: 'manifest.json',
  methods: 'methods.md',
  readme: 'README.md',
});

const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_FILE_NAME = /^[A-Za-z0-9._-]{1,128}$/;
const INPUT_NAME = /^[A-Za-z0-9._-]+\.(gjf|com|xyz)$/i;
const OUTPUT_NAME = /^[A-Za-z0-9._-]+\.(out|log)$/i;

function clean(value) {
  return String(value ?? '').trim();
}

export function isSafeRunId(value) {
  return typeof value === 'string' && SAFE_RUN_ID.test(value);
}

/**
 * A bundle file name is one path segment: no separators, no leading dot, no
 * `..`, and only characters that are portable on Windows, Linux and macOS.
 */
export function isSafeBundleFileName(value) {
  if (typeof value !== 'string' || !SAFE_FILE_NAME.test(value)) return false;
  if (value === '.' || value === '..') return false;
  if (value.startsWith('.')) return false;
  return true;
}

export function bundleRunId(record = {}) {
  const id = clean(record?.id);
  if (!isSafeRunId(id)) {
    throw new Error('Run bundle needs a safe run id in run.json.');
  }
  return id;
}

/**
 * Resolve and validate every file name the bundle will contain. The input and
 * output come from the run record, which is untrusted on disk: a path
 * separator, a traversal segment or an unexpected extension is refused.
 */
export function bundleFileNamesFor(record = {}) {
  const inputName = clean(record?.inputName);
  if (!isSafeBundleFileName(inputName) || !INPUT_NAME.test(inputName)) {
    throw new Error(
      `Run bundle input name "${inputName}" must be a safe .gjf, .com or .xyz basename.`,
    );
  }

  const outputName = clean(record?.outputFile || record?.outputName);
  if (!isSafeBundleFileName(outputName) || !OUTPUT_NAME.test(outputName)) {
    throw new Error(
      `Run bundle output name "${outputName}" must be a safe .out or .log basename.`,
    );
  }

  if (inputName === outputName) {
    throw new Error('Run bundle input and output files must have different names.');
  }

  return {
    inputName,
    outputName,
    methods: RUN_BUNDLE_FILES.methods,
    readme: RUN_BUNDLE_FILES.readme,
    manifest: RUN_BUNDLE_FILES.manifest,
  };
}

/** `methods.md` is a real paragraph only for a real run; a fixture gets a refusal. */
export function buildMethodsMarkdown(record = {}) {
  const paragraph = methodsParagraphFor(record, { form: 'full' });
  if (paragraph.ok) return `${paragraph.markdown}\n`;
  return [
    '# Methods',
    '',
    'No methods paragraph is provided for this run.',
    '',
    paragraph.message,
    '',
    'This file is part of a NodeChem Studio run bundle. It deliberately does not describe '
      + 'a dry-run fixture as a real calculation.',
    '',
  ].join('\n');
}

function fixtureWarning(record) {
  const kind = clean(record?.provenance?.kind).toLowerCase();
  const dryRun = record?.dryRun === true;
  const source = clean(record?.outputSource).toLowerCase();
  if (kind !== 'fixture' && !dryRun && source !== 'fixture') return [];
  return [
    '## Fixture warning',
    '',
    'This run is a dry-run fixture. Its output is synthetic and is **not** a calculation. '
      + 'Do not cite it as computed data or present it as a result.',
    '',
  ];
}

function roleFor(name, names) {
  const safeNames = names || {};
  if (name === safeNames.inputName) return 'the exact input file copied from the run folder';
  if (name === safeNames.outputName) return 'the output file that was parsed for this run';
  if (name === RUN_BUNDLE_FILES.methods) return 'the methods paragraph generated from run.json';
  if (name === RUN_BUNDLE_FILES.manifest) return 'sha256 hashes, sizes, run id, app version/commit and provenance kind';
  if (name === RUN_BUNDLE_FILES.readme) return 'this file';
  return 'a bundle file';
}

function hashLine(label, value) {
  return `- ${label}: ${value || 'not recorded in run.json'}`;
}

function matchLine(label, value) {
  if (value === true) return `- ${label}: matches the recorded hash`;
  if (value === false) return `- ${label}: DOES NOT match the recorded hash; the run folder changed after the run`;
  return `- ${label}: no recorded hash to compare`;
}

/**
 * README text: what the folder contains, what its hashes cover, and the things
 * a hash can never establish. Kept plain text so it renders on GitHub as well
 * as in an editor.
 */
export function buildBundleReadme(record = {}, { names, files = [], createdAt, manifest } = {}) {
  const id = clean(record?.id) || 'unknown run';
  const appVersion = clean(record?.app?.version) || 'unknown';
  const appCommit = clean(record?.app?.commit) || 'unknown';
  const kind = clean(record?.provenance?.kind) || 'not recorded';
  const listed = files.map((file) => `- \`${file.name}\` — ${roleFor(file.name, names)}`).join('\n');
  const hashChecks = manifest?.hashMatchesRunRecord || {};
  const lines = [
    `# Run bundle — ${id}`,
    '',
    `Created ${createdAt || 'unknown time'} by NodeChem Studio ${appVersion} (commit ${appCommit}).`,
    '',
    'This folder records one NodeChem Studio run: the exact input, the parsed output and the '
      + 'methods text, with a manifest that hashes each file. It contains no executable, no '
      + 'licence and no archive.',
    '',
    ...fixtureWarning(record),
    '## Contents',
    '',
    listed,
    '',
    '`manifest.json` is written last and lists every other file in this folder; it cannot '
      + 'contain its own hash. Verify the copy from this directory with:',
    '',
    '```bash',
    `sha256sum ${files.map((file) => `'${file.name}'`).join(' ')}`,
    '```',
    '',
    '## Provenance recorded in run.json',
    '',
    hashLine('Run id', id),
    hashLine('Provenance kind', kind),
    hashLine('Engine', clean(record?.engine)),
    hashLine('Run status', clean(record?.status)),
    hashLine('Input file', names?.inputName),
    hashLine('Output file', names?.outputName),
    hashLine('Recorded input sha256', clean(record?.inputSha256)),
    hashLine('Recorded output sha256', clean(record?.outputSha256)),
    '',
    matchLine('Input hash at bundle time', hashChecks.input),
    matchLine('Output hash at bundle time', hashChecks.output),
    '',
    '## What this bundle can prove',
    '',
    '- The files listed in `manifest.json` had the recorded sha256 and byte size when the '
      + 'bundle was written. Re-hashing them detects later edits or truncation.',
    '- `methods.md` was generated from the source `run.json` only; a field absent there is '
      + 'named as not recorded, never filled in from a default.',
    '- `manifest.json` records the run id, app version/commit, provenance kind, and the hash '
      + 'and size of every other file in this folder.',
    '',
    '## What this bundle cannot prove',
    '',
    '- It cannot prove that the calculation was actually executed, or that a licensed copy of '
      + 'the program produced the output. It is a copy of files, not an attestation.',
    '- It cannot prove that the output or input was unmodified before the bundle was written: '
      + 'the hashes describe the files at bundle time, not their history.',
    '- It cannot prove that the calculation converged, that the gates were evaluated correctly, '
      + 'or that the result is scientifically valid. The parsed blocks and gate results from the '
      + 'source run record are not reproduced in this folder; `manifest.json` carries only the run '
      + 'id, app version/commit and provenance kind. A gate result is the app\'s evaluation, not '
      + 'an independent audit.',
    '- It cannot reproduce the calculation on its own. The program, its version, its licence, '
      + 'the hardware and the scratch environment are not included and must be supplied by the '
      + 'person re-running the input.',
    '- It cannot establish the provenance of the geometry or the identity of a conformer or '
      + 'protomer beyond what `run.json` records; where that is absent, `methods.md` says so.',
    '',
  ];
  return lines.join('\n');
}

/**
 * Build the manifest object. `files` must describe files already on disk, with
 * their sha256 and byte size. `createdAt` is supplied by the caller so the
 * output is deterministic in tests and the record carries the real time in the
 * app.
 */
export function buildBundleManifest(record = {}, { files = [], createdAt } = {}) {
  const runId = bundleRunId(record);
  const byName = new Map(files.map((file) => [file.name, file]));
  const inputFile = byName.get(clean(record?.inputName)) || null;
  const outputName = clean(record?.outputFile || record?.outputName);
  const outputFile = byName.get(outputName) || null;
  const compare = (file, recorded) => {
    const expected = clean(recorded);
    if (!file || !expected) return null;
    return file.sha256 === expected;
  };

  return {
    kind: RUN_BUNDLE_KIND,
    schemaVersion: RUN_BUNDLE_VERSION,
    createdAt: createdAt ? new Date(createdAt).toISOString() : null,
    runId,
    engine: clean(record?.engine) || null,
    runStatus: clean(record?.status) || null,
    app: {
      version: clean(record?.app?.version) || 'unknown',
      commit: clean(record?.app?.commit) || 'unknown',
    },
    provenanceKind: clean(record?.provenance?.kind) || null,
    recordedHashes: {
      inputSha256: clean(record?.inputSha256) || null,
      outputSha256: clean(record?.outputSha256) || null,
    },
    hashMatchesRunRecord: {
      input: compare(inputFile, record?.inputSha256),
      output: compare(outputFile, record?.outputSha256),
    },
    files: files.map((file) => ({
      name: file.name,
      sha256: file.sha256,
      bytes: file.bytes,
    })),
  };
}
