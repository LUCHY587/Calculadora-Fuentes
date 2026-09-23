'use strict';
const { app, BrowserWindow, ipcMain, net, shell, Menu, powerMonitor, clipboard, ClipboardItem, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { createService } = require('./data-service');
const { autoUpdater } = require('electron-updater');

const REFRESH_EVERY_MS = 2 * 60 * 60 * 1000; // verifica los índices cada 2 horas mientras la app está abierta
const STALE_AFTER_MS = 30 * 60 * 1000; // y al volver a la ventana si pasaron más de 30 minutos
const UPDATE_CHECK_EVERY_MS = 4 * 60 * 60 * 1000; // busca una versión nueva cada 4 horas mientras la app está abierta

// ---------------------------------------------------------------- actualización automática
// Baja sola cualquier versión nueva que se publique y la instala cuando la persona cierra la
// app (nunca en medio de un cálculo): no muestra diálogos ni pide nada. Si algo falla (sin
// internet, todavía no se publicó ninguna versión, etc.) queda callado y la app sigue como si
// nada: la actualización automática nunca puede impedir que alguien use la calculadora.
function setupAutoUpdate() {
  if (!app.isPackaged) return; // en desarrollo no hay nada publicado: no tiene sentido buscar
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', () => {}); // sin conexión, repositorio sin releases todavía, etc.: no molesta a nadie
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, UPDATE_CHECK_EVERY_MS);
  powerMonitor.on('resume', () => setTimeout(check, 8000));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.setAppUserModelId('ar.com.mmfuentes.calculadora-alquileres');

let win = null;
let service = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 940,
    minHeight: 640,
    title: 'Calculadora de Alquileres — M.M. Fuentes',
    backgroundColor: '#ffffff',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // La app sólo muestra su propia pantalla: los links externos se abren en el navegador.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (/^https:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  win.on('focus', () => {
    const st = service.getState();
    const last = st.checkedAt ? Date.parse(st.checkedAt) : 0;
    if (Date.now() - last > STALE_AFTER_MS) service.refresh();
  });
  win.on('closed', () => {
    win = null;
  });
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  service = createService({
    fetch: (url, opts) => net.fetch(url, opts), // usa los certificados y el proxy de Windows
    cachePath: path.join(app.getPath('userData'), 'indices-cache.json'),
    seedPath: path.join(__dirname, '..', 'data', 'seed.json'),
  });
  service.load();
  service.onChange((state) => {
    if (win && !win.isDestroyed()) win.webContents.send('indices:changed', state);
  });

  ipcMain.handle('indices:get', () => service.getState());
  ipcMain.handle('indices:refresh', () => service.refresh());
  ipcMain.handle('app:open-external', (_e, url) => {
    if (typeof url === 'string' && /^https:\/\//i.test(url)) return shell.openExternal(url);
  });
  ipcMain.handle('app:version', () => app.getVersion());
  // Plan B para "Copiar como imagen" (el camino normal es navigator.clipboard.write en la pantalla).
  ipcMain.handle('app:copy-image', async (_e, bytes) => {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > 25 * 1024 * 1024) throw new Error('Imagen inválida');
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
    return true;
  });

  // Guarda un archivo de texto (CSV) donde la persona elija: la pantalla no tiene acceso al disco.
  ipcMain.handle('app:save-file', async (e, opts) => {
    if (win && e.sender !== win.webContents) throw new Error('Origen no permitido');
    const nombre = opts && typeof opts.nombre === 'string' ? path.basename(opts.nombre) : '';
    const datos = opts && opts.datos;
    if (!/^[\w .()-]+\.csv$/i.test(nombre) || typeof datos !== 'string' || datos.length > 5 * 1024 * 1024) throw new Error('Archivo inválido');
    const r = await dialog.showSaveDialog(win, {
      title: 'Guardar listado',
      defaultPath: path.join(app.getPath('documents'), nombre),
      filters: [{ name: 'Excel (CSV)', extensions: ['csv'] }],
    });
    if (r.canceled || !r.filePath) return { guardado: false };
    fs.writeFileSync(r.filePath, datos, 'utf8');
    return { guardado: true };
  });

  createWindow();
  service.refresh(); // al abrir, siempre busca datos nuevos
  setInterval(() => service.refresh(), REFRESH_EVERY_MS);
  powerMonitor.on('resume', () => setTimeout(() => service.refresh(), 5000)); // al despertar la PC
  setupAutoUpdate();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
