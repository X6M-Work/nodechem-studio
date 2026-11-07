import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Product-identity guard.
 *
 * The product was renamed from the Gaussian-specific working title to NodeChem
 * Studio (issue #37). These assertions pin the packaged identity — package name,
 * productName, appId, installer artifact, window title, renderer brand, bundle
 * and CI artifact names — so a later rename cannot silently leave the app,
 * the installer and the documentation describing two different products.
 *
 * They also pin the deliberate exceptions, because a blind find-and-replace is
 * how a rename like this breaks saved user state: the localStorage key, the
 * userData folder and the cluster-export format identifier all keep their
 * pre-rename value on purpose.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

const pkg = JSON.parse(read('package.json'));

// The retired brand is assembled from fragments so this checker does not itself
// match a repository-wide grep for the old name.
const RETIRED_BRAND = new RegExp([
  'Gaussian' + ' Node ' + 'Studio',
  'Gaussian' + 'Studio',
  'gaussian' + 'nodestudio',
  'Gaussian' + ' Studio',
].join('|'), 'i');

const TEXT_EXTENSIONS = new Set(['.md', '.js', '.cjs', '.mjs', '.json', '.html', '.css', '.sh', '.yml', '.yaml', '.txt']);
const SKIP_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'release', 'images']);

/** Every text file that belongs to the product, as repo-relative posix paths. */
function productFiles(relDir = '.') {
  const absolute = path.join(ROOT, relDir);
  const found = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const rel = relDir === '.' ? entry.name : path.posix.join(relDir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      found.push(...productFiles(rel));
    } else if (TEXT_EXTENSIONS.has(path.extname(entry.name))) {
      found.push(rel);
    }
  }
  return found;
}

/** Minimal electron-builder artifactName renderer: substitutes ${name}-style macros. */
function artifactName(vars) {
  return pkg.build.win.artifactName.replace(/\$\{(\w+)\}/g, (match, key) => (
    key in vars ? String(vars[key]) : match
  ));
}

const INSTALLER = artifactName({
  name: pkg.name,
  productName: pkg.build.productName,
  version: pkg.version,
  arch: 'x64',
  ext: 'exe',
});

describe('packaged product identity', () => {
  it('names the package, app id and shortcut NodeChem Studio', () => {
    expect(pkg.name).toBe('nodechem-studio');
    expect(pkg.build.productName).toBe('NodeChem Studio');
    expect(pkg.build.appId).toBe('com.xharl.nodechemstudio');
    expect(pkg.build.nsis.shortcutName).toBe(pkg.build.productName);
  });

  it('describes the product by its new name without dropping the Gaussian 16 target', () => {
    expect(pkg.description).toContain('NodeChem Studio');
    expect(pkg.description).toContain('Gaussian 16');
  });

  it('builds the Windows installer name from the package name, not the display name', () => {
    // ${productName} would emit "NodeChem Studio-0.1.0-x64.exe"; the artifact must
    // stay space-free and predictable for CI uploads and checksums.
    expect(pkg.build.win.artifactName).toContain('${name}');
    expect(INSTALLER).toBe('nodechem-studio-0.1.0-x64.exe');
  });

  it('documents the same installer filename that the build produces', () => {
    expect(read('README.md')).toContain(`release\\${INSTALLER}`);
    expect(read('docs/IMPLEMENTATION_PLAN.md')).toContain(`release/${INSTALLER}`);
  });

  it('titles the Electron window after the product', () => {
    const main = read('electron/main.js');
    const windowTitle = main.match(/title:\s*'([^']+)'/);
    expect(windowTitle).not.toBeNull();
    expect(windowTitle[1]).toBe(pkg.build.productName);
  });

  it('brands the renderer shell with the same product name', () => {
    const html = read('index.html');
    expect(html).toContain(`<title>${pkg.build.productName}</title>`);
    const brand = html.match(/class="brand-name">([^<]+)<span>([^<]+)<\/span>/);
    expect(brand).not.toBeNull();
    expect(`${brand[1]} ${brand[2]}`).toBe(pkg.build.productName);
  });

  it('names the product in the About text', () => {
    expect(read('src/renderer/app.js')).toContain('NodeChem Studio — the graph is the workspace.');
  });

  it('names the source hand-off bundle after the product', () => {
    expect(read('scripts/package-bundle.sh')).toContain('NAME="nodechem-studio-v${VERSION}"');
    expect(read('HANDOFF.md')).toContain('nodechem-studio-v0.1.0.tar.gz');
    expect(read('docs/COLLABORATION.md')).toContain('nodechem-studio-v0.1.0.tar.gz');
  });

  it('names the Windows CI artifact after the product', () => {
    expect(read('.github/workflows/windows-package.yml')).toContain('name: nodechem-studio-windows');
  });

  it('leaves no retired product name anywhere in the product surface', () => {
    const offenders = productFiles().filter((rel) => RETIRED_BRAND.test(read(rel)));
    expect(offenders).toEqual([]);
  });

  it('renames every doc and configuration file outright', () => {
    const docsAndConfig = [
      'README.md',
      'AGENTS.md',
      'HANDOFF.md',
      'package.json',
      'package-lock.json',
      'scripts/package-bundle.sh',
      '.github/workflows/windows-package.yml',
      '.github/workflows/ci.yml',
      // COLLABORATION.md is handled separately: it names the unchanged GitHub
      // repository directory, which is not product branding.
      // PROJECT-FORMAT.md is the normative spec: it must quote the pinned
      // userData folder name, which is likewise not branding.
      ...productFiles('docs').filter((rel) => rel.endsWith('.md')
        && !rel.endsWith('COLLABORATION.md')
        && !rel.endsWith('PROJECT-FORMAT.md')),
    ];
    const stale = docsAndConfig.filter((rel) => /gaussian-node-studio|gaussian-studio/i.test(read(rel)));
    expect(stale).toEqual([]);
  });

  it('keeps the GitHub repository path as a path, not as product branding', () => {
    const mentions = read('docs/COLLABORATION.md')
      .split('\n')
      .filter((line) => /gaussian-node-studio/i.test(line));
    expect(mentions).toHaveLength(1);
    expect(mentions[0]).toContain('Projects\\gaussian-node-studio');
  });
});

describe('persisted state stays compatible across the rename', () => {
  it('keeps the runner preference key so saved settings survive', () => {
    expect(read('src/renderer/app.js')).toContain("'gaussian-studio.run-config'");
  });

  it('pins userData to the pre-rename folder so runs, queues and localStorage survive', () => {
    const main = read('electron/main.js');
    expect(main).toContain("path.join(app.getPath('appData'), 'gaussian-node-studio')");
    expect(main).toContain("app.setPath('userData', USER_DATA_DIR)");
  });

  it('keeps the cluster-export format identifier that existing exports carry', () => {
    expect(read('src/shared/clusterExport.js')).toContain("MANIFEST_KIND = 'gaussian-node-studio-cluster-export'");
    expect(read('test/clusterExport.test.js')).toContain('gaussian-node-studio-cluster-export');
  });

  it('confines the old slug to the pinned identifiers and internal scratch names', () => {
    // Any new use of the hyphenated slug is a decision, not an accident: add the
    // file here with a comment explaining why the value must not change.
    const pinned = [
      'electron/main.js', // userData folder pinned above
      'src/shared/clusterExport.js', // durable manifest kind
      'test/clusterExport.test.js', // asserts the durable manifest kind
      'test/productIdentity.test.js', // this guard
    ];
    const pinnedScratch = [
      'src/renderer/app.js', // localStorage key pinned above
      'test/gaussianRunner.test.js', // mkdtemp scratch prefix, never user-visible
      'test/runManager.test.js', // mkdtemp scratch prefix, never user-visible
      'test/provenance.test.js', // mkdtemp scratch prefix, never user-visible
      'test/productIdentity.test.js', // this guard
    ];
    const codeFiles = [...productFiles('electron'), ...productFiles('src'), ...productFiles('test')];
    const slugged = codeFiles.filter((rel) => /gaussian-node-studio/.test(read(rel))).sort();
    expect(slugged).toEqual([...pinned].sort());
    const scratch = codeFiles.filter((rel) => /gaussian-studio/.test(read(rel))).sort();
    expect(scratch).toEqual([...pinnedScratch].sort());
  });
});

describe('Gaussian references were not renamed away', () => {
  it('keeps the licence and redistribution boundary in the exported cluster README', () => {
    const source = read('src/shared/clusterExport.js');
    expect(source).toContain('Gaussian is licensed commercial software');
    expect(source).toContain('NodeChem Studio does not include, copy, or');
    expect(source).toContain('redistribute Gaussian; you must install and licence it yourself.');
  });

  it('keeps the no-redistribution rule and the Gaussian 16 target in the docs', () => {
    expect(read('AGENTS.md')).toContain('Never copy, bundle, or redistribute Gaussian');
    expect(read('README.md')).toContain('Gaussian 16');
    expect(read('README.md')).toContain('No Gaussian binaries or licence');
  });

  it('still recognises the Gaussian termination marker in the parser', () => {
    expect(read('src/shared/gaussianOutput.js')).toContain('Normal termination of Gaussian');
  });
});
