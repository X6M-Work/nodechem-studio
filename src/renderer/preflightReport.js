/**
 * Format a preflight result for the run console.
 *
 * PASS/FAIL lines keep exactly the shape they had before platform support, so
 * the console reads the same on Windows. Warnings are a third, explicit state:
 * a scratch path with spaces is neither reported as a pass nor as a blocking
 * failure, and `ok` is still computed by preflight from hard checks only.
 */
export function formatPreflightReport(result) {
  const checks = Array.isArray(result?.checks) ? result.checks : [];
  const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
  const lines = checks.map((check) => `${check.ok ? 'PASS' : 'FAIL'}  ${check.label}${check.detail ? ` — ${check.detail}` : ''}`);
  const warned = warnings.map((warning) => `WARN  ${warning.label}${warning.detail ? ` — ${warning.detail}` : ''}`);
  const header = `Preflight · ${result?.ok ? 'ready' : 'issues found'}`;
  return `${[header, ...lines, ...warned].join('\n')}\n\n`;
}
