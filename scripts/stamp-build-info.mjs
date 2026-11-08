#!/usr/bin/env node
/**
 * Stamp the commit that was built into the packaged app. Runtime environment
 * variables are not inherited by an installed application, so the value has
 * to be written beside the main process before electron-builder packs it.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const commit = String(process.env.GIT_COMMIT || process.env.GITHUB_SHA || gitCommit() || 'unknown').trim();
const target = new URL('../electron/build-info.json', import.meta.url);
writeFileSync(target, `${JSON.stringify({ version: pkg.version, commit }, null, 2)}\n`, 'utf8');
process.stdout.write(`build-info.json: v${pkg.version} (${commit})\n`);
