import { describe, it, expect } from 'vitest';
import { formatPreflightReport } from '../src/renderer/preflightReport.js';

/**
 * The run console is the only place a preflight verdict is read. Warnings are
 * a third state: a user who chose a scratch path with spaces must see it, but
 * must not be told preflight failed — and a warning must never render as PASS.
 */
describe('preflight console report', () => {
  it('keeps the existing PASS/FAIL format byte for byte', () => {
    const text = formatPreflightReport({
      ok: true,
      checks: [
        { id: 'platform', label: 'Operating system', ok: true, detail: 'win32 10.0.26100' },
        { id: 'link1', label: 'Gaussian Link 1 present', ok: false, detail: '' },
      ],
    });
    expect(text).toBe([
      'Preflight · ready',
      'PASS  Operating system — win32 10.0.26100',
      'FAIL  Gaussian Link 1 present',
      '',
      '',
    ].join('\n'));
  });

  it('renders warnings as WARN after the checks', () => {
    const text = formatPreflightReport({
      ok: true,
      checks: [{ id: 'scratch', label: 'Scratch directory writable', ok: true, detail: '/tmp/scratch dir' }],
      warnings: [{ id: 'scratch-spaces', label: 'Scratch path contains spaces', detail: '/tmp/scratch dir' }],
    });
    expect(text).toContain('WARN  Scratch path contains spaces — /tmp/scratch dir');
    expect(text).not.toContain('PASS  Scratch path contains spaces');
    expect(text).toContain('Preflight · ready');
  });

  it('handles a result with no warnings array', () => {
    expect(formatPreflightReport({ ok: false, checks: [] }))
      .toBe('Preflight · issues found\n\n');
  });

  it('does not throw on a missing result', () => {
    expect(formatPreflightReport(null)).toBe('Preflight · issues found\n\n');
  });
});
