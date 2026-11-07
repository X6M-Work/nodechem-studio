import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';

const MAX_TAIL_BYTES = 256 * 1024;
const MAX_FINAL_BYTES = 32 * 1024 * 1024;

async function readRange(filePath, offset, maxBytes) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    if (stat.size <= offset) return { text: '', nextOffset: offset, size: stat.size };
    const length = Math.min(stat.size - offset, maxBytes);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    return {
      text: buffer.subarray(0, bytesRead).toString('utf8'),
      nextOffset: offset + bytesRead,
      size: stat.size,
    };
  } finally {
    await handle.close();
  }
}

/**
 * Spawn one licensed Gaussian process and tail its output file.
 * No shell is involved; arguments are passed as an array.
 */
export class GaussianRunner {
  constructor() {
    this.child = null;
    this.cancelled = false;
  }

  async run({
    executable,
    inputName,
    outputName,
    cwd,
    scratchDir,
    onOutput = () => {},
    timeoutMs = 0,
  }) {
    const exeDir = path.dirname(executable);
    const env = {
      ...process.env,
      GAUSS_EXEDIR: exeDir,
      GAUSS_SCRDIR: scratchDir,
      PATH: `${exeDir}${path.delimiter}${process.env.PATH || ''}`,
    };

    const outputPath = path.join(cwd, outputName);
    let stdout = '';
    let stderr = '';
    let offset = 0;
    let polling = null;
    let timeout = null;

    const child = spawn(executable, [inputName], {
      cwd,
      env,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stdout += text.slice(-20000);
      onOutput({ stream: 'stdout', text });
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderr += text.slice(-20000);
      onOutput({ stream: 'stderr', text });
    });

    const poll = async () => {
      try {
        const chunk = await readRange(outputPath, offset, MAX_TAIL_BYTES);
        if (chunk.text) {
          offset = chunk.nextOffset;
          onOutput({ stream: 'output', text: chunk.text });
        }
      } catch (error) {
        if (error.code !== 'ENOENT') onOutput({ stream: 'stderr', text: `output tail: ${error.message}\n` });
      }
    };
    polling = setInterval(poll, 300);

    if (timeoutMs > 0) {
      timeout = setTimeout(() => this.cancel(), timeoutMs);
    }

    const exit = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    }).finally(() => {
      clearInterval(polling);
      if (timeout) clearTimeout(timeout);
      this.child = null;
    });

    await poll();
    let outputText = '';
    try {
      const stat = await fsp.stat(outputPath);
      if (stat.size > MAX_FINAL_BYTES) {
        outputText = (await readRange(outputPath, Math.max(0, stat.size - MAX_FINAL_BYTES), MAX_FINAL_BYTES)).text;
      } else {
        outputText = await fsp.readFile(outputPath, 'utf8');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      outputText = `${stdout}\n${stderr}`.trim();
    }

    return {
      exitCode: exit.code,
      signal: exit.signal,
      cancelled: this.cancelled,
      outputPath,
      outputText,
      stdout,
      stderr,
    };
  }

  cancel() {
    const child = this.child;
    if (!child) return;
    this.cancelled = true;
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.unref();
    } else {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 2000).unref();
    }
  }
}
