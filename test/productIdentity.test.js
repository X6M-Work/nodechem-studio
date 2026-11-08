import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Product-identity guard.
 *
 * The product is NodeChem Studio. These assertions pin the packaged identity —
 * package name, productName, appId, installer artifact, window title, renderer
 * brand, bundle and CI artifact names — and assert that no retired product name
 * survives anywhere in the repository, so the docs, the installer and the app
 * cannot drift apart again.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

const pkg = JSON.parse(read('package.json'));

// Retired names are assembled from fragments so this checker does not itself
// match a repository-wide grep for them.
const RETIRED_BRAND = new RegExp([
  'Gaussian' + ' Node ' + 'Studio',
  'Gaussian' + 'Studio',
  'gaussian' + 'nodestudio',
  'Gaussian' + ' Studio',
].join('|'), 'i');

// Every retired product name AND the retired storage identifiers, which are now
// named after the current product.
const RETIRED_ANY = new RegExp([
  'Gaussian' + ' Helper',
  'Gaussian' + 'Helper',
  'Gaussian' + ' Node ' + 'Studio',
  'Gaussian' + 'Studio',
  'Gaussian' + ' Studio',
  'gaussian' + '-node-' + 'studio',
  'gaussian' + '-studio',
  'gh' + 'project',
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

// electron-builder renders the AppImage arch as `x86_64`, so the published name
// is not `${name}-${version}-x64.AppImage`. Pin the name the release actually ships.
const APPIMAGE = `${pkg.name}-${pkg.version}-x86_64.AppImage`;

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
    // ${productName} would emit "NodeChem Studio-<version>-x64.exe"; the artifact
    // must stay space-free and predictable for CI uploads and checksums. The
    // expected name is rendered from package.json, so a release bump is a
    // version change, not a test edit.
    expect(pkg.build.win.artifactName).toContain('${name}');
    expect(INSTALLER).toBe(`nodechem-studio-${pkg.version}-x64.exe`);
  });

  it('documents the same installer filename that the build produces', () => {
    expect(read('docs/guide/install.md')).toContain(`release\\${INSTALLER}`);
    expect(read('docs/guide/install.md')).toContain(`release/${APPIMAGE}`);
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

  it('does not label the 0.2 shell as a v0.1 build', () => {
    const html = read('index.html');
    expect(html).not.toMatch(/v0\.1\s*·/i);
    expect(html).toContain('id="app-version-chip"');
    expect(html).toContain('id="app-version-status"');
  });

  it('names the source hand-off bundle after the product', () => {
    // The bundle name is generated by the script from package.json's version, so
    // assert the template rather than a version that would need editing each release.
    const script = read('scripts/package-bundle.sh');
    expect(script).toContain('NAME="nodechem-studio-v${VERSION}"');
    expect(script).toMatch(/VERSION=.*package\.json|node -p/);
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
      'CONTRIBUTING.md',
      'CODE_OF_CONDUCT.md',
      'SECURITY.md',
      'package.json',
      'package-lock.json',
      'scripts/package-bundle.sh',
      '.github/workflows/windows-package.yml',
      '.github/workflows/ci.yml',
      ...productFiles('docs').filter((rel) => rel.endsWith('.md')),
    ];
    const stale = docsAndConfig.filter((rel) => RETIRED_ANY.test(read(rel)));
    expect(stale).toEqual([]);
  });

  it('keeps no retired identifier in code or tests either', () => {
    const codeFiles = [...productFiles('electron'), ...productFiles('src'), ...productFiles('test')];
    const stale = codeFiles.filter((rel) => RETIRED_ANY.test(read(rel)));
    expect(stale).toEqual([]);
  });
});

describe('storage identifiers carry the current product name', () => {
  it('names the userData folder after the product', () => {
    const main = read('electron/main.js');
    expect(main).toContain("path.join(app.getPath('appData'), 'nodechem-studio')");
    expect(main).toContain("app.setPath('userData', USER_DATA_DIR)");
  });

  it('names the runner preference key after the product', () => {
    expect(read('src/renderer/app.js')).toContain("'nodechem-studio.run-config'");
  });

  it('names the cluster-export format identifier after the product', () => {
    expect(read('src/shared/clusterExport.js')).toContain("MANIFEST_KIND = 'nodechem-studio-cluster-export'");
    expect(read('test/clusterExport.test.js')).toContain('nodechem-studio-cluster-export');
  });
});

describe('licensing', () => {
  it('ships the Apache 2.0 text and declares it in package.json', () => {
    expect(pkg.license).toBe('Apache-2.0');
    const licence = read('LICENSE');
    expect(licence).toContain('Apache License');
    expect(licence).toContain('Version 2.0, January 2004');
    expect(licence).toContain('END OF TERMS AND CONDITIONS');
  });

  it('packages the licence with the application', () => {
    expect(pkg.build.files).toContain('LICENSE');
  });

  it('states the licence in the README without granting Gaussian rights', () => {
    const readme = read('README.md');
    expect(readme).toContain('Apache License 2.0');
    expect(readme).toContain('does not grant any right to');
    expect(readme).toContain('Gaussian, which is licensed separately');
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
