import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Public-documentation guards.
 *
 * Three failure modes matter for a release the outside world will read:
 *
 * 1. a relative link that does not resolve (a reader hits a 404 on the first
 *    page they try),
 * 2. a guide page that exists but is not reachable from the index,
 * 3. UI copy that advertises a version the package no longer is.
 *
 * The prose itself cannot be tested. These checks make sure the structure that
 * carries it cannot rot silently.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const pkg = JSON.parse(read('package.json'));

function markdownFiles(relDir) {
  const absolute = path.join(ROOT, relDir);
  const found = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const rel = path.posix.join(relDir, entry.name);
    if (entry.isDirectory()) found.push(...markdownFiles(rel));
    else if (entry.isFile() && entry.name.endsWith('.md')) found.push(rel);
  }
  return found;
}

const DOC_FILES = ['README.md', ...markdownFiles('docs')];

/** Relative link targets in a markdown file, excluding anchors and URLs. */
function relativeTargets(text) {
  const targets = [];
  const pattern = /!?\[[^\]]*\]\(([^)\s]+)\)/g;
  let match = pattern.exec(text);
  while (match) {
    const target = match[1];
    if (!target.startsWith('#') && !/^[a-z][a-z0-9+.-]*:/i.test(target)) {
      targets.push(target.split('#')[0]);
    }
    match = pattern.exec(text);
  }
  return targets;
}

describe('public documentation — links', () => {
  it('resolves every relative link and image in the README and docs', () => {
    const missing = [];
    for (const rel of DOC_FILES) {
      const fromDir = path.posix.dirname(rel);
      for (const target of relativeTargets(read(rel))) {
        const resolved = path.posix.normalize(path.posix.join(fromDir, target));
        if (!fs.existsSync(path.join(ROOT, resolved))) missing.push(`${rel} → ${target}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('links every guide page from the guide index', () => {
    const index = read('docs/guide/README.md');
    const linked = new Set(relativeTargets(index).map((target) => path.posix.basename(target)));
    const pages = markdownFiles('docs/guide')
      .map((rel) => path.posix.basename(rel))
      .filter((name) => name !== 'README.md');
    expect(pages.length).toBeGreaterThanOrEqual(8);
    const unlinked = pages.filter((name) => !linked.has(name));
    expect(unlinked, 'guide pages not linked from docs/guide/README.md').toEqual([]);
  });

  it('gives every guide page a top-level heading and a Next or Back link', () => {
    for (const rel of markdownFiles('docs/guide')) {
      if (path.posix.basename(rel) === 'README.md') continue;
      const text = read(rel);
      expect(text, `${rel} needs an H1`).toMatch(/^# \S/m);
      expect(text, `${rel} needs navigation`).toMatch(/## Next|Back to the documentation index/);
    }
  });

  it('references every image in docs/images from a document', () => {
    const dir = path.join(ROOT, 'docs/images');
    const images = fs.readdirSync(dir).filter((name) => /\.(png|jpg|jpeg|svg|gif)$/i.test(name));
    const corpus = DOC_FILES.map(read).join('\n');
    const unlinked = images.filter((name) => !corpus.includes(`images/${name}`));
    expect(unlinked, 'unreferenced images rot and keep stale branding alive').toEqual([]);
  });
});

describe('public documentation — copy consistency', () => {
  it('advertises the packaged version in the shell', () => {
    const html = read('index.html');
    const chips = html.match(/v\d+\.\d+(?:\.\d+)?/g) || [];
    expect(chips.length).toBeGreaterThan(0);
    const expected = `v${pkg.version}`;
    for (const chip of chips) {
      expect(chip === expected || chip === `v${pkg.version.split('.').slice(0, 2).join('.')}`,
        `index.html advertises ${chip}, package.json is ${pkg.version}`).toBe(true);
    }
  });

  it('does not repeat the xTB claims that issues #40 and #42 made false', () => {
    const corpus = DOC_FILES.map(read).join('\n');
    const retired = [
      'xTB checkpoint/restart hand-off is not implemented',
      'xTB solvation is builder-only',
      'not in the current inspector',
      'the app does not stage that file between blocks',
    ];
    const offenders = retired.filter((claim) => corpus.includes(claim));
    expect(offenders).toEqual([]);
  });

  it('states plainly what the release is, and is not', () => {
    const readme = read('README.md');
    expect(readme).toContain('early preview');
    expect(readme).toContain('What has *not* been proven is a real run');
  });

  it('ships no network client in the app sources', () => {
    // The privacy page tells readers there is no network capability. Prove it
    // rather than repeating it: no HTTP client, no fetch, no XHR, no URL in code.
    const sources = [];
    for (const dir of ['src', 'electron']) {
      const walk = (rel) => {
        for (const entry of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
          const next = path.posix.join(rel, entry.name);
          if (entry.isDirectory()) walk(next);
          else if (/\.(js|cjs|mjs)$/.test(entry.name)) sources.push({ rel: next, text: read(next) });
        }
      };
      walk(dir);
    }
    // Two benign hits are expected and excluded: the SVG namespace URI and the
    // local Vite dev-server URL used by `loadURL` in development. Neither is an
    // outbound client, and both are pinned to w3.org / localhost.
    const benign = /https?:\/\/(www\.w3\.org|127\.0\.0\.1|localhost)[^'"\s]*/gi;
    const pattern = /\bfetch\s*\(|XMLHttpRequest|['"]node:https?['"]|['"]https?['"]\s*\)|https?:\/\/[a-z0-9]/i;
    const offenders = sources
      .map(({ rel, text }) => ({ rel, text: text.replace(benign, 'BENIGN_URL') }))
      .filter(({ text }) => pattern.test(text))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });
});
