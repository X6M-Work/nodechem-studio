/**
 * Renderer glue for offline cluster export and result import.
 *
 * No Node APIs: the renderer plans the file set and the main process writes
 * or reads it through `window.desktop`. There is no network path here.
 */

import { planClusterExport } from '../shared/clusterExport.js';

function desktopBridge() {
  return typeof window !== 'undefined' ? window.desktop || null : null;
}

/**
 * One entry point for the overflow menu. `op` is "export" or "import".
 * Export needs the workflow task list the local queue would build, so the same
 * `.gjf` text is staged for the cluster and for a local run.
 */
export async function runClusterAction({ op, format, project, buildTasks, notify } = {}) {
  const desktop = desktopBridge();
  const say = typeof notify === 'function' ? notify : () => {};

  try {
    if (op === 'export') {
      if (!desktop?.exportCluster) {
        say('Open the desktop app to write cluster scripts to disk.');
        return { canceled: true };
      }
      let tasks;
      try {
        tasks = buildTasks();
      } catch (error) {
        say(`Cannot export cluster scripts: ${error.message}`);
        return { error: error.message };
      }
      const plan = planClusterExport({
        format,
        projectName: project?.name,
        tasks,
        edges: project?.edges,
      });
      const result = await desktop.exportCluster({ format, files: plan.files });
      if (result?.canceled) return result;
      if (result?.error) {
        say(`Could not export: ${result.error.message}`);
        return result;
      }
      const warnings = plan.warnings.length
        ? ` · ${plan.warnings.length} warning${plan.warnings.length === 1 ? '' : 's'} (see manifest.json)`
        : '';
      say(`Exported ${plan.files.length} files to ${result.path}${warnings}`);
      return { ...result, warnings: plan.warnings };
    }

    if (op === 'import') {
      if (!desktop?.importCluster) {
        say('Open the desktop app to import cluster results.');
        return { canceled: true };
      }
      const result = await desktop.importCluster();
      if (result?.canceled) return result;
      if (result?.error) {
        say(`Could not import: ${result.error.message}`);
        return result;
      }
      const runs = result.runs?.length || 0;
      const missing = result.missing?.length || 0;
      const errors = result.errors?.length || 0;
      say([
        `Imported ${runs} run${runs === 1 ? '' : 's'}`,
        missing ? `${missing} output${missing === 1 ? '' : 's'} missing` : '',
        errors ? `${errors} error${errors === 1 ? '' : 's'}` : '',
      ].filter(Boolean).join(' · '));
      return result;
    }

    say('Unknown cluster action.');
    return { error: 'unknown-action' };
  } catch (error) {
    say(`${op === 'import' ? 'Import' : 'Export'} failed: ${error.message}`);
    return { error: error.message };
  }
}
