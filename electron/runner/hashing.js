/**
 * SHA-256 helpers for the run provenance manifest.
 *
 * The hash is always taken from the bytes that matter: the `.gjf` on disk, the
 * output file on disk when Gaussian wrote one, and the captured text only when
 * stdout/stderr was the parsed source. Nothing is inferred from a string that
 * was not written.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fsp from 'node:fs/promises';

export const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

export function sha256Text(text) {
  return createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
}

export async function isFile(filePath) {
  if (!filePath) return false;
  try {
    const stat = await fsp.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}
