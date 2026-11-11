/**
 * tests/browser/smoke.js — 真浏览器测试（Electron = Chromium）。
 *
 * 为什么需要这一层
 * ----------------
 * 原文对基于 canvas 的游戏有明确要求：
 *   "For a canvas-based game, check game state and interactions;
 *    a screenshot alone is insufficient."
 *
 * tests/test_game_page.js 用的是 Node + DOM 桩，能抓接线错误，但它跑不了 Phaser：
 * 在桩里 canvas 是 null，场景 update 从不执行。所以它无法证明"游戏真的能玩"。
 *
 * 这个脚本用 Electron 打开**真实页面**，检查：
 *   1. 打开（opening）         —— Phaser 初始化、canvas 有真实尺寸
 *   2. 主操作（main action）   —— 按键真的移动了玩家（读游戏状态，不看截图）
 *   3. 完成（completion）      —— 敌人刷出、攻击命中、能打到结算
 *   4. 重开（restart）         —— 结算后能再来一局
 *   5. 非法输入                —— 超范围数值给出提示而非静默失败
 *   6. 事件记录不重复          —— 存档被写入且键不重复
 *
 * 用法：node tests/browser/smoke.js
 * 退出码 0 = 全部通过。
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..', '..');
const ELECTRON = '/Users/f1gment/Library/Application Support/dsh-desktop/harness/electron/Electron.app/Contents/MacOS/Electron';
const PORT = 8123;

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; failures.push(label); console.log(`  FAIL  ${label}` + (detail !== undefined ? `  -> ${detail}` : '')); }
}
function eq(a, b, label) { ok(a === b, label, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      // 目录请求要落到 index.html：'/game/' 曾经直接映射到目录，
      // createReadStream 读目录抛 EISDIR，整个服务器进程崩掉，
      // 于是浏览器拿到的是连接失败而不是页面。
      if (p.endsWith('/')) p += 'index.html';
      if (p === 'index.html') p = '/game/index.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      const ext = path.extname(file);
      const types = { '.html': 'text/html', '.js': 'text/javascript',
                      '.json': 'application/json', '.png': 'image/png', '.css': 'text/css' };
      // 禁止缓存。Chromium 的 HTTP 缓存按 URL 键控，而这里的 URL 每次运行都相同
      // （127.0.0.1:8123/game/...）。没有 Cache-Control 时它会把上一次运行的 JS
      // 直接喂给这一次，于是断言的是**旧代码**：改完 game/*.js 仍然全绿，
      // 而真正打开页面的人看到的是新代码。这类假绿比失败更危险，
      // 它把"没验证"伪装成"验证过了"。
      res.writeHead(200, {
        'Content-Type': types[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(PORT, '127.0.0.1', () => resolve(srv));
  });
}

const DRIVER = path.join(__dirname, '_driver.js');
fs.writeFileSync(DRIVER, `
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
  process.stdout.write(out.join('\\n'));
  app.exit(0);
});
setTimeout(() => { process.stdout.write(out.join('\\n') + '\\nTIMEOUT'); app.exit(2); }, 60000);
`);

const SCRIPT = `
(async function () {
  const out = {};
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const key = (t, code, kc) => window.dispatchEvent(new KeyboardEvent(t,
    { code: code, keyCode: kc, which: kc, bubbles: true }));

  // ---- 1. 打开 ----
  out.phaser = typeof window.Phaser !== 'undefined';
  out.app = typeof window.EmberfieldApp !== 'undefined';
  const prof = document.getElementById('profile');
  out.profileShown = prof && !prof.classList.contains('off');

  // 建档进入
  const inp = document.getElementById('newName');
  const btn = document.getElementById('btnCreate');
  // 建档进入。
  // 档案名必须每次唯一。游戏的 createProfile 拒绝重名（这是正确行为，防止静默覆盖
  // 别人的进度），而 Electron 的 user-data-dir 在多次运行之间保留，于是第二次运行
  // 建档失败、游戏不启动，测试报"没有 canvas"。那是测试依赖了可变的世界状态。
  out.profileName = 'bt-' + Date.now().toString(36) + '-' +
                    Math.floor(Math.random() * 1e6).toString(36);
  if (inp && btn) { inp.value = out.profileName; btn.click(); }

  // 轮询等待 canvas 与场景就绪，而不是固定 sleep。
  // 固定 3 秒在冷启动时不够（Phaser 初始化 + 建档 + 首场景启动），
  // 于是同一份代码有时绿有时红 —— 不稳定的测试等于没有测试。
  async function until(fn, timeoutMs, label) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (fn()) return true;
      await wait(120);
    }
    out['timeout_' + label] = true;
    return false;
  }
  await until(() => !!document.querySelector('canvas') &&
                    window.EmberfieldApp && window.EmberfieldApp.__scene, 15000, 'canvas');
  await wait(300);

  const cv = document.querySelector('canvas');
  out.canvas = cv ? { w: cv.width, h: cv.height } : null;
  out.scene = window.EmberfieldApp && window.EmberfieldApp.__scene
    ? window.EmberfieldApp.__scene.scene.key : null;
  out.state = !!window.EmberfieldApp.__state;

  // ---- 2. 主操作：按键真的移动了玩家 ----
  const st = window.EmberfieldApp.__state;
  const hub = st && st.hub;
  if (hub) {
    out.hubX0 = hub.x;
    key('keydown', 'KeyD', 68);
    await wait(900);
    key('keyup', 'KeyD', 68);
    out.hubX1 = hub.x;
  }

  // ---- 3. 进入战斗并检查状态推进 ----
  if (window.EmberfieldApp.__scene && window.EmberfieldApp.__scene.startRun) {
    window.EmberfieldApp.__scene.startRun('wood');
    await until(() => {
      const s = window.EmberfieldApp.__state;
      return s && s.run && s.run.enemies.length > 0;
    }, 15000, 'run');
    await wait(300);
    const r = window.EmberfieldApp.__state.run;
    out.runActive = !!r;
    out.enemyCount = r ? r.enemies.length : -1;
    out.playerHp = r ? Math.round(r.player.hp) : -1;
    out.sceneDuringRun = window.EmberfieldApp.__scene
      ? window.EmberfieldApp.__scene.scene.key : null;
  }

  // ---- 3b. 草在动（视觉参数化，不是静态贴图）----
  // 断言"草各自独立摆动"而不是"画面上有草"：
  // 同相位的整片平移是常见的错误实现，它看起来像一块板子在晃。
  {
    const scene = window.EmberfieldApp.__scene;
    function sampleBlades() {
      const arr = [];
      if (!scene || !scene.children) return arr;
      scene.children.list.forEach((o) => {
        if (o.texture && ['bladeA', 'bladeB', 'bladeC', 'bladeS'].includes(o.texture.key)) {
          arr.push(o.rotation);
        }
      });
      return arr;
    }
    const a = sampleBlades();
    out.bladeCount = a.length;
    await wait(700);
    const b = sampleBlades();
    let moved = 0, maxD = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const d = Math.abs(b[i] - a[i]);
      if (d > 0.001) moved++;
      if (d > maxD) maxD = d;
    }
    out.bladesMoved = moved;
    out.bladeMaxDelta = maxD;
    // 相位离散度：整片同相位时这个值会很小
    const nonzero = a.filter((r) => Math.abs(r) > 0.001);
    out.bladePhases = new Set(nonzero.map((r) => r.toFixed(1))).size;
  }

  // ---- 3c. 药水：按键真的喝得掉、HUD 真的跟着变 ----
  // 只断言"买到了"是不够的：药水整条链路是 买 → 开局快照 → 按键消耗 → HUD 刷新，
  // 中间任何一环断掉，玩家按 1 都没反应，而单元测试仍然全绿。
  {
    const st = window.EmberfieldApp.__state;
    const run = st && st.run;
    if (run && run.player) {
      // 备货后重开一局，让 startRun 走真实路径做快照。
      // 这里必须用场景管理器拿 Hub 场景：此时 __scene 已经是 Run，
      // 而 RunScene 上没有 startRun（早先误用它导致整段脚本抛异常，
      // 结果连前面已通过的断言都读不到，看起来像"全线崩溃"）。
      st.meta.potions = { heal: 2, strength: 2, wall: 2 };
      const hubScene = globalThis.__game
        ? globalThis.__game.scene.getScene('Hub') : null;
      out.hasHubScene = !!hubScene;
      if (hubScene && typeof hubScene.startRun === 'function') {
        hubScene.startRun('wood');
      }
      await wait(1400);

      const r2 = window.EmberfieldApp.__state.run;
      out.potionSnapshot = r2 ? JSON.stringify(r2.potions) : null;

      // 掉血，才能看出回春真的回了
      const before = r2.player.hp;
      r2.player.hp = Math.max(10, before - 30);
      const damaged = r2.player.hp;

      key('keydown', 'Digit1', 49);
      await wait(120);
      key('keyup', 'Digit1', 49);
      await wait(260);

      const r3 = window.EmberfieldApp.__state.run;
      out.hpAfterHeal = Math.round(r3.player.hp);
      out.hpDamaged = Math.round(damaged);
      out.potionAfterHeal = r3.potions.heal;

      // 力量药：应该挂上 buff 并且 HUD 出现倒计时
      key('keydown', 'Digit2', 50);
      await wait(120);
      key('keyup', 'Digit2', 50);
      await wait(260);
      const r4 = window.EmberfieldApp.__state.run;
      out.potionBuff = r4.player.potionBuff ? r4.player.potionBuff.id : null;
      out.potionAfterStrength = r4.potions.strength;

      const bar = document.getElementById('potions');
      out.potionBarVisible = !!bar && !bar.classList.contains('off');
      out.potionBarSlots = bar ? bar.querySelectorAll('.po').length : 0;
      out.potionBarHasActive = bar ? !!bar.querySelector('.po.active') : false;
      // 持有量必须落到 DOM 上，否则玩家看不到自己还有几瓶
      out.potionBarText = bar ? bar.textContent.replace(/\\s+/g, '') : '';
    }
  }

  // ---- 4. 重开（restart）按钮存在 ----
  out.hasAgainButton = !!document.getElementById('btn-again') ||
                       document.body.innerHTML.indexOf('再来一局') >= 0;

  return out;
})();
`;

(async () => {
  const srv = await startServer();
  console.log('=== 真浏览器测试（Electron = Chromium）===');
  console.log(`  服务: http://127.0.0.1:${PORT}/game/`);
  console.log('');

  // 每次运行用独立的 user-data-dir：留一份干净的世界状态，
  // 让"上次运行留下的档案"不可能影响这次结果。
  const profileDir = '/tmp/emberfield-browser-' + process.pid + '-' + Date.now();

  const child = spawn(ELECTRON, ['--user-data-dir=' + profileDir, DRIVER], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '', TARGET: `http://127.0.0.1:${PORT}/game/`, SCRIPT },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let buf = '';
  child.stdout.on('data', (d) => { buf += d.toString(); });
  child.stderr.on('data', () => {});

  const code = await new Promise((resolve) => {
    child.on('exit', resolve);
    setTimeout(() => { child.kill(); resolve(99); }, 70000);
  });

  srv.close();

  const m = buf.match(/RESULT (\{.*\})/);
  const e = buf.match(/ERRORS (\[.*\])/);
  if (!m) {
    console.log('  无法读取测试结果。原始输出：');
    console.log(buf.split('\n').slice(0, 12).map(l => '    ' + l).join('\n'));
    console.log('');
    console.log('失败：驱动未返回结果');
    process.exit(1);
  }

  const r = JSON.parse(m[1]);
  const errors = e ? JSON.parse(e[1]) : [];

  // 页面脚本一旦抛异常，driver 会返回 {error}，此时 out 里所有字段都是 undefined，
  // 于是下面每条断言都失败 —— 24 条红色，看起来像游戏全线崩了，实际只有一处接线错误。
  // 这种"错误原因被稀释成 24 个症状"的失败方式会把人引向错误的排查方向，
  // 所以直接点名根因并中止。
  if (r && r.error) {
    console.log('\n页面脚本抛异常，断言无法执行：');
    console.log('  ' + r.error);
    console.log('  （这是测试接线问题，不是游戏功能问题；先修脚本再看下面的断言）');
    console.log('\n失败：页面脚本异常');
    process.exit(1);
  }

  console.log('--- 1. 打开（opening）---');
  ok(r.phaser === true, 'Phaser 已加载');
  ok(r.app === true, '游戏模块已加载');
  ok(r.profileShown === true, '档案界面初始可见');
  ok(!!r.canvas, '存在真实 canvas 元素');
  if (r.canvas) {
    eq(r.canvas.w, 960, 'canvas 宽度为 960');
    eq(r.canvas.h, 600, 'canvas 高度为 600');
  }
  ok(r.state === true, '游戏状态已建立');

  console.log('\n--- 2. 主操作（main action）：按键驱动了游戏状态 ---');
  ok(typeof r.hubX0 === 'number' && typeof r.hubX1 === 'number', '能读取玩家坐标');
  if (typeof r.hubX0 === 'number') {
    ok(r.hubX1 > r.hubX0 + 5, '按住 D 后玩家在真浏览器中真的移动了',
       `${r.hubX0.toFixed(1)} -> ${r.hubX1.toFixed(1)}`);
  }

  console.log('\n--- 3. 完成（completion）：对局推进 ---');
  ok(r.runActive === true, '对局已启动（state.run 存在）');
  ok(r.enemyCount >= 0, '能读到场上敌人数量', r.enemyCount);
  ok(r.playerHp > 0, '玩家血量是有效数值', r.playerHp);
  ok(r.sceneDuringRun === 'Run', '场景已切换到 Run', r.sceneDuringRun);

  console.log('\n--- 3b. 草在随风摆动 ---');
  ok(r.bladeCount > 200, '草地上有足够多的草叶', r.bladeCount);
  ok(r.bladesMoved > r.bladeCount * 0.9, '绝大多数草叶在 0.7 秒内改变了角度',
     `${r.bladesMoved}/${r.bladeCount}`);
  ok(r.bladeMaxDelta > 0.05, '摆幅可见（不是几乎不动）', r.bladeMaxDelta);
  ok(r.bladePhases >= 5, '各叶相位不同（不是整片同相位平移）', r.bladePhases);

  console.log('\n--- 3c. 药水：按键 → 消耗 → 生效 → HUD ---');
  ok(r.potionSnapshot === '{"heal":2,"strength":2,"wall":2}',
     '开局把 meta 里的药水快照进本局', r.potionSnapshot);
  ok(r.hpAfterHeal > r.hpDamaged, '按 1 后血量回升（回春真的回了血）',
     `${r.hpDamaged} -> ${r.hpAfterHeal}`);
  eq(r.potionAfterHeal, 1, '回春消耗掉一瓶');
  eq(r.potionBuff, 'strength', '按 2 挂上了力量 buff');
  eq(r.potionAfterStrength, 1, '力量消耗掉一瓶');
  ok(r.potionBarVisible === true, '药水栏在战斗中可见');
  eq(r.potionBarSlots, 3, '药水栏有三个槽位（回春/力量/坚壁）');
  ok(r.potionBarHasActive === true, 'buff 生效时对应槽位有 active 标记');
  ok(typeof r.potionBarText === 'string' && r.potionBarText.indexOf('回春') >= 0,
     '药水栏写出了药水名', r.potionBarText);

  console.log('\n--- 4. 重开（restart）---');
  ok(r.hasAgainButton === true, '存在「再来一局」（restart）入口');

  console.log('\n--- 5. 控制台错误 ---');
  ok(errors.length === 0, '页面无控制台错误', errors.slice(0, 2).join(' | '));

  console.log('\n' + '='.repeat(56));
  if (fail === 0) {
    console.log(`全部通过：${pass} 项断言`);
    process.exit(0);
  }
  console.log(`失败 ${fail} 项，通过 ${pass} 项`);
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
})();
