/**
 * electron/main.js — Kill the Vines 的桌面外壳。
 *
 * 为什么是外壳而不是移植
 * ----------------------
 * 游戏本身是纯静态资源（HTML + JS + PNG），没有任何后端依赖，
 * 也没有 http:// 或绝对路径引用（2026-11-15 实测：index.html 的
 * 脚本引用与 app.js 的 load.image 全部是相对路径）。
 * 所以"做成独立应用"不需要重写游戏，只需要一个能加载本地文件、
 * 提供窗口、并把存档落到磁盘的容器。Electron 就是这个容器。
 *
 * 三条硬约束（来自设计文档 §8.4，测试会盯）
 * ----------------------------------------
 *   1. 用 loadFile 而不是 loadURL('http://...')
 *      —— 这是"离线可用"（验收判据 E2）的实现基础。一旦改成
 *      loadURL 指向本地服务器，拔掉网线或关掉服务器，游戏就打不开，
 *      那它就不算独立应用。
 *
 *   2. 不开 nodeIntegration
 *      —— 游戏代码不需要 Node 能力，开了等于把整个文件系统暴露给
 *      一个会读取外部数据（存档码、玩家输入）的页面。contextIsolation
 *      保持 true 是这里的默认安全姿态。
 *
 *   3. 不申请任何联网权限
 *      —— 应用不访问网络。若将来要加联网功能，必须是显式的一步，
 *      而不是靠默认值溜进来。
 */

const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

/*
 * ELECTRON_RUN_AS_NODE 必须在任何 Electron API 之前清掉，而且要在这里清，
 * 不能只靠启动脚本。
 *
 * 2026-11-15 实测：DSH Harness（以及任何"借 Electron 当 Node 用"的工具）
 * 会把 ELECTRON_RUN_AS_NODE 设为 1。在这个值下 Electron **不启动窗口系统**，
 * `require('electron')` 返回的 app / BrowserWindow 都是 undefined，
 * 于是 `app.whenReady()` 抛：
 *
 *     TypeError: Cannot read properties of undefined (reading 'whenReady')
 *
 * 这个错误看起来像"Electron 装坏了"，实际只是环境变量。
 * 我们**不能**在运行时改自己进程的这个变量（Electron 已经在启动时读过了），
 * 所以真正的修法是**启动时就没有它**：
 *   - package.json 的 start 脚本用 `env -u ELECTRON_RUN_AS_NODE`
 *   - 下面这段是第二道保险 + 自解释的文档，让下次踩到的人立刻看懂。
 *
 * 这里只做检测与明确报错，不做"自动重启"——重启自己会带来
 * 递归启动和孤儿进程的风险，不值得。
 */
if (process.env.ELECTRON_RUN_AS_NODE && !app) {
  console.error(
    '\n启动失败：ELECTRON_RUN_AS_NODE 被设为 ' +
    JSON.stringify(process.env.ELECTRON_RUN_AS_NODE) + '。\n' +
    '在这个值下 Electron 只跑 Node，没有窗口系统，因此 app 是 undefined。\n' +
    '\n修法（任选其一）：\n' +
    '  npm start / pnpm start        —— 脚本里已经带 env -u，直接用它\n' +
    '  env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron .\n' +
    '  unset ELECTRON_RUN_AS_NODE && electron .\n'
  );
  process.exit(1);
}

/**
 * 画布是 960×600（app.js:48 的 W / HGT），#frame 用 aspect-ratio:960/600
 * 做等比缩放。所以窗口给 960×600 的整数倍最合适：
 * 1200×750 = 1.25 倍，在常见屏幕上既不局促也不溢出。
 *
 * 窗口尺寸只影响初始大小，不限制缩放 —— 页面本身是响应式的，
 * 玩家拉大拉小都能自适应（验收判据 E4）。
 */
const WIN_W = 1200;
const WIN_H = 750;

function createWindow() {
  const win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    minWidth: 640,
    minHeight: 400,
    backgroundColor: '#0b1117',   // 与游戏的暗色底色一致，避免启动白闪
    title: 'Kill the Vines',
    webPreferences: {
      // 游戏不需要 Node，关掉是这里唯一正确的默认值。
      nodeIntegration: false,
      // 与 nodeIntegration:false 配套；留着它才能在需要时安全地
      // 通过 preload 暴露受控接口（当前 preload 是空的，见 preload.js）。
      contextIsolation: true,
      // 本地文件之间允许同源加载：Phaser 用 XHR 读 PNG，
      // 在 file:// 下默认会被 CORS 拦住。这一项是让 load.image 工作的关键。
      webSecurity: false,
    },
  });

  // 开发期保留 DevTools 快捷键，但不自动打开 —— 双击启动就该直接进游戏。
  win.loadFile(path.join(__dirname, '..', 'game', 'index.html'));

  return win;
}

/**
 * 菜单：去掉默认菜单栏。
 *
 * 默认菜单里有一堆和游戏无关的东西（Reload / Toggle DevTools / Zoom…
 * 以及 macOS 上的 Services），对一个"双击就玩"的游戏是噪音。
 * 但完全删掉菜单会让 Cmd+Q / Ctrl+Q 失效，玩家关不掉窗口，
 * 所以保留一个最小的、只有退出项的菜单。
 */
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [];

  if (isMac) {
    // macOS 的第一个菜单必须是应用菜单，否则 Cmd+Q 不生效。
    template.push({
      label: app.name,
      submenu: [{ role: 'quit', label: '退出 Kill the Vines' }],
    });
  } else {
    template.push({
      label: '文件',
      submenu: [{ role: 'quit', label: '退出' }],
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();

  // macOS：点 Dock 图标且没有窗口时重开一个。
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 非 macOS：关掉所有窗口就退出应用。
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
