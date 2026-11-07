import fs from 'node:fs';
import path from 'node:path';

/**
 * Platform conventions for a local Gaussian 16 installation.
 *
 * Gaussian ships the same link executables under different names per operating
 * system: `g16.exe` with `l1.exe` beside it on Windows, `g16` with `l1` on
 * Linux and macOS. Preflight and the runner must agree on those names, and the
 * installation directory is whatever directory actually holds the links — not a
 * hard-coded `C:\G16W`.
 *
 * The Windows wording produced here is pinned by `test/preflight.test.js`;
 * the Windows branch must stay byte-identical to the original preflight.
 *
 * Nothing in this module is engine-generic on purpose: xTB has its own lookup
 * (`XtbRunner.parameterPathFor`) and must not inherit Gaussian rules.
 */

export const SUPPORTED_PLATFORMS = Object.freeze(['win32', 'linux', 'darwin']);

const POSIX_LINK1 = 'l1';
const WINDOWS_LINK1 = 'l1.exe';

export function isSupportedPlatform(platform = process.platform) {
  return SUPPORTED_PLATFORMS.includes(platform);
}

/** Windows is the only non-POSIX target; darwin shares the Linux layout. */
export function isPosix(platform = process.platform) {
  return platform !== 'win32';
}

/** Console runner basenames accepted on this platform, in matching order. */
export function gaussianExecutableNames(platform = process.platform) {
  return isPosix(platform) ? ['g16'] : ['g16.exe'];
}

/**
 * Suggested executable for the Browse dialog. This is only a starting point:
 * preflight never assumes the path, it validates whatever the user selects.
 */
export function defaultGaussianExecutablePath(platform = process.platform) {
  return isPosix(platform) ? '/usr/local/g16/g16' : 'C:\\G16W\\g16.exe';
}

/** Link 1 basenames. `g16w.exe` is the Windows GUI and is never accepted. */
export function link1Names(platform = process.platform) {
  return isPosix(platform) ? [POSIX_LINK1] : [WINDOWS_LINK1];
}

/**
 * Validate the selected console executable's file name for this platform.
 *
 * Returns the user-facing label, verdict and detail. On Windows the detail and
 * label are exactly the original strings (`Found g16.exe; g16w.exe is the GUI,
 * not the runner.`); the POSIX branch adds a specific hint instead of pretending
 * a `.exe` is the wrong build.
 */
export function gaussianExecutableCheck(filePath, platform = process.platform) {
  // Windows arguments are Windows paths even when this runs on another host
  // (the suite simulates the Windows branch). path.win32 is identical to the
  // host `path` module on a real Windows machine.
  const pathApi = platform === 'win32' ? path.win32 : path;
  const base = pathApi.basename(String(filePath || ''));
  const lower = base.toLowerCase();
  const accepted = gaussianExecutableNames(platform).map((name) => name.toLowerCase());
  const ok = accepted.includes(lower);

  if (isPosix(platform)) {
    if (ok) return { label: 'POSIX console executable', ok: true, detail: `Found ${base}` };
    let hint = 'The POSIX console runner is g16, inside the installation directory.';
    if (lower === 'g16.exe') {
      hint = 'That is the Windows console runner; the POSIX console runner is g16.';
    } else if (lower === 'g16w' || lower === 'g16w.exe') {
      hint = 'That is the Windows GUI; the POSIX console runner is g16.';
    }
    return { label: 'POSIX console executable', ok: false, detail: `Found ${base}. ${hint}` };
  }

  return {
    label: 'Windows console executable',
    ok,
    detail: `Found ${base}; g16w.exe is the GUI, not the runner.`,
  };
}

/**
 * The directory that becomes `GAUSS_EXEDIR` for the child process.
 *
 * POSIX installations are usually reached through a symlink
 * (`/usr/local/bin/g16 -> /opt/g16/g16/g16`). `GAUSS_EXEDIR` must name the
 * directory that holds `l1`, so the link is resolved before taking its parent.
 * Windows resolves nothing: the directory of the selected executable is already
 * the installation directory and the original behaviour is preserved.
 */
export function gaussianInstallDir(executable, platform = process.platform, { realpath = fs.realpathSync } = {}) {
  const file = String(executable || '');
  if (!file) return '';
  if (isPosix(platform)) {
    try {
      return path.dirname(realpath(file));
    } catch {
      return path.dirname(file);
    }
  }
  return path.dirname(file);
}

/**
 * Locate Link 1 inside the installation directory.
 *
 * `exists` is injectable so the resolver can be tested without a Gaussian
 * install; production passes `fs.existsSync`.
 */
export function link1For(installDir, platform = process.platform, { exists = fs.existsSync } = {}) {
  const names = link1Names(platform);
  const expected = path.join(String(installDir || ''), names[0]);
  const found = names
    .map((name) => path.join(String(installDir || ''), name))
    .find((candidate) => exists(candidate));
  return { path: found || expected, exists: Boolean(found) };
}

/** Scratch-directory convention for this platform. */
export function scratchConventions(platform = process.platform) {
  if (!isPosix(platform)) {
    return {
      envVar: 'GAUSS_SCRDIR',
      example: 'C:\\G16W\\SCRATCH',
      detail: 'A local NTFS folder, ideally without spaces in its path.',
    };
  }
  if (platform === 'darwin') {
    return {
      envVar: 'GAUSS_SCRDIR',
      example: '/tmp/g16-scratch',
      detail: 'Node-local disk; avoid network volumes mounted under /Volumes.',
    };
  }
  return {
    envVar: 'GAUSS_SCRDIR',
    example: '/scratch/$USER',
    detail: 'Node-local disk such as /scratch/$USER or /tmp/g16-scratch; never NFS.',
  };
}

/**
 * Filesystem magic values that identify a network mount on Linux. `fs.statfs`
 * exposes `type`; the values are compared unsigned because JavaScript bitwise
 * operators sign-extend.
 */
export const NETWORK_FILESYSTEM_MAGIC = Object.freeze({
  0x6969: 'NFS',
  0x517b: 'SMB',
  0xff534d42: 'SMB/CIFS',
  0xfe534d42: 'SMB2',
  0x5346414f: 'AFS',
  0x564c: 'NCP',
});

const NETWORK_PATH_SEGMENTS = new Set(['nfs', 'nfs4', 'smb', 'cifs', 'sshfs', 'afs']);

/** Path-only evidence, used when statfs cannot see the directory yet. */
function networkPathReason(dir) {
  const value = String(dir || '');
  const segments = value.split(/[\\/]+/).filter(Boolean);
  // autofs mounts live under /net/<host>/<export>; a directory merely named
  // "net" deeper in the tree is not evidence.
  if (segments[0]?.toLowerCase() === 'net') return 'network mount under /net (autofs)';
  const match = segments.find((segment) => NETWORK_PATH_SEGMENTS.has(segment.toLowerCase()));
  if (match) return `path segment "${match}" looks like a network mount`;
  if (/^\/Volumes\/[^/]*(nfs|smb|cifs)/i.test(value)) return 'macOS network volume';
  return null;
}

/**
 * Explain why a POSIX scratch directory looks network-mounted, or null.
 *
 * The path heuristic runs first because scratch directories are often created
 * by the runner and do not exist yet when statfs is consulted.
 */
export function networkScratchReason(dir, platform = process.platform, { statfs = fs.statfsSync } = {}) {
  if (!isPosix(platform)) return null;
  const target = String(dir || '');
  if (!target) return null;

  const heuristic = networkPathReason(target);
  if (heuristic) return heuristic;

  if (typeof statfs !== 'function') return null;
  try {
    const stats = statfs(target);
    if (!stats || typeof stats.type !== 'number') return null;
    const kind = NETWORK_FILESYSTEM_MAGIC[stats.type >>> 0];
    if (kind) return `${kind} mount`;
  } catch {
    // The directory may not exist yet; the path heuristic already had its turn.
  }
  return null;
}

/**
 * Warnings for a configured scratch directory. These never fail preflight and
 * never rewrite the path: the user chose it, so it is warned about and used.
 */
export function scratchDirWarnings(scratchDir, platform = process.platform, options = {}) {
  const dir = String(scratchDir || '').trim();
  if (!dir) return [];

  const warnings = [];
  if (/\s/.test(dir)) {
    warnings.push({
      id: 'scratch-spaces',
      label: 'Scratch path contains spaces',
      detail: `${dir} — Gaussian composes scratch file names from this path; use a space-free directory such as ${scratchConventions(platform).example}.`,
    });
  }

  const network = networkScratchReason(dir, platform, options);
  if (network) {
    warnings.push({
      id: 'scratch-network',
      label: 'Scratch directory is not node-local disk',
      detail: `${dir} — ${network}. Gaussian scratch over NFS/SMB is slow and its file locking is unreliable; point GAUSS_SCRDIR at node-local disk.`,
    });
  }
  return warnings;
}
