const { app, BrowserWindow, ipcMain, dialog, shell, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

const userDataPath = app.getPath('userData');
const dataFile     = path.join(userDataPath, 'caseload_data.json');
const settingsFile = path.join(userDataPath, 'settings.json');
const pendingAzureFile = path.join(userDataPath, 'pending_azure_upload.json');

// ── Azure Blob Storage config ──────────────────────────────────
// Loaded from config.json alongside the app — never hardcoded in
// source so the SAS key doesn't end up in the git repo.
// config.json format:
// {
//   "azureSasBase": "https://eccmcaseloadbackups.blob.core.windows.net",
//   "azureContainer": "sc-backups",
//   "azureSasQuery": "sv=2026-...&sig=..."
// }
let AZURE_SAS_BASE = null;
let AZURE_CONTAINER = null;
let AZURE_SAS_QUERY = null;

try {
  const configPath = path.join(app.getAppPath(), 'config.json');
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    AZURE_SAS_BASE = config.azureSasBase || null;
    AZURE_CONTAINER = config.azureContainer || null;
    AZURE_SAS_QUERY = config.azureSasQuery || null;
    console.log('Azure config loaded from config.json');
  } else {
    console.warn('config.json not found — Azure sync disabled');
  }
} catch (e) {
  console.error('Failed to load config.json:', e.message);
}

function azureBlobUrl(filename) {
  if (!AZURE_SAS_BASE || !AZURE_CONTAINER || !AZURE_SAS_QUERY) return null;
  return `${AZURE_SAS_BASE}/${AZURE_CONTAINER}/${encodeURIComponent(filename)}?${AZURE_SAS_QUERY}`;
}

function uploadToAzure(filename, jsonString) {
  return new Promise((resolve) => {
    const blobUrl = azureBlobUrl(filename);
    if (!blobUrl) {
      resolve({ success: false, error: 'Azure not configured — config.json missing or incomplete' });
      return;
    }
    try {
      const url = new URL(blobUrl);
      const body = Buffer.from(jsonString, 'utf8');
      const req = https.request({
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'PUT',
        headers: {
          'x-ms-blob-type': 'BlockBlob',
          'Content-Type': 'application/json',
          'Content-Length': body.length
        },
        timeout: 9000
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true });
          } else {
            resolve({ success: false, error: `Azure returned ${res.statusCode}: ${data.slice(0,200)}` });
          }
        });
      });
      req.on('error', (e) => resolve({ success: false, error: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'Azure upload timed out' }); });
      req.write(body);
      req.end();
    } catch (e) {
      resolve({ success: false, error: e.message });
    }
  });
}

function savePendingAzureUpload(filename, jsonString) {
  try {
    fs.writeFileSync(pendingAzureFile, JSON.stringify({ filename, data: jsonString, queuedAt: new Date().toISOString() }), 'utf8');
  } catch (e) { console.error('Failed to queue pending Azure upload:', e); }
}

function clearPendingAzureUpload() {
  try { if (fs.existsSync(pendingAzureFile)) fs.unlinkSync(pendingAzureFile); } catch (e) {}
}

function getPendingAzureUpload() {
  try {
    if (!fs.existsSync(pendingAzureFile)) return null;
    return JSON.parse(fs.readFileSync(pendingAzureFile, 'utf8'));
  } catch (e) { return null; }
}

let mainWindow;
let isClosing = false;

// ── Auto-updater setup ────────────────────────────────────────
let autoUpdater;
try {
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  // Update-checking only works unpacked (npm start) if dev-app-update.yml is
  // sitting next to main.js — a build artifact electron-builder regenerates
  // fresh in dist/ on every `npm run build`. Only force dev-mode config when
  // that file is actually present; otherwise this always attempted it and
  // failed with ENOENT on every single dev-mode launch. Doesn't affect the
  // real packaged app at all — that gets update info directly from GitHub.
  if (!app.isPackaged) {
    const devConfigPath = path.join(__dirname, 'dev-app-update.yml');
    if (fs.existsSync(devConfigPath)) {
      autoUpdater.forceDevUpdateConfig = true;
    } else {
      console.log('No dev-app-update.yml found next to main.js — skipping update check in dev mode (this never affects the packaged app).');
    }
  }
  autoUpdater.on('checking-for-update', () => sendUpdateStatus('checking', {}));
  autoUpdater.on('update-available', (info) => sendUpdateStatus('available', info));
  autoUpdater.on('update-not-available', (info) => sendUpdateStatus('not-available', info));
  autoUpdater.on('download-progress', (progress) => sendUpdateStatus('downloading', progress));
  autoUpdater.on('update-downloaded', (info) => sendUpdateStatus('downloaded', info));
  autoUpdater.on('error', (err) => { 
    console.error('Update error full:', err);
    console.error('Update error message:', err?.message);
    console.error('Update error stack:', err?.stack);
    sendUpdateStatus('error', { message: err?.message }); 
  });
} catch(e) {
  console.log('electron-updater not available (dev mode):', e.message);
}

function sendUpdateStatus(status, info) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status, info });
  }
}

function getSettings() {
  try {
    if (fs.existsSync(settingsFile)) return JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  } catch(e) {}
  return {};
}

function writeNamedBackup(userName) {
  try {
    if (!fs.existsSync(dataFile)) return;
    const filename = 'ECCM_Caseload_Backup_' + (userName||'User').replace(/\s+/g,'_') + '.json';
    const dest = path.join(userDataPath, filename);
    fs.copyFileSync(dataFile, dest);
    console.log('Named backup written to AppData:', dest);
  } catch(e) { console.error('Local backup error:', e); }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    title: 'ECCM Caseload Tracker',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    backgroundColor: '#f4f6f9', show: false
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.maximize();
    console.log('Window ready - userData path:', userDataPath);
  });
  // Disable DevTools in production
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (
      input.key === 'F12' ||
      (input.control && input.shift && (input.key === 'I' || input.key === 'J' || input.key === 'C')) ||
      (input.control && input.key === 'U')
    ) {
      event.preventDefault();
    }
  });
  mainWindow.webContents.on('devtools-opened', () => {
    mainWindow.webContents.closeDevTools();
  });
  mainWindow.on('close', (e) => {
    if (isClosing) return;
    const settings = getSettings();
    if (!settings.backupFolder) {
      console.log('No backup folder set - closing immediately');
      return;
    }
    isClosing = true;
    e.preventDefault();
    console.log('Close intercepted - sending app-closing to renderer');
    mainWindow.webContents.send('app-closing');
    setTimeout(() => {
      console.log('Safety timeout fired - forcing exit');
      app.exit(0);
    }, 15000);
  });
  mainWindow.webContents.on('context-menu', (e) => { e.preventDefault(); });
  mainWindow.setMenu(null);
}

app.whenReady().then(() => {
  createWindow();
  // A network blip right as the PC wakes from sleep is exactly the kind of
  // thing that can leave an Azure sync silently stuck until the next app
  // launch (see startAutoBackupTimer in the renderer for the periodic
  // safety net). This catches it immediately instead of waiting up to 7
  // minutes for the next timer tick.
  powerMonitor.on('resume', () => {
    console.log('System resumed from sleep — notifying renderer to retry any pending Azure upload');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('system-resumed');
    }
  });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ── Data & Settings ───────────────────────────────────────────
ipcMain.handle('load-data', () => {
  try {
    if (fs.existsSync(dataFile)) {
      const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      console.log('Data loaded - clients:', parsed?.clients?.length ?? 0);
      return parsed;
    }
  } catch(e) { console.error('Load error:', e); }
  return null;
});

ipcMain.handle('save-data', (event, data) => {
  try {
    fs.writeFileSync(dataFile, JSON.stringify(data), 'utf8');
    console.log('Data saved - clients:', data?.clients?.length ?? 0);
    return true;
  } catch(e) { console.error('Save error:', e); return false; }
});

ipcMain.handle('load-settings', () => {
  const s = getSettings();
  console.log('Settings loaded - backupFolder:', s.backupFolder || 'not set');
  return s;
});

ipcMain.handle('save-settings', (event, settings) => {
  try {
    fs.writeFileSync(settingsFile, JSON.stringify(settings), 'utf8');
    console.log('Settings saved');
    return true;
  } catch(e) { return false; }
});

ipcMain.handle('pick-backup-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose Your Data Folder',
    properties: ['openDirectory'],
    buttonLabel: 'Use This Folder'
  });
  if (result.canceled) { console.log('Folder picker cancelled'); return null; }
  console.log('Folder selected:', result.filePaths[0]);
  return result.filePaths[0];
});

// ── Export / Import ───────────────────────────────────────────
ipcMain.handle('export-backup-manual', async (event, { userName }) => {
  const settings = getSettings();
  const filename = 'ECCM_Caseload_Backup_' + (userName||'User').replace(/\s+/g,'_') + '.json';
  const defaultPath = settings.backupFolder ? path.join(settings.backupFolder, filename) : filename;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Records', defaultPath,
    filters: [{ name: 'ECCM Records', extensions: ['json'] }],
    buttonLabel: 'Export Records'
  });
  if (result.canceled) return { success: false, canceled: true };
  try {
    fs.copyFileSync(dataFile, result.filePath);
    console.log('Records exported:', result.filePath, fs.statSync(result.filePath).size, 'bytes');
    return { success: true, path: result.filePath };
  } catch(e) { return { success: false, error: e.message }; }
});

// One-time migration cleanup — removes the old pre-UID backup file
// from the Records Folder once the new UID-suffixed file has been
// written, so SCs don't end up with two stale-looking backup files
// sitting side by side after updating to 1.4.0+.
ipcMain.handle('rename-old-backup', (event, { folderPath, oldUserId, newUserId }) => {
  try {
    const oldFilename = 'ECCM_Caseload_Backup_' + oldUserId + '.json';
    const oldPath = path.join(folderPath, oldFilename);
    if (oldUserId !== newUserId && fs.existsSync(oldPath)) {
      fs.unlinkSync(oldPath);
      console.log('Migration cleanup: removed old backup file', oldFilename);
    }
    return { success: true };
  } catch (e) {
    console.error('Migration cleanup error:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('export-backup-auto', (event, { userName, folderPath }) => {
  try {
    const filename = 'ECCM_Caseload_Backup_' + (userName||'User').replace(/\s+/g,'_') + '.json';
    const destPath = path.join(folderPath, filename);
    fs.copyFileSync(dataFile, destPath);
    console.log('Auto-sync written:', destPath, fs.statSync(destPath).size, 'bytes');
    writeNamedBackup(userName);
    return { success: true, path: destPath };
  } catch(e) { console.error('Auto-sync error:', e); return { success: false, error: e.message }; }
});

// ── Azure Blob Storage sync ───────────────────────────────────
// Third backup tier. Same filename convention as the Records Folder
// copy, so the Supervisor View reads the same name from Azure.
// On failure (no internet, SAS issue, etc), the upload is queued to
// disk and automatically retried on the next successful attempt or
// app launch — local and Records Folder saves are never blocked by
// Azure being unreachable.
ipcMain.handle('sync-to-azure', async (event, { userName, jsonString }) => {
  const filename = 'ECCM_Caseload_Backup_' + (userName||'User').replace(/\s+/g,'_') + '.json';
  const result = await uploadToAzure(filename, jsonString);
  if (result.success) {
    clearPendingAzureUpload();
    console.log('Azure sync succeeded:', filename);
    return { success: true };
  } else {
    savePendingAzureUpload(filename, jsonString);
    console.error('Azure sync failed, queued for retry:', result.error);
    return { success: false, error: result.error, queued: true };
  }
});

// Called on app launch (and can be called any time) to flush a
// previously-failed Azure upload if one is queued.
ipcMain.handle('retry-pending-azure', async () => {
  const pending = getPendingAzureUpload();
  if (!pending) return { success: true, hadPending: false };
  const result = await uploadToAzure(pending.filename, pending.data);
  if (result.success) {
    clearPendingAzureUpload();
    console.log('Pending Azure upload flushed successfully:', pending.filename);
    return { success: true, hadPending: true };
  } else {
    console.error('Pending Azure upload retry failed, still queued:', result.error);
    return { success: false, hadPending: true, error: result.error };
  }
});

ipcMain.handle('has-pending-azure', () => {
  return !!getPendingAzureUpload();
});

ipcMain.handle('import-backup', async () => {
  if (mainWindow) mainWindow.focus();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Records',
    filters: [{ name: 'ECCM Records', extensions: ['json'] }],
    properties: ['openFile'], buttonLabel: 'Import'
  });
  if (result.canceled) return null;
  try {
    const raw = fs.readFileSync(result.filePaths[0], 'utf8');
    const data = JSON.parse(raw);
    console.log('Backup imported:', path.basename(result.filePaths[0]), '- clients:', data?.clients?.length ?? 0);
    return { data, name: path.basename(result.filePaths[0]) };
  } catch(e) { return { error: e.message }; }
});

// ── Import Caseload from CSV (HCSIS roster report) ─────────
ipcMain.handle('import-csv-caseload', async () => {
  if (mainWindow) mainWindow.focus();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Caseload CSV',
    filters: [{ name: 'CSV Files', extensions: ['csv'] }],
    properties: ['openFile'], buttonLabel: 'Import'
  });
  if (result.canceled) return null;
  try {
    const raw = fs.readFileSync(result.filePaths[0], 'utf8');
    console.log('Caseload CSV read:', path.basename(result.filePaths[0]));
    return { text: raw, name: path.basename(result.filePaths[0]) };
  } catch(e) { return { error: e.message }; }
});

ipcMain.handle('list-backups', () => {
  try {
    const settings = getSettings();
    const folder = settings.backupFolder;
    if (!folder || !fs.existsSync(folder)) return { files: [], folder: null };
    const files = fs.readdirSync(folder)
      .filter(f => f.startsWith('ECCM_Caseload_Backup_') && f.endsWith('.json'))
      .map(f => {
        const fullPath = path.join(folder, f);
        try {
          const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
          const allC = data?.clients?.length ?? 0;
          const activeC = data?.clients?.filter(c => c.status === 'Active').length ?? 0;
          return { name: f, path: fullPath, scName: data?.user?.name||'Unknown', coach: data?.user?.coach||'', clients: allC, activeClients: activeC, modified: fs.statSync(fullPath).mtime.toISOString() };
        } catch(e) { return null; }
      }).filter(Boolean).sort((a,b) => new Date(b.modified) - new Date(a.modified));
    console.log('Backups listed:', files.length, 'files in', folder);
    return { files, folder };
  } catch(e) { return { files: [], folder: null }; }
});

ipcMain.handle('load-backup-file', (event, filePath) => {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    console.log('Backup file loaded:', filePath, '- clients:', data?.clients?.length ?? 0);
    return { data };
  } catch(e) { return { error: e.message }; }
});

ipcMain.handle('export-json', async (event, { data, filename }) => {
  const settings = getSettings();
  const defaultPath = settings.backupFolder ? path.join(settings.backupFolder, filename) : filename;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Export File', defaultPath,
    filters: [{ name: 'ECCM Records', extensions: ['json'] }],
    buttonLabel: 'Save'
  });
  if (result.canceled) return { success: false, canceled: true };
  try {
    fs.writeFileSync(result.filePath, data, 'utf8');
    console.log('JSON exported:', result.filePath, data.length, 'bytes');
    return { success: true, path: result.filePath };
  } catch(e) { return { success: false, error: e.message }; }
});

ipcMain.handle('export-excel', async (event, { data, filename }) => {
  const settings = getSettings();
  const defaultPath = settings.backupFolder ? path.join(settings.backupFolder, filename) : filename;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Caseload Pages', defaultPath,
    filters: [{ name: 'Excel Files', extensions: ['xlsx'] }],
    buttonLabel: 'Export'
  });
  if (result.canceled) return { success: false, canceled: true };
  try {
    fs.writeFileSync(result.filePath, Buffer.from(data, 'base64'));
    console.log('Excel exported:', result.filePath, fs.statSync(result.filePath).size, 'bytes');
    return { success: true, path: result.filePath };
  } catch(e) { return { success: false, error: e.message }; }
});

// ── Close / Sync ──────────────────────────────────────────────
ipcMain.handle('close-confirmed', () => {
  console.log('Close confirmed - exiting');
  // Records Folder and Azure writes already happened in the renderer's
  // pre-close handler (onAppClosing) before this was called — that path
  // correctly uses the UID-suffixed filename via getUserId(). This used
  // to do its own redundant write here using name-only (no UID), which
  // would silently undo the UID migration on every close. Removed.
  app.exit(0);
});

ipcMain.handle('mark-unsaved', () => true);
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('open-folder', (event, p) => { shell.openPath(p); });

// ── Auto-update IPC ───────────────────────────────────────────
ipcMain.handle('check-for-updates', () => {
  if (autoUpdater) {
    try {
      // checkForUpdates() returns a Promise — a synchronous try/catch here
      // only catches a synchronous throw, not that promise's own rejection.
      // The actual error is already reported via the autoUpdater.on('error')
      // listener above; this .catch() just prevents Node from flagging it
      // as an unhandled rejection on top of that.
      autoUpdater.checkForUpdates().catch(() => {});
    }
    catch(e) { sendUpdateStatus('error', {}); }
  } else {
    sendUpdateStatus('not-available', {});
  }
});

ipcMain.handle('download-update', () => {
  if (autoUpdater) {
    try { autoUpdater.downloadUpdate(); }
    catch(e) { console.error('Download error:', e); }
  }
});

ipcMain.handle('install-update', () => {
  if (autoUpdater) autoUpdater.quitAndInstall();
});
