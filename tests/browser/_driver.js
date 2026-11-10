
const { app, BrowserWindow } = require('electron');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');
const URL = process.env.TARGET;
const script = process.env.SCRIPT;
const out = [];
const log = (s) => { out.push(s); };
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1100, height: 800, show: false,
    webPreferences: { offscreen: true, contextIsolation: false } });
  const errors = [];
  win.webContents.on('console-message', (e, level, msg) => {
    if (level === 3) errors.push(msg);
  });
  win.webContents.on('render-process-gone', (e, d) => log('RENDER-GONE ' + JSON.stringify(d)));
  try { await win.loadURL(URL); } catch (err) { log('LOAD-FAIL ' + err.message); }
  await new Promise(r => setTimeout(r, 3000));
  let result;
  try {
    result = await win.webContents.executeJavaScript(script);
  } catch (err) { result = { error: err.message }; }
  log('RESULT ' + JSON.stringify(result));
  log('ERRORS ' + JSON.stringify(errors));
  process.stdout.write(out.join('\n'));
  app.exit(0);
});
setTimeout(() => { process.stdout.write(out.join('\n') + '\nTIMEOUT'); app.exit(2); }, 60000);
