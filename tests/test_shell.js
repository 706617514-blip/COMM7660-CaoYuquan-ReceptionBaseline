/**
 * test_shell.js — Electron 外壳的结构断言（不需要真的启动 Electron）。
 *
 * 为什么不用真的启动 Electron 来测
 * --------------------------------
 * 一个"启动 GUI 然后截图"的测试在 CI 里不可靠：需要显示器、
 * 需要几秒等待、失败信息是超时而不是原因。而这个任务真正要守的
 * 是**外壳的配置事实**——用 loadFile 而不是 loadURL、没有开
 * nodeIntegration、资源路径全是相对的。这些都能在静态层面断言，
 * 跑得快且失败信息精确。
 *
 * 真正的"双击启动 / 离线可玩"（验收判据 E1/E2）是人的判据，
 * 由 PM 确认，不由本测试冒充 —— 见设计文档 §8.5 与 AGENTS.md
 * 的「不得把自己的完成声明当作证据」。
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let count = 0;

function ok(cond, label) {
  count += 1;
  assert.ok(cond, label);
  console.log('  PASS  ' + label);
}

console.log('========================================================');
console.log('Electron 外壳结构');
console.log('========================================================');

// ---------------------------------------------------------------- 文件存在

const pkgPath = path.join(ROOT, 'package.json');
const mainPath = path.join(ROOT, 'electron', 'main.js');
const preloadPath = path.join(ROOT, 'electron', 'preload.js');

ok(fs.existsSync(pkgPath), 'package.json 存在');
ok(fs.existsSync(mainPath), 'electron/main.js 存在');
ok(fs.existsSync(preloadPath), 'electron/preload.js 存在');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const main = fs.readFileSync(mainPath, 'utf8');

/*
 * 剥掉注释再断言。
 *
 * 踩过一次：main.js 的文档注释里**故意**写着
 * 「用 loadFile 而不是 loadURL('http://...')」来解释设计理由，
 * 而裸扫全文会把这句话当成真实代码命中，报出假失败。
 * 断言必须只看代码，不看解释代码的文字。
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释
    .replace(/(^|[^:])\/\/.*$/gm, '$1'); // 行注释（避开 http:// 里的 //）
}
const mainCode = stripComments(main);

// ---------------------------------------------------------------- package.json

ok(pkg.main === 'electron/main.js',
   'package.json 的 main 指向 electron/main.js');
ok(typeof pkg.scripts.start === 'string' && pkg.scripts.start.includes('electron'),
   'scripts.start 能启动 Electron');
ok(!!pkg.devDependencies.electron,
   'electron 在 devDependencies 里');
ok(!!pkg.devDependencies['electron-builder'],
   'electron-builder 在 devDependencies 里');

// 打包时要带上游戏本体，否则装出来的应用是空的。
const files = (pkg.build && pkg.build.files) || [];
ok(files.some((f) => f.startsWith('game/')),
   '打包配置包含 game/（否则装出来的应用没有游戏）');
ok(files.some((f) => f.startsWith('electron/')),
   '打包配置包含 electron/');

// ---------------------------------------------------------------- 离线可用（E2）

/*
 * 这是本任务最关键的一条：**不许用 loadURL 指向 http://**。
 * 一旦有人改成"先起个本地服务器再 loadURL"，离线可用就没了，
 * 而那正是"独立应用"与"网页版"的分界。
 */
ok(mainCode.includes('loadFile'),
   '用 loadFile 加载本地文件（E2 离线可用的基础）');
ok(!/loadURL\s*\(\s*['"`]https?:/.test(mainCode),
   '没有 loadURL 指向 http:// 或 https://');

// ---------------------------------------------------------------- 安全姿态

ok(/nodeIntegration:\s*false/.test(mainCode),
   'nodeIntegration 关着（页面不需要 Node 能力）');
ok(/contextIsolation:\s*true/.test(mainCode),
   'contextIsolation 开着');
ok(!/nodeIntegration:\s*true/.test(mainCode),
   '没有把 nodeIntegration 打开');

/*
 * webSecurity:false 在这里是**有意为之**的理由必须写在代码里，
 * 否则下一个人会以为是疏忽而"修好"它，然后游戏在 file:// 下
 * 加载不出 PNG（Phaser 走 XHR，file:// 默认被 CORS 拦）。
 */
ok(/webSecurity:\s*false/.test(mainCode),
   'webSecurity 关着（file:// 下 Phaser 的 XHR 读图需要）');
ok(/CORS|XHR|file:\/\//.test(main),
   'webSecurity:false 的理由写在代码里（避免被误当疏忽修掉）');

// ---------------------------------------------------------------- 资源路径（E2）

/*
 * 独立应用走 file://，任何 http:// 或绝对路径的引用都会 404。
 * 这里扫 index.html 的脚本引用与 app.js 的资源加载。
 */
const htmlPath = path.join(ROOT, 'game', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const scriptSrcs = html.match(/<script[^>]+src="([^"]+)"/g) || [];
ok(scriptSrcs.length > 0, 'index.html 有脚本引用（扫描有效）');
ok(!scriptSrcs.some((s) => /src="(https?:)?\/\//.test(s)),
   'index.html 的脚本引用没有绝对 URL');
ok(!scriptSrcs.some((s) => /src="\//.test(s)),
   'index.html 的脚本引用没有以 / 开头的绝对路径');

const appJs = fs.readFileSync(path.join(ROOT, 'game', 'app.js'), 'utf8');
const imgLoads = appJs.match(/load\.image\([^)]*\)/g) || [];
ok(imgLoads.length > 0, 'app.js 有图片加载（扫描有效）');
ok(!imgLoads.some((l) => /https?:\/\//.test(l)),
   'app.js 的图片加载没有 http:// 引用');

// ---------------------------------------------------------------- 不联网

ok(!/require\(['"]https?['"]\)/.test(mainCode),
   'main.js 没有引入网络模块');

console.log('========================================================');
console.log('全部通过：' + count + ' 项断言');
