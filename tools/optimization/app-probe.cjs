// 使用独立数据目录运行原版或构建版，用于同机对比，避免改动用户数据。
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');
const root = path.resolve(__dirname, '../..');
const mode = process.argv[2] || 'original';
app.setPath(
  'userData',
  path.join(
    root,
    '.dev',
    'profiles',
    process.env.YESPLAYMUSIC_PROBE_PROFILE || mode
  )
);
app.commandLine.appendSwitch('remote-debugging-port', '9333');
app.commandLine.appendSwitch('mute-audio');
const main =
  mode === 'original'
    ? path.join(root, '.dev/original-source/background.js')
    : path.join(root, 'dist_electron/bundled/background.js');
app.on('browser-window-created', (_event, win) => {
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.log('[renderer]', message);
  });
});
app.whenReady().then(() => {
  setInterval(() => {
    fs.writeFileSync(
      path.join(root, '.dev', mode + '-metrics.json'),
      JSON.stringify({
        pid: process.pid,
        metrics: app.getAppMetrics(),
      })
    );
  }, 2000).unref();
});
require(main);
// Electron 13 的默认启动器可能在载入脚本前已发出 ready。
if (app.isReady()) app.emit('ready');
