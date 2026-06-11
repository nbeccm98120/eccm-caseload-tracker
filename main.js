const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const userDataPath = app.getPath('userData');
const dataFile     = path.join(userDataPath, 'caseload_data.json');
const settingsFile = path.join(userDataPath, 'settings.json');

let mainWindow;
let isClosing = false;

// ── Auto-updater setup ────────────────────────────────────────
let autoUpdater;
try {
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  // Force update check in dev mode for debugging
  if (!app.isPackaged) {
    autoUpdater.forceDevUpdateConfig = true;
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
    }, 8000);
  });
  mainWindow.webContents.on('context-menu', (e) => { e.preventDefault(); });
  mainWindow.setMenu(null);
}

app.whenReady().then(createWindow);
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
  console.log('Close confirmed - syncing and exiting');
  try {
    const settings = getSettings();
    if (settings.backupFolder && fs.existsSync(dataFile)) {
      const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      const userName = (data?.user?.name || 'User').replace(/\s+/g, '_');
      const destPath = path.join(settings.backupFolder, 'ECCM_Caseload_Backup_' + userName + '.json');
      fs.copyFileSync(dataFile, destPath);
      console.log('Auto-sync on close:', destPath, fs.statSync(destPath).size, 'bytes');
      writeNamedBackup(userName);
    }
  } catch(e) { console.error('Sync error on close:', e); }
  app.exit(0);
});

ipcMain.handle('mark-unsaved', () => true);
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('open-folder', (event, p) => { shell.openPath(p); });

// ── Auto-update IPC ───────────────────────────────────────────
ipcMain.handle('check-for-updates', () => {
  if (autoUpdater) {
    try { autoUpdater.checkForUpdates(); }
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
