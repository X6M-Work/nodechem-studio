import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import { RunManager } from './runner/runManager.js';
import { QueueManager } from './runner/queue.js';
import { preflight } from './runner/preflight.js';
import { defaultGaussianExecutablePath } from './runner/gaussianPlatform.js';
import { writeClusterExport, importClusterExport } from './runner/clusterFiles.js';
import { parseProjectText, stringifyProject, summarizeErrors } from '../src/shared/projectSchema.js';
import {
  PROJECT_EXTENSIONS,
  classifySavePath,
  projectFileName,
  withProjectExtension,
} from '../src/shared/projectFile.js';
import { engineOrDefault } from '../src/shared/engines/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const isDev = process.argv.includes('--dev');
const DEV_URL = 'http://127.0.0.1:5173';
// Injected by the packaging/launch environment. No git call and no network.
const APP_COMMIT = String(process.env.GIT_COMMIT || '').trim() || 'unknown';

// Electron derives the userData folder from the package name, but pin it
// explicitly so the storage location is a documented constant of the format
// rather than an implicit side effect of the package name.
const USER_DATA_DIR = path.join(app.getPath('appData'), 'nodechem-studio');
fs.mkdirSync(USER_DATA_DIR, { recursive: true });
app.setPath('userData', USER_DATA_DIR);

let mainWindow = null;
let runManager = null;
let queueManager = null;
let windowDirty = false;

function emitRunEvent(event) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('gaussian:event', event);
  }
}

function emitQueueEvent(event) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('queue:event', event);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#07090d',
    title: 'NodeChem Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(path.join(ROOT, 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.on('close', (event) => {
    if (!windowDirty) return;
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['Cancel', 'Close without saving'],
      defaultId: 0,
      cancelId: 0,
      title: 'Unsaved changes',
      message: 'This project has unsaved changes.',
      detail: 'Close the window and lose them?',
    });
    if (choice === 0) event.preventDefault();
  });
}

function projectFailure(error) {
  return {
    code: 'invalid-project',
    message: summarizeErrors(error.errors),
    errors: error.errors,
    warnings: error.warnings,
  };
}

async function chooseExecutable(config = {}) {
  const engine = engineOrDefault(config.engine);
  const isXtb = engine.id === 'xtb';
  const result = await dialog.showOpenDialog(mainWindow, {
    title: isXtb ? 'Locate the xTB executable' : 'Locate the licensed Gaussian executable',
    defaultPath: isXtb
      ? (process.platform === 'win32' ? 'C:\\xtb\\bin\\xtb.exe' : '/usr/local/bin/xtb')
      : defaultGaussianExecutablePath(process.platform),
    properties: ['openFile'],
    filters: process.platform === 'win32'
      ? [{ name: isXtb ? 'xTB executable' : 'Gaussian for Windows', extensions: ['exe'] }, { name: 'All files', extensions: ['*'] }]
      : [{ name: 'All files', extensions: ['*'] }],
  });
  return result.canceled ? null : result.filePaths[0];
}

async function openProject() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open NodeChem Studio project',
    properties: ['openFile'],
    filters: [{ name: 'NodeChem Studio project', extensions: PROJECT_EXTENSIONS }],
  });
  if (result.canceled) return { canceled: true };
  const filePath = result.filePaths[0];
  const text = await fsp.readFile(filePath, 'utf8');
  const parsed = parseProjectText(text);
  if (!parsed.ok) {
    return { canceled: false, path: filePath, error: projectFailure(parsed) };
  }
  return {
    canceled: false,
    path: filePath,
    project: parsed.project,
    migrated: parsed.migrated,
    warnings: parsed.warnings,
  };
}

function suggestedProjectName(project) {
  return projectFileName(project);
}

async function saveProject(project, filePath) {
  const serialized = stringifyProject(project);
  if (!serialized.ok) {
    return { canceled: false, error: projectFailure(serialized) };
  }
  let target = typeof filePath === 'string' && filePath.trim() ? filePath.trim() : null;
  const pathKind = classifySavePath(target);
  if (pathKind.kind === 'invalid') {
    return { canceled: false, error: { message: pathKind.message } };
  }
  if (!target) {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save NodeChem Studio project',
      defaultPath: path.join(app.getPath('documents'), suggestedProjectName(project)),
      filters: [{ name: 'NodeChem Studio project', extensions: [PROJECT_EXTENSIONS[0]] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    target = withProjectExtension(result.filePath);
  }
  await fsp.writeFile(target, serialized.text, 'utf8');
  return {
    canceled: false,
    path: target,
    project: serialized.project,
  };
}

async function exportGaussianInput({ filename, text } = {}) {
  const name = String(filename || '');
  if (!/^[A-Za-z0-9._-]+\.(gjf|com)$/i.test(name)) {
    return { canceled: false, error: { message: 'Input file name must be a safe .gjf or .com basename.' } };
  }
  const content = String(text || '');
  if (!content.trim()) return { canceled: false, error: { message: 'There is no Gaussian input to export.' } };
  if (Buffer.byteLength(content, 'utf8') > 2 * 1024 * 1024) {
    return { canceled: false, error: { message: 'Gaussian input is larger than 2 MiB.' } };
  }
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Gaussian input',
    defaultPath: path.join(app.getPath('downloads'), name),
    filters: [{ name: 'Gaussian input', extensions: ['gjf'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  await fsp.writeFile(result.filePath, content, 'utf8');
  return { canceled: false, path: result.filePath };
}

async function exportClusterScripts({ format, files } = {}) {
  const scheduler = String(format || '');
  if (!['slurm', 'pbs'].includes(scheduler)) {
    return { canceled: false, error: { message: 'Choose either the SLURM or PBS script set.' } };
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: `Choose a folder for the ${scheduler.toUpperCase()} script set`,
    defaultPath: app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Export here',
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  try {
    return await writeClusterExport({ parentDir: result.filePaths[0], format: scheduler, files });
  } catch (error) {
    return { canceled: false, error: { message: error.message } };
  }
}

async function importClusterResults() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose the exported cluster folder that contains the returned outputs',
    properties: ['openDirectory'],
    buttonLabel: 'Import results',
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  try {
    return await importClusterExport({
      exportDir: result.filePaths[0],
      runsRoot: path.join(app.getPath('userData'), 'runs'),
    });
  } catch (error) {
    return { canceled: false, error: { message: error.message } };
  }
}

app.whenReady().then(async () => {
  runManager = new RunManager({
    runsRoot: path.join(app.getPath('userData'), 'runs'),
    emit: emitRunEvent,
    appInfo: { version: app.getVersion(), commit: APP_COMMIT },
  });
  queueManager = new QueueManager({
    queuesRoot: path.join(app.getPath('userData'), 'queues'),
    runManager,
    emit: emitQueueEvent,
  });
  await queueManager.init();

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
    userData: app.getPath('userData'),
  }));
  ipcMain.handle('project:open', openProject);
  ipcMain.handle('project:save', (_event, project, filePath) => saveProject(project, filePath));
  ipcMain.handle('input:export', (_event, payload) => exportGaussianInput(payload));
  ipcMain.handle('cluster:export', (_event, payload) => exportClusterScripts(payload));
  ipcMain.handle('cluster:import', () => importClusterResults());
  ipcMain.on('window:dirty', (_event, dirty) => { windowDirty = Boolean(dirty); });
  ipcMain.handle('gaussian:pick-executable', (_event, config) => chooseExecutable(config || {}));
  ipcMain.handle('gaussian:preflight', (_event, config) => preflight(config || {}, {
    platform: process.platform,
    env: process.env,
    userData: app.getPath('userData'),
  }));
  ipcMain.handle('gaussian:run', (_event, payload) => runManager.start(payload));
  ipcMain.handle('gaussian:cancel', (_event, runId) => runManager.cancel(runId));
  ipcMain.handle('runs:list', () => runManager.list());
  ipcMain.handle('runs:verify', (_event, runId) => runManager.verify(runId));
  ipcMain.handle('queue:start', (_event, payload) => queueManager.start(payload));
  ipcMain.handle('queue:pause', (_event, queueId) => queueManager.pause(queueId));
  ipcMain.handle('queue:resume', (_event, queueId) => queueManager.resume(queueId));
  ipcMain.handle('queue:cancel', (_event, queueId) => queueManager.cancel(queueId));
  ipcMain.handle('queue:list', () => queueManager.list());
  ipcMain.handle('queue:get', (_event, queueId) => queueManager.get(queueId));

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  runManager?.cancelAll();
});
