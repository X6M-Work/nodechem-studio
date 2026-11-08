/**
 * Run-bundle file writer for NodeChem Studio.
 *
 * This is the only module that touches the filesystem for a publishable run
 * bundle. It copies the exact input and parsed output, writes `methods.md` and
 * `README.md`, hashes every file on disk, and writes `manifest.json` last.
 *
 * Safety rules:
 * - every name comes from the validated shared layout;
 * - the target folder must be absent or empty, and files are opened with
 *   exclusive-create flags, so a previous bundle is never overwritten;
 * - no archive library, no shell and no network.
 */

import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { sha256File } from './hashing.js';
import {
  RUN_BUNDLE_FILES,
  buildBundleManifest,
  buildBundleReadme,
  buildMethodsMarkdown,
  bundleFileNamesFor,
  bundleRunId,
  isSafeBundleFileName,
} from '../../src/shared/runBundle.js';

const FIXED_NAMES = new Set(Object.values(RUN_BUNDLE_FILES));

async function readRecord(runDir) {
  const file = path.join(runDir, 'run.json');
  let text;
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('The run folder has no run.json; there is nothing to bundle.');
    }
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`The run record is not valid JSON: ${error.message}`);
  }
}

async function requireFile(file, label) {
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat?.isFile()) {
    throw new Error(`The run bundle ${label} is missing from the run folder: ${path.basename(file)}`);
  }
  return stat;
}

/**
 * Create the target only when it does not exist or is an empty real folder.
 * Returns true when this call created the folder.
 */
async function prepareTarget(target) {
  const stat = await fsp.lstat(target).catch(() => null);
  if (!stat) {
    await fsp.mkdir(target, { recursive: true });
    return true;
  }
  if (stat.isSymbolicLink()) {
    throw new Error('Refusing to write a run bundle through a symbolic link. Choose a real folder.');
  }
  if (!stat.isDirectory()) {
    throw new Error(`The run bundle target exists and is not a folder: ${target}`);
  }
  const entries = await fsp.readdir(target);
  if (entries.length > 0) {
    throw new Error(
      `Refusing to overwrite a non-empty folder: ${target}. Choose a new folder for this bundle.`,
    );
  }
  return false;
}

async function writeText(file, text) {
  await fsp.writeFile(file, text, { encoding: 'utf8', flag: 'wx' });
}

async function describe(file, name) {
  const stat = await fsp.stat(file);
  return { name, bytes: stat.size, sha256: await sha256File(file) };
}

/**
 * Export one run folder as a self-contained bundle folder.
 *
 * @param {{runDir: string, bundleDir: string, createdAt?: string|Date}} options
 * @returns {Promise<{canceled: false, path: string, runId: string, files: string[], manifest: object}>}
 */
export async function writeRunBundle({ runDir, bundleDir, createdAt = new Date() } = {}) {
  if (!runDir) throw new Error('A run folder is required for the run bundle.');
  if (!bundleDir) throw new Error('A target folder is required for the run bundle.');

  const sourceDir = path.resolve(String(runDir));
  const targetDir = path.resolve(String(bundleDir));
  const sourceStat = await fsp.stat(sourceDir).catch(() => null);
  if (!sourceStat?.isDirectory()) {
    throw new Error('The run folder for this bundle does not exist.');
  }

  const record = await readRecord(sourceDir);
  const runId = bundleRunId(record);
  const names = bundleFileNamesFor(record);

  // Validate every name once more before any directory is created.
  for (const name of Object.values(names)) {
    if (!isSafeBundleFileName(name)) {
      throw new Error(`Run bundle file name "${name}" is not a safe single path segment.`);
    }
    if (FIXED_NAMES.has(name) && name !== names.methods && name !== names.readme && name !== names.manifest) {
      throw new Error(`Run bundle file name "${name}" collides with a reserved bundle file.`);
    }
  }

  const inputPath = path.join(sourceDir, names.inputName);
  const outputPath = path.join(sourceDir, names.outputName);
  await requireFile(inputPath, 'input file');
  await requireFile(outputPath, 'output file');

  const createdTarget = await prepareTarget(targetDir);

  try {
    await fsp.copyFile(inputPath, path.join(targetDir, names.inputName), fs.constants.COPYFILE_EXCL);
    await fsp.copyFile(outputPath, path.join(targetDir, names.outputName), fs.constants.COPYFILE_EXCL);
    await writeText(path.join(targetDir, names.methods), buildMethodsMarkdown(record));

    // Hash the copied input/output before the README is written: the README
    // reports whether they still match the hashes recorded in run.json.
    const copied = [];
    for (const name of [names.inputName, names.outputName, names.methods]) {
      copied.push(await describe(path.join(targetDir, name), name));
    }
    const inputFile = copied.find((file) => file.name === names.inputName);
    const outputFile = copied.find((file) => file.name === names.outputName);
    const hashMatchesRunRecord = {
      input: inputFile && record.inputSha256 ? inputFile.sha256 === record.inputSha256 : null,
      output: outputFile && record.outputSha256 ? outputFile.sha256 === record.outputSha256 : null,
    };

    // README is written before the manifest so the manifest can cover it like
    // every other non-manifest file.
    const readme = buildBundleReadme(record, {
      names,
      files: [
        { name: names.inputName },
        { name: names.outputName },
        { name: names.methods },
        { name: names.readme },
        { name: names.manifest },
      ],
      createdAt: new Date(createdAt).toISOString(),
      manifest: { hashMatchesRunRecord },
    });
    await writeText(path.join(targetDir, names.readme), readme);

    const files = [...copied, await describe(path.join(targetDir, names.readme), names.readme)];

    const manifest = buildBundleManifest(record, { files, createdAt });
    await writeText(
      path.join(targetDir, names.manifest),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    return {
      canceled: false,
      path: targetDir,
      runId,
      files: [...files.map((file) => file.name), names.manifest],
      manifest,
    };
  } catch (error) {
    // A folder this call created contains only this failed bundle. Leave an
    // existing empty folder alone; the user chose it.
    if (createdTarget) {
      await fsp.rm(targetDir, { recursive: true, force: true }).catch(() => {});
    }
    throw error;
  }
}
