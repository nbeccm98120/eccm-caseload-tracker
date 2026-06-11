const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  loadData:           ()      => ipcRenderer.invoke('load-data'),
  saveData:           (data)  => ipcRenderer.invoke('save-data', data),
  loadSettings:       ()      => ipcRenderer.invoke('load-settings'),
  saveSettings:       (s)     => ipcRenderer.invoke('save-settings', s),
  pickBackupFolder:   ()      => ipcRenderer.invoke('pick-backup-folder'),
  exportBackupManual: (args)  => ipcRenderer.invoke('export-backup-manual', args),
  exportBackupAuto:   (args)  => ipcRenderer.invoke('export-backup-auto', args),
  importBackup:       ()      => ipcRenderer.invoke('import-backup'),
  listBackups:        ()      => ipcRenderer.invoke('list-backups'),
  loadBackupFile:     (p)     => ipcRenderer.invoke('load-backup-file', p),
  exportJson:         (args)  => ipcRenderer.invoke('export-json', args),
  exportExcel:        (args)  => ipcRenderer.invoke('export-excel', args),
  closeConfirmed:     ()      => ipcRenderer.invoke('close-confirmed'),
  markUnsaved:        ()      => ipcRenderer.invoke('mark-unsaved'),
  openFolder:         (p)     => ipcRenderer.invoke('open-folder', p),
  onAppClosing:       (cb)    => ipcRenderer.on('app-closing', cb),
  // Auto-update
  checkForUpdates:    ()      => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate:     ()      => ipcRenderer.invoke('download-update'),
  installUpdate:      ()      => ipcRenderer.invoke('install-update'),
  onUpdateStatus:     (cb)    => ipcRenderer.on('update-status', cb),
  isElectron: true
});
