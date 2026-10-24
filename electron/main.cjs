const { app, BrowserWindow, protocol, net, ipcMain, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { recognizeSong, timedLyrics } = require('./online.cjs');
protocol.registerSchemesAsPrivileged([{ scheme: 'musicsections', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
let win;
let lastLookup = 0;
const cache = new Map();
app.setName('Music Sections');
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
function createWindow() {
  win = new BrowserWindow({ width: 1440, height: 940, minWidth: 900, minHeight: 650, backgroundColor: '#10151f', title: 'Music Sections', icon: path.join(__dirname, '..', 'dist', 'app-icon.png'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (url !== 'musicsections://app/index.html') event.preventDefault(); });
  win.loadURL('musicsections://app/index.html');
}
if (single) app.whenReady().then(() => {
  protocol.handle('musicsections', request => {
    const url = new URL(request.url);
    if (url.host !== 'app') return new Response('Not found', { status: 404 });
    const root = path.resolve(__dirname, '..', 'dist');
    let target;
    try { target = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)); } catch { return new Response('Bad path', { status: 400 }); }
    if (!target.startsWith(root + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(target).toString());
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  for (const [channel, handler] of [['recognize-song', recognizeSong], ['timed-lyrics', timedLyrics]]) ipcMain.handle(channel, (event, input) => {
    if (event.senderFrame?.url !== 'musicsections://app/index.html') throw new Error('Unsupported origin');
    return handler(input);
  });
  ipcMain.handle('lookup-title', async (event, text) => {
    if (event.senderFrame?.url !== 'musicsections://app/index.html') throw new Error('Unsupported origin');
    if (typeof text !== 'string' || text.trim().length < 2 || text.length > 160) throw new Error('Enter a song title (2–160 characters).');
    const query = text.trim();
    if (cache.has(query)) return cache.get(query);
    if (Date.now() - lastLookup < 1200) throw new Error('Please wait a moment before searching again.');
    lastLookup = Date.now();
    const endpoint = new URL('https://musicbrainz.org/ws/2/recording/');
    endpoint.search = new URLSearchParams({ query, fmt: 'json', limit: '8' }).toString();
    const response = await fetch(endpoint, { headers: { 'User-Agent': 'MusicSections/0.1.0 (local desktop prototype)', Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    if (response.status === 503) throw new Error('Song lookup is busy. Try again later, or enter the title yourself.');
    if (!response.ok) throw new Error('Song lookup is unavailable. You can enter the title yourself.');
    const result = await response.json(); cache.set(query, result); return result;
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
