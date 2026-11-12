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
  // 第三段：面板开着的时候把窗口缩小（Task 10c）。
  // 顺序必须在 SMALLSCRIPT 之前：那一段进来时视口就该是 520x420，
  // 而这一段要的是"先在大窗口打开面板、再缩小"，反了就测不到。
  if (process.env.RESIZESCRIPT) {
    try { win.setContentSize(520, 420); } catch (err) { log('RESIZE-FAIL ' + err.message); }
    await new Promise(r => setTimeout(r, 800));
    let rs;
    try {
      rs = await win.webContents.executeJavaScript(process.env.RESIZESCRIPT);
    } catch (err) { rs = { error: err.message }; }
    log('RESIZE ' + JSON.stringify(rs));
    // 还原成大窗口，免得残留的小视口影响后面那段的登录 / 建档流程。
    try { win.setContentSize(1100, 800); } catch (err) { log('RESIZE-BACK-FAIL ' + err.message); }
    await new Promise(r => setTimeout(r, 400));
  }
  // 第二段：真正的 520x420 视口。
  // 面板"比视口大就只夹左上角"这个缺陷在 1100x800 下根本复现不了 —— 620x540
  // 在那个视口里塞得下，两条夹边断言对着坏实现也是绿的。所以必须真的把窗口改小。
  // setContentSize 设的是内容区 = innerWidth/innerHeight；setSize 含边框，会差几十像素。
  if (process.env.SMALLSCRIPT) {
    try { win.setContentSize(520, 420); } catch (err) { log('RESIZE-FAIL ' + err.message); }
    await new Promise(r => setTimeout(r, 900));
    let small;
    try {
      small = await win.webContents.executeJavaScript(process.env.SMALLSCRIPT);
    } catch (err) { small = { error: err.message }; }
    log('SMALL ' + JSON.stringify(small));
  }
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
  // 第四个参数是可选的 KeyboardEvent 初始化项。
  // 需要断言 defaultPrevented 的地方必须带 { cancelable: true }：合成事件
  // 默认 cancelable=false，那时 preventDefault() 是空操作、defaultPrevented
  // 永远是 false —— 断言会对着正确实现报假红（最小探针已实测）。
  const key = (t, code, kc, opt) => window.dispatchEvent(new KeyboardEvent(t,
    Object.assign({ code: code, keyCode: kc, which: kc, bubbles: true }, opt || {})));

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

  // ---- 1b. 音效层（Task 12）----
  // 这里量的是"真浏览器里的 AudioContext"，桩测试证明不了这件事：
  // 桩里 currentTime 是手动 tick 的，state 是自己写的字符串。
  // 建档点击已经是一次真实手势，所以此刻 ctx 应该已被创建并被 resume。
  const GA = window.GameAudio;
  out.audioExists = !!GA && typeof GA.play === 'function';
  out.audioSfxNames = GA && GA.sfxNames ? GA.sfxNames.slice() : null;
  out.audioSfxCount = out.audioSfxNames ? out.audioSfxNames.length : -1;
  if (GA) {
    /*
     * 先量"还没有任何手势时"的状态，再主动走一次启动路径。
     *
     * 建档按钮是 btn.click() 点出来的 —— 合成的 click() 不带用户激活，
     * 也不会派发 pointerdown，所以那一下**不该**被当成手势：
     * 此时 GA.context 必须是 null（惰性创建，页面加载不建 AudioContext）。
     * 上一版探针正是在这里直接读 state，读到 null 才暴露了这个假设。
     */
    out.audioCtxBeforeGesture = GA.context === null;
    GA.ensureStarted();          // 与页面手势监听里调的是同一个函数
    const cA = GA.context;
    out.audioState0 = cA ? cA.state : null;
    out.audioTime0 = cA ? cA.currentTime : -1;
    // 300ms 之后 currentTime 必须往前走：这是"音频时钟真的在跑"的唯一证据。
    // 只看 state === 'running' 会被实现骗过去（state 是字符串，谁都写得出来）。
    await wait(300);
    const cB = GA.context;
    out.audioTime1 = cB ? cB.currentTime : -1;
    out.audioSampleRate = cB ? cB.sampleRate : -1;
    out.audioSameCtx = cA === cB;

    // 21 个音效逐个真播一次。返回 true = 真的建了振荡器/噪声源。
    out.audioPlayed = {};
    out.audioPlayThrew = null;
    (out.audioSfxNames || []).forEach(function (n) {
      try { out.audioPlayed[n] = GA.play(n) === true; }
      catch (e) { out.audioPlayThrew = n + ': ' + e.message; out.audioPlayed[n] = false; }
    });

    out.audioMaster = GA.masterGain ? GA.masterGain.gain.value : null;
    GA.setMasterVolume(0);
    await wait(150);
    out.audioMasterMuted = GA.masterGain ? GA.masterGain.gain.value : null;
    out.audioClosedAfterMute = GA.context ? GA.context.state === 'closed' : true;
    out.audioTimeMuted = GA.context ? GA.context.currentTime : -1;
    // 静音期间也要能播（只是听不见）—— 静音不是"关掉音频"。
    // 必须在恢复音量**之前**量，否则这一条就变成了"正常音量下能播"。
    out.audioPlayWhileMuted = GA.play('hit') === true;
    GA.setMasterVolume(0.5);
    await wait(150);
    out.audioMasterRestored = GA.masterGain ? GA.masterGain.gain.value : null;
    out.audioStateEnd = GA.context ? GA.context.state : null;

    /*
     * 环境音（Task 23 / V19）。HubScene.create 在页面加载时就调了 startAmbient，
     * 但那一刻还没有 AudioContext（加载即建 ctx 会被自动播放策略拦），
     * 所以真正起播要等这一次 ensureStarted()。这里量的是"起播之后"的状态：
     * 名字要报 cricket，并且真的有一条自己的增益挂在 master 上。
     */
    out.ambientNameHub = typeof GA.ambientName === 'function' ? GA.ambientName() : null;
    out.ambientHasGain = !!GA.ambientGain;
    out.ambientGainValue = GA.ambientGain ? GA.ambientGain.gain.value : null;

    /*
     * 同帧连打：连段攻击一刀扫三下时，渲染层会在同一帧里调三次 play。
     * 25ms 节流必须把后两次吃掉 —— 不节流就是三份波形叠在一起爆音。
     * 这一条在真浏览器里量，是因为节流用的就是真 ctx.currentTime。
     */
    out.audioThrottle = [GA.play('slash'), GA.play('slash'), GA.play('slash')];

    /*
     * 观测点：从这一行往后，每一次经 GameAudio.play 的调用都被计数。
     *
     * 上面那 17 次是"我直接喊它播"，只能证明音效本身出得来。真正的验收问题是
     * "在游戏里按 J / 按 Tab / 按 1，代码会不会自己去播" —— 只有计数能证明。
     * 计数器放在调试探针里、不放进 audio.js：生产代码不该为测试留后门。
     */
    out.audioCalls = {};
    const origPlay = GA.play;
    GA.play = function (n) {
      out.audioCalls[n] = (out.audioCalls[n] || 0) + 1;
      return origPlay.call(GA, n);
    };
  }

  // ---- 2. 主操作：按键真的移动了玩家 ----
  // 顺便量脚步（Task 23 / V4 V5）：计数只能来自实时游戏循环，
  // 桩测试证明不了"按着 D 走会踩地板"。
  const st = window.EmberfieldApp.__state;
  const hub = st && st.hub;
  const stepSum = function () {
    const c = out.audioCalls || {};
    return (c.step1 || 0) + (c.step2 || 0) + (c.step3 || 0);
  };
  if (hub) {
    out.hubX0 = hub.x;
    const s0 = stepSum();
    key('keydown', 'KeyD', 68);
    await wait(900);
    key('keyup', 'KeyD', 68);
    out.hubX1 = hub.x;
    out.hubWalkDist = hub.x - out.hubX0;
    out.hubStepsWalk = stepSum() - s0;

    // 冲刺：同样 900ms、同样方向。位移更长，单位位移的步数也必须更多（V5）。
    const s1 = stepSum();
    const sx0 = hub.x;
    key('keydown', 'ShiftLeft', 16);
    key('keydown', 'KeyD', 68);
    await wait(900);
    key('keyup', 'KeyD', 68);
    key('keyup', 'ShiftLeft', 16);
    out.hubSprintDist = hub.x - sx0;
    out.hubStepsSprint = stepSum() - s1;

    // V4 的反证：松手之后 3 秒，一步都不许响。
    // 定时器版实现（每 300ms 响一下）在这里会露馅 —— 这正是"按位移"的意义。
    const s2 = stepSum();
    await wait(3000);
    out.hubStepsStill = stepSum() - s2;
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

  // ---- 3a2. 战斗动作真的接到了音效（Task 12）----
  // 桩测试只能证明"21 个音效各自播得出来"，证明不了"游戏里按 J 会去播"。
  // 这里按四下 J（间隔 230ms，远大于 25ms 节流窗口），期望 slash 计数上涨。
  if (window.EmberfieldApp.__state && window.EmberfieldApp.__state.run) {
    const b0 = (out.audioCalls && out.audioCalls.slash) || 0;
    for (let i = 0; i < 4; i++) {
      key('keydown', 'KeyJ', 74);
      await wait(70);
      key('keyup', 'KeyJ', 74);
      await wait(230);
    }
    out.audioSlashDelta = ((out.audioCalls && out.audioCalls.slash) || 0) - b0;
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

      // 掉血，才能看出治疗真的回了
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

  // ---- 3c2. 远征里按 Tab：背包也能开，而且战斗真的停住（Task 9）----
  // 只测 Hub 不够：Tab 的 window 监听是每个场景各注册一份的，
  // Run 那边漏接线的话，战斗里按 Tab 要么没反应，要么背包开着还在挨打。
  // 「停住了」必须用 run.elapsed 反证 —— 它由 logic 每帧 += dt，
  // 只有 Run.update 在跑才会涨；只读 isPaused() 证明不了画面真的停。
  {
    const hubForRun = globalThis.__game
      ? globalThis.__game.scene.getScene('Hub') : null;
    // 上一局已经跑了几秒，可能已经结算：重开一局，保证 elapsed 是活的
    if (hubForRun && typeof hubForRun.startRun === 'function') hubForRun.startRun('wood');
    await wait(1000);
    const runP = globalThis.__game ? globalThis.__game.scene.getScene('Run') : null;
    const stR = window.EmberfieldApp.__state;
    const run = stR && stR.run;
    out.runSceneFound = !!runP;
    out.runAlive = !!(run && run.player && run.player.hp > 0);
    if (runP && run) {
      key('keydown', 'Tab', 9);
      await wait(90);
      key('keyup', 'Tab', 9);
      await wait(250);
      out.runBagOpenedByTab = window.BagHud.isOpen();
      out.runScenePaused = runP.scene.isPaused();
      const e0 = run.elapsed;
      await wait(450);
      out.runElapsedWhilePaused = +(run.elapsed - e0).toFixed(3);
      key('keydown', 'Tab', 9);
      await wait(90);
      key('keyup', 'Tab', 9);
      await wait(250);
      out.runBagClosedByTab = !window.BagHud.isOpen();
      out.runSceneResumed = !runP.scene.isPaused();
      const e2 = run.elapsed;
      await wait(350);
      out.runElapsedAfterResume = +(run.elapsed - e2).toFixed(3);
    }
  }

  // ---- 3d. 装备：穿上后主角真的多了一层贴图 ----
  // 单测能验数据层，但"穿上装备后画面有没有变"只能在这里验：
  // refreshHeroEquip 拼错 key 的话 Phaser 不报错，只是那一层不显示。
  {
    const hubScene = globalThis.__game
      ? globalThis.__game.scene.getScene('Hub') : null;
    const st = window.EmberfieldApp.__state;
    if (hubScene && st) {
      st.meta.coins = 5000;
      const def = window.EmberfieldApp.__state;
      // 直接走 logic 层买下并穿上，然后回到 Hub 让渲染刷新
      const L = window.GameLogic;
      L.buyEquipment(st, 'fullPlate');
      L.equipItem(st, 'fullPlate');
      L.buyEquipment(st, 'crystalStaff');
      L.equipItem(st, 'crystalStaff');

      globalThis.__game.scene.getScene('Run').scene.start('Hub');
      await wait(500);

      const hub = globalThis.__game.scene.getScene('Hub');
      const hero = hub ? hub.hero : null;
      out.heroIsContainer = !!hero && Array.isArray(hero.list);
      out.heroChildCount = hero && hero.list ? hero.list.length : 0;
      // 躯干与武器两层必须是可见的、且贴图 key 指到对应装备
      const torso = hero && hero.layers_ ? hero.layers_.torso : null;
      const weapon = hero && hero.layers_ ? hero.layers_.weapon : null;
      out.torsoVisible = !!(torso && torso.visible);
      out.torsoTexture = torso && torso.texture ? torso.texture.key : null;
      out.weaponVisible = !!(weapon && weapon.visible);
      out.weaponTexture = weapon && weapon.texture ? weapon.texture.key : null;

      // 左右镜像：Container 没有原生 setFlipX，走的是逐层镜像的 shim。
      // 这里验证"人朝左时每一层都翻了"，否则会出现人朝左、剑朝右的穿帮。
      if (hero && typeof hero.setFlipX === 'function') {
        hero.setFlipX(true);
        const allFlipped = hero.list.every(function (c) {
          return c.flipX === true || typeof c.setFlipX !== 'function';
        });
        out.allLayersFlipped = allFlipped;
        hero.setFlipX(false);
      }

      // 没穿的部位必须隐藏（否则会显示上一局的残留装备）
      const head = hero && hero.layers_ ? hero.layers_.head : null;
      out.headHiddenWhenEmpty = !!(head && !head.visible);

      /*
       * 换装的即时反馈：面板开着时也要立刻换贴图。
       *
       * 上面那一段其实验不出这个 —— 它 scene.start('Hub') 之后等了 500ms，
       * 一定会跑到一个 update 帧，于是"只在 update 里刷新"这个实现也能过。
       * 但真实的换装发生在**面板打开期间**，而 Hub.update 第一行是
       * 'if (this.panelOpen) return;'，refreshHeroEquip 根本走不到：
       * 玩家在兵器架买下并穿上，人不会变；要等关掉面板才看到变化。
       * 这一条就是钉住"换完当场变"。
       */
      // 走真实路径：开兵器架面板 → 点按钮买 → 点按钮穿。
      // 直接调 L.buyEquipment 是测不到这条的 —— 面板的早期 return
      // 只在 "面板开着 + 由面板触发动作" 时才生效。
      hub.state.hub.x = 415; hub.state.hub.z = 105;   // 站到兵器架
      await wait(300);
      hub.showPanel({ id: 'forgewear' });
      await wait(120);
      // V14 页签：全部 / 头部 / 躯干 / 背部 / 武器 / 脚部 / 特殊（Task 21 改部位维度）。
      const tabBtns = function () {
        return Array.prototype.slice.call(
          document.querySelectorAll('#panelBody .tabs button'));
      };
      const actRows = function () {
        return Array.prototype.slice.call(
          document.querySelectorAll('#panelBody .act'));
      };
      const tabByText = function (label) {
        return tabBtns().filter(function (b) { return b.textContent === label; })[0];
      };
      const rowsFor = function (label, list) {
        return list.filter(function (r) {
          const t = r.querySelector('.t');
          return t && t.textContent.trim() === label;
        });
      };
      const btnText = function (r) {
        const b = r.querySelector('button');
        return b ? b.textContent : null;
      };

      out.tabLabels = tabBtns().map(function (b) { return b.textContent; }).join('/');
      out.tabRowsAll = actRows().length;
      // 穿戴中的件有两条动作（升级 + 卸掉），所以"全部"页签的行数不是件数，
      // 要按当前穿戴状态现算 —— 写死 35 会把这条正确行为判成失败。
      out.tabExpectedRowsAll = Object.keys(window.GameConfig.ALL_EQUIPMENT)
        .reduce(function (n, id) {
          return n + (window.GameLogic.equipOwned(hub.state, id) === 'equipped' ? 2 : 1);
        }, 0);
      out.tabWornCount = Object.keys(window.GameConfig.ALL_EQUIPMENT)
        .filter(function (id) {
          return window.GameLogic.equipOwned(hub.state, id) === 'equipped';
        }).length;

      // 点「头部」：只剩头部件。期望值在页面里按 slot 现算，不写死数字 ——
      // 前一段已经买过、穿过几件，写死就变成猜。
      const headTab = tabByText('头部');
      if (headTab) headTab.click();
      await wait(60);
      out.tabRowsHead = actRows().length;
      out.tabExpectedHead = Object.keys(window.GameConfig.ALL_EQUIPMENT)
        .reduce(function (n, id) {
          const def = window.GameConfig.equipDef(id);
          if (!def || def.slot !== 'head') return n;
          return n + (window.GameLogic.equipOwned(hub.state, id) === 'equipped' ? 2 : 1);
        }, 0);
      out.tabHeadHasHelm = rowsFor('角盔', actRows()).length > 0;
      // 头部件里有 2 件 special（雷鸣角盔 / 雷鸣指环）—— 部位页签不排除 special。
      out.tabHeadSpecialCount = Object.keys(window.GameConfig.ALL_EQUIPMENT)
        .filter(function (id) {
          const def = window.GameConfig.equipDef(id);
          return def && def.slot === 'head' && def.kind === 'special';
        }).length;
      // 非头部件一件都不许混进来：逐行回查它属于哪个部位。
      out.tabHeadAllHead = actRows().every(function (r) {
        const t = r.querySelector('.t');
        if (!t) return false;
        const name = t.textContent.trim();
        const id = Object.keys(window.GameConfig.ALL_EQUIPMENT).filter(function (k) {
          return window.GameConfig.equipDef(k).name === name;
        })[0];
        return !!id && window.GameConfig.equipDef(id).slot === 'head';
      });
      const allTab = tabByText('全部');
      if (allTab) allTab.click();
      await wait(60);

      const helmRow = rowsFor('角盔', actRows())[0];
      out.panelFoundHelmRow = !!helmRow;
      if (helmRow) {
        out.helmBtnBuy = btnText(helmRow);            // 未买：应写"购买"
        helmRow.querySelector('button').click();      // 买下（变背包中）
        await wait(80);
        const helmRow2 = rowsFor('角盔', actRows())[0];
        if (helmRow2) {
          out.helmBtnWear = btnText(helmRow2);        // 买了没穿：应写"穿戴"
          helmRow2.querySelector('button').click();   // 穿上（onAction 同步刷面板）
          // 这里刻意不 await：下面要验"同一 tick 内贴图就已换好"。
          out.helmWornBtns = rowsFor('角盔', actRows()).map(btnText).join('|');
        }
      }
      // 只在同一 tick 内取样，不 await —— 任何 await 都会放过一个 update 帧
      const headLayer = hub.hero && hub.hero.layers_ ? hub.hero.layers_.head : null;
      out.headTextureWhilePanelOpen = headLayer && headLayer.texture ? headLayer.texture.key : null;
      out.headVisibleWhilePanelOpen = !!(headLayer && headLayer.visible);
      hub.panelOpen = false;
      window.EmberfieldUI.closePanel();
      await wait(80);
    }
  }

  // ---- 3d-3. 设施面板的贴图 + 铁匠铺分类页签（Task 17 / V31 V32）----
  /*
   * 为什么必须在真浏览器里量
   * ----------------------
   * DOM 桩里 createElement('img') 得到的是假节点：src 设成什么都不会真的解码，
   * 于是"贴图烘好了"和"贴图键打错了"看起来一模一样。真浏览器才能数
   * naturalWidth —— 那是"这张图真的解出来了"的唯一证据。
   *
   * 改动前的实测（本任务红阶段，真 Electron）：铁匠铺 rows 3 / tabs 0 / imgs 0；
   * 兵器架 rows 35 / tabs 5 / imgs 0。所以这里每一条都能被破坏。
   */
  {
    const t17 = {};
    const t18 = {};
    const hubP = globalThis.__game.scene.getScene('Hub');
    const stP = window.EmberfieldApp.__state;
    stP.meta.coins = 5000;
    hubP.panelOpen = false;
    window.EmberfieldUI.closePanel();
    const bodyOf = function () { return document.getElementById('panelBody'); };
    const tabsOf = function () {
      return Array.prototype.slice.call(document.querySelectorAll('#panel .tabs button'));
    };
    const imgsOf = function () {
      return Array.prototype.slice.call(bodyOf().querySelectorAll('img'));
    };
    const rowsOf = function () {
      return Array.prototype.slice.call(bodyOf().querySelectorAll('.act'));
    };
    const tabNamed = function (label) {
      return tabsOf().filter(function (b) { return b.textContent === label; })[0];
    };
    // 设施面板的页签条：容器有没有被 overflow:hidden 裁掉、最后一个页签的右缘
    // 有没有超出容器。背包那边踩过"DOM 里 7 个、屏幕 6 个"的坑（Task 10c），
    // 所以这里两条都量 —— 只看数量会漏，只看容器会漏。
    const tabsFitOf = function () {
      const row = document.querySelector('#panel .tabs');
      const btns = tabsOf();
      if (!row || !btns.length) return null;
      const rr = row.getBoundingClientRect();
      const last = btns[btns.length - 1].getBoundingClientRect();
      return {
        scroll: row.scrollWidth, client: row.clientWidth,
        rowR: Math.round(rr.right),
        lastR: Math.round(last.right),
        lastW: Math.round(last.width),
        within: last.right <= rr.right + 0.5 && last.left >= rr.left - 0.5,
      };
    };
    const imgStats = function (list) {
      const srcs = list.map(function (i) { return String(i.src); });
      const everyData = srcs.length > 0 && srcs.every(function (s) {
        return s.indexOf('data:image/png;base64,') === 0;
      });
      const everyNat = list.length > 0 && list.every(function (i) { return i.naturalWidth > 0; });
      let uniq = 0;
      for (let i = 0; i < srcs.length; i++) if (srcs.indexOf(srcs[i]) === i) uniq++;
      return { n: list.length, dataUrl: everyData, natural: everyNat, uniq: uniq,
        nat: list.slice(0, 2).map(function (i) { return i.naturalWidth + 'x' + i.naturalHeight; }) };
    };
    // 第一行（有图的那行）的行框 / 图框 / 文字框，用来证明图没有压到字
    const geomOf = function () {
      const withImg = rowsOf().filter(function (r) { return !!r.querySelector('img'); });
      if (!withImg.length) return null;
      const r = withImg[0].getBoundingClientRect();
      const im = withImg[0].querySelector('img').getBoundingClientRect();
      const tx = withImg[0].querySelector('.txt').getBoundingClientRect();
      return { rowL: Math.round(r.left), rowR: Math.round(r.right),
        rowH: Math.round(r.height),
        imgL: Math.round(im.left), imgR: Math.round(im.right),
        imgW: Math.round(im.width), imgH: Math.round(im.height),
        txtL: Math.round(tx.left),
        within: im.left >= r.left && im.right <= tx.left && im.width > 0 };
    };
    const heightsOf = function () {
      return rowsOf().map(function (r) { return Math.round(r.getBoundingClientRect().height); });
    };

    // ---- Task 18：这张图里到底有多少是真内容 ----
    /*
     * 为什么要数像素
     * --------------
     * 改前每行贴图都是 40x60 的整身画布，头部装备只占其中一条横带；塞进
     * 28x42 的 object-fit:contain 硬盒后按 0.7 倍缩小，内容只剩十几个 CSS
     * 像素宽 —— 画面上就是一条色带（Task 17 报告 §4 自己记下的问题）。
     * "内容占多少"只能从位图的 alpha 通道量：这就是同帧读数。
     */
    const bboxOfImg = function (im) {
      const nw = im.naturalWidth, nh = im.naturalHeight;
      if (!nw || !nh) return null;
      const cv = document.createElement('canvas');
      cv.width = nw; cv.height = nh;
      const c2 = cv.getContext('2d', { willReadFrequently: true });
      if (!c2) return null;
      c2.clearRect(0, 0, nw, nh);
      c2.drawImage(im, 0, 0);
      const d = c2.getImageData(0, 0, nw, nh).data;
      let x0 = nw, y0 = nh, x1 = -1, y1 = -1;
      for (let y = 0; y < nh; y++) {
        for (let x = 0; x < nw; x++) {
          if (d[(y * nw + x) * 4 + 3] > 8) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 < 0) return { ratio: 0, w: 0, h: 0 };
      return {
        ratio: Math.round(((x1 - x0 + 1) * (y1 - y0 + 1)) / (nw * nh) * 1000) / 1000,
        w: x1 - x0 + 1, h: y1 - y0 + 1
      };
    };
    const readImgs = function (list) {
      return list.map(function (im) {
        const bb = bboxOfImg(im);
        const rc = im.getBoundingClientRect();
        return { nw: im.naturalWidth, nh: im.naturalHeight,
          ratio: bb ? bb.ratio : -1, bw: bb ? bb.w : -1, bh: bb ? bb.h : -1,
          cssW: Math.round(rc.width), cssH: Math.round(rc.height) };
      });
    };

    // (1) 铁匠铺：4 个页签 + 3 行 + 3 张两两不同的图
    hubP.state.hub.x = 265; hubP.state.hub.z = 122;
    await wait(300);
    t17.anvilZone = (window.GameHub.zoneAt(stP) || {}).id;
    hubP.showPanel(window.GameHub.zoneById('anvil'));
    await wait(220);
    t17.anvilTitle = document.getElementById('panelTitle').textContent;
    t17.anvilTabs = tabsOf().length;
    t17.anvilLabels = tabsOf().map(function (b) { return b.textContent; }).join('/');
    t17.anvilRows = rowsOf().length;
    t17.anvilImg = imgStats(imgsOf());
    t17.anvilGeom = geomOf();
    t18.anvilRead = readImgs(imgsOf());
    t18.anvilGeom = t17.anvilGeom;
    t17.anvilActH = heightsOf();
    t17.anvilBtnTexts = rowsOf().map(function (r) {
      const b = r.querySelector('button');
      return b ? String(b.textContent) : null;
    }).join('/');
    t17.anvilTabsFit = tabsFitOf();

    // (2) 点「攻击」→ 1 行 1 图，按钮仍写价格；点回「全部」→ 3 行
    const atkTab = tabNamed('攻击');
    if (atkTab) atkTab.click();
    await wait(180);
    t17.atkRows = rowsOf().length;
    t17.atkImgs = imgsOf().length;
    t17.atkBtn = rowsOf().length && rowsOf()[0].querySelector('button')
      ? String(rowsOf()[0].querySelector('button').textContent) : null;
    t17.atkRowName = rowsOf().length && rowsOf()[0].querySelector('.t')
      ? String(rowsOf()[0].querySelector('.t').textContent) : null;
    t17.atkOn = tabsOf().filter(function (b) { return b.className.indexOf('on') >= 0; })
      .map(function (b) { return b.textContent; }).join('/');
    const allTab0 = tabNamed('全部');
    if (allTab0) allTab0.click();
    await wait(180);
    t17.backRows = rowsOf().length;

    // (3) 兵器架：35 行、35 张两两不同的图、仍是 5 个页签。
    // 先把身上穿的卸下来：一件穿戴中的装备会给"升级 + 卸掉"两行，
    // 行数就不是 35 了。卸载是为了让读数能对着 V31 的 35 逐条比，
    // 不是为了把测试调绿 —— 断言里同时钉了"卸载真的生效"。
    // 量完必须把状态还原：这一段只是"临时脱光"，后面背包用例依赖
    // "3d 段穿上的那件还在身上"（替换场景），留在脱掉的状态会把它们弄红。
    const snapEquipment = JSON.parse(JSON.stringify(stP.meta.equipment));
    const snapBag = JSON.parse(JSON.stringify(stP.meta.bag));
    t17.bagBefore = snapBag.length;
    t17.headBefore = (snapEquipment.head || {}).id || null;
    t17.wornBefore = window.GameConfig.EQUIP_SLOTS.filter(function (slot) {
      return !!snapEquipment[slot];
    }).length;
    window.GameConfig.EQUIP_SLOTS.forEach(function (slot) {
      window.GameLogic.unequipSlot(stP, slot);
    });
    t17.stillWorn = window.GameConfig.EQUIP_SLOTS.filter(function (slot) {
      return !!stP.meta.equipment[slot];
    }).length;
    hubP.panelOpen = false;
    window.EmberfieldUI.closePanel();
    hubP.state.hub.x = 415; hubP.state.hub.z = 105;
    await wait(320);
    t17.wearZone = (window.GameHub.zoneAt(stP) || {}).id;
    hubP.showPanel(window.GameHub.zoneById('forgewear'));
    await wait(260);
    t17.wearTabs = tabsOf().length;
    t17.wearLabels = tabsOf().map(function (b) { return b.textContent; }).join('/');
    t17.wearRows = rowsOf().length;
    t17.wearImg = imgStats(imgsOf());
    t17.wearGeom = geomOf();
    t17.wearActH = heightsOf();
    t17.wearActHMin = Math.min.apply(null, t17.wearActH);
    t17.wearActHMax = Math.max.apply(null, t17.wearActH);
    t17.wearEquipmentCount = Object.keys(window.GameConfig.ALL_EQUIPMENT).length;
    t17.wearTabsFit = tabsFitOf();

    // ---- Task 18：紧裁切 + 整数倍放大（同帧读数）----
    /*
     * 读数都取在面板还开着、图还是这一帧的情况下：
     *   (a) 每张图的 naturalWidth x naturalHeight + 内容包围盒占比（alpha > 8）
     *   (b) 头部装备的高/宽比 —— 改前它和整身画布一样是 1.5（40x60），
     *       内容只占一成多；裁切放大后应接近那条横带自身的比例
     *   (c) fitUrl 的退化与缓存行为（缺 key 返 null、同参同串、与 url() 不同）
     * 缺函数时兜成 null 实现：一条 TypeError 会把这一节后面的断言全吞掉
     * （Task 17 踩过）。
     */
    const fitFn = window.SpriteLib && typeof window.SpriteLib.fitUrl === 'function'
      ? window.SpriteLib.fitUrl : function () { return null; };
    t18.fitExists = !!(window.SpriteLib && typeof window.SpriteLib.fitUrl === 'function');
    const actsW = window.GameHub.zoneActions(stP, 'forgewear');
    const imgKeyOf = {};
    rowsOf().forEach(function (row, i) {
      const a = actsW[i] || {};
      const im = row.querySelector('img');
      if (im && a.icon) imgKeyOf[a.icon] = im;
    });
    const keysW = Object.keys(imgKeyOf);
    t18.wearKeys = keysW.length;
    t18.wearRead = keysW.map(function (k) {
      const r = readImgs([imgKeyOf[k]])[0];
      return { key: k, nw: r.nw, nh: r.nh, ratio: r.ratio,
        cssW: r.cssW, cssH: r.cssH };
    });
    const headRead = t18.wearRead.filter(function (r) {
      return r.key.indexOf('eq-head-') === 0;
    });
    t18.headKeys = headRead.map(function (r) { return r.key; });
    t18.headRead = headRead;
    t18.headMaxAspect = headRead.length
      ? Math.max.apply(null, headRead.map(function (r) {
        return Math.round(r.nh / r.nw * 1000) / 1000;
      })) : -1;
    t18.headMinNatW = headRead.length
      ? Math.min.apply(null, headRead.map(function (r) { return r.nw; })) : -1;
    t18.minRatio = t18.wearRead.length
      ? Math.min.apply(null, t18.wearRead.map(function (r) { return r.ratio; })) : -1;
    t18.notUpscaled = t18.wearRead.length > 0 && t18.wearRead.every(function (r) {
      return r.nw >= r.cssW && r.nh >= r.cssH;
    });
    t18.maxCssW = t18.wearRead.length
      ? Math.max.apply(null, t18.wearRead.map(function (r) { return r.cssW; })) : -1;
    t18.maxCssH = t18.wearRead.length
      ? Math.max.apply(null, t18.wearRead.map(function (r) { return r.cssH; })) : -1;
    t18.wearGeom = t17.wearGeom;

    const cKey = 'eq-head-hornHelm';
    const f1 = fitFn(cKey, 32, 44);
    const f2 = fitFn(cKey, 32, 44);
    t18.cacheIsDataUrl = typeof f1 === 'string' && f1.indexOf('data:image/png;base64,') === 0;
    t18.cacheSame = !!f1 && f1 === f2;
    // 空串/ null 与 url() 当然"不同" —— 那不是"真的裁过了"，是没结果。
    // 所以这条先要求 f1 是一张真图，再要求它与整图不同。
    t18.differsFromUrl = t18.cacheIsDataUrl && f1 !== window.SpriteLib.url(cKey);
    t18.differsByBox = fitFn(cKey, 64, 88) !== f1;
    let missOut, missErr = null;
    try { missOut = fitFn('no-such-texture-key', 32, 44); }
    catch (e) { missErr = String((e && e.message) || e); }
    // 注意：Phaser 的 textures.get() 对不存在的键返回 __MISSING 那张占位图，
    // 不会返回 undefined（本任务实测）。所以"键找不到"不等于返回 null ——
    // 这里只钉"不抛"，并且要么交得出图、要么老实返回 null。
    t18.missGraceful = missErr === null
      && (missOut === null || typeof missOut === 'string');
    t18.missErr = missErr;
    t18.nullKeyNull = fitFn(null, 32, 44) === null;
    t18.zeroBoxNull = fitFn(cKey, 0, 0) === null;
    // 还原（见上面 snapEquipment/snapBag 的注释）
    stP.meta.equipment = snapEquipment;
    stP.meta.bag = snapBag;
    t17.restoredHead = (stP.meta.equipment.head || {}).id || null;
    t17.restoredWorn = window.GameConfig.EQUIP_SLOTS.filter(function (slot) {
      return !!stP.meta.equipment[slot];
    }).length;
    t17.restoredBag = stP.meta.bag.length;
    out.t17 = t17;
    out.t18 = t18;

    hubP.panelOpen = false;
    window.EmberfieldUI.closePanel();
    await wait(120);
  }

  // ---- 3e. 走到田地按 J：必须真的进得去农场，不能卡在黑屏 ----
  /*
   * 这条来自真实反馈："按 J 进入田地渐黑之后就卡死了，什么都做不了"。
   *
   * 根因是 FarmScene.update() 里有一行 this.keyboardApi.keys，而
   * keyboardApi 这个属性**从来没有被赋值过** —— 它是从 boss 那轮改动里
   * 带进来的死代码，取到的值 k 也根本没用（下一行才是真正干活的
   * this.input2.justPressed）。于是 Farm 的第一帧 update 就抛
   * TypeError，场景停在渐黑之后的黑屏上。
   *
   * 为什么以前的测试全绿却漏掉它：DOM 桩测试不跑 Phaser 场景，
   * 而浏览器测试从来没按过 J 走到田地。所以这条断言必须在这里，
   * 并且要真的按 J、真的等黑屏结束、再确认农场活着。
   */
  {
    const st = window.EmberfieldApp.__state;
    window.EmberfieldUI.closePanel();
    const hubS = globalThis.__game.scene.getScene('Hub');
    hubS.panelOpen = false;
    // 站到田地（field 区）上
    st.hub.x = 100; st.hub.z = 105;
    await wait(250);
    out.fieldZoneId = (window.GameHub.zoneAt(st) || {}).id || null;

    // 在页面内部自己收集异常：driver 那边的 errors 数组这里看不到，
    // 而且驱动层的 console-message 会漏掉场景里抛出但没冒到 console 的错。
    if (!window.__pageErrs) {
      window.__pageErrs = [];
      window.addEventListener('error', function (ev) {
        window.__pageErrs.push(String(ev.message || ev.error));
      });
    }
    const errsBefore = window.__pageErrs.length;
    const sc = globalThis.__game.scene;
    if (sc.isActive('Farm')) sc.stop('Farm');
    if (sc.isActive('Run')) sc.stop('Run');
    sc.start('Hub');
    await wait(300);
    const hub2 = globalThis.__game.scene.getScene('Hub');
    hub2.panelOpen = false;
    hub2.state.hub.x = 100; hub2.state.hub.z = 105;

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', bubbles: true }));
    await wait(60);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyJ', bubbles: true }));

    // 渐黑是 340ms，启动后还要建场景；等足 1.2 秒
    await wait(1200);

    out.farmActive = sc.isActive('Farm');
    const farm = sc.getScene('Farm');
    out.farmReady = !!(farm && farm.plotGeo && farm.children && farm.children.list.length > 20);
    // 场景必须是"活"的：切换/跳回基地仍然有响应
    out.farmBusyFalse = !!(farm && farm.busy === false);
    out.farmErrorsAfter = window.__pageErrs.length - errsBefore;
    out.farmErrorSample = window.__pageErrs.slice(errsBefore, errsBefore + 2);

    // 能按 ESC 回基地（证明场景没卡死）
    if (out.farmActive) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
      await wait(50);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape', bubbles: true }));
      await wait(900);
      out.backToHub = sc.isActive('Hub');
      // 回基地后把状态复位，免得影响后续断言
      await wait(200);
    }
  }

  // ---- 3f. 农场分页：第 2 页与翻页箭头（Task 24）----
  /*
   * 分页的验收（设计 V17/V18）：
   *  - 10 块地 = 2 页；第 1 页只有右箭头，第 2 页只有左箭头
   *  - 第 2 页第 1 块 = 绝对索引 9（点它种的是第 10 块地）
   *  - 箭头 44x44 贴左右缘、不压田块；点箭头只翻页，绝不播种
   *
   * 最后一条最容易写成恒真：箭头本来就摆在田块外，"点箭头没播种"不点
   * 也不会播种。所以先把箭头挪到一块空地上再点同一坐标 —— 少了"箭头优先"
   * 的守卫，这一下就会种下去。对照组（直接点另一块空田）负责证明点击
   * 通道本身是通的，否则实验组的"没播种"可能只是点击根本没生效。
   */
  {
    const sc = globalThis.__game.scene;
    const st = window.EmberfieldApp.__state;
    const seedsOrig = st.meta.seeds;

    st.farm.plots = st.farm.plots.slice(0, 9);
    while (st.farm.plots.length < 10) st.farm.plots.push({ state: 'empty', growth: 0 });
    st.farm.page = 0;
    st.meta.seeds = 40;
    window.EmberfieldUI.save(st);
    if (sc.isActive('Farm')) sc.stop('Farm');
    if (sc.isActive('Run')) sc.stop('Run');
    if (sc.isActive('Hub')) sc.stop('Hub');
    sc.start('Farm');
    await wait(900);

    const farm = sc.getScene('Farm');
    out.pgActive = sc.isActive('Farm');
    out.pgPages = typeof window.GameLogic.farmPageCount === 'function'
      ? window.GameLogic.farmPageCount(st) : -1;
    out.pgFirstIdx = farm && farm.plotGeo && farm.plotGeo[0] ? farm.plotGeo[0].idx : null;
    out.pgLeftVisible = !!(farm && farm.arrowLeft && farm.arrowLeft.visible);
    out.pgRightVisible = !!(farm && farm.arrowRight && farm.arrowRight.visible);
    out.pgHud = farm && farm.hudText ? String(farm.hudText.text) : '';

    // 用 canvas 上的真实 mousedown 点击（Phaser 的输入管理器监听它），
    // 坐标按 FIT 缩放换算成 client 坐标。
    const clickGame = function (gx, gy) {
      const cv = document.querySelector('canvas');
      const r = cv.getBoundingClientRect();
      const sx = r.width / 960, sy = r.height / 600;
      const opts = {
        clientX: r.left + gx * sx, clientY: r.top + gy * sy,
        bubbles: true, cancelable: true, button: 0, buttons: 1, view: window,
      };
      cv.dispatchEvent(new MouseEvent('mousedown', opts));
      cv.dispatchEvent(new MouseEvent('mouseup', opts));
    };

    if (farm && farm.arrowLeft && farm.arrowRight) {
      out.pgArrowLeftX = farm.arrowLeft.x;
      out.pgArrowLeftY = farm.arrowLeft.y;
      out.pgArrowRightX = farm.arrowRight.x;
      out.pgArrowRightY = farm.arrowRight.y;
      out.pgArrowW = farm.arrowLeft.width;
      out.pgArrowH = farm.arrowLeft.height;
      out.pgArrowDepth = farm.arrowLeft.depth;
      const overPlots = function (a) {
        let n = 0;
        farm.plotGeo.forEach(function (g) {
          if (Math.abs(a.x - g.cx) < a.width / 2 + g.w / 2 &&
              Math.abs(a.y - g.cy) < a.height / 2 + g.h / 2) n += 1;
        });
        return n;
      };
      out.pgArrowOverPlotsLeft = overPlots(farm.arrowLeft);
      out.pgArrowOverPlotsRight = overPlots(farm.arrowRight);
    } else {
      out.pgArrowLeftX = null;
      out.pgArrowLeftY = null;
      out.pgArrowRightX = null;
      out.pgArrowRightY = null;
      out.pgArrowW = null;
      out.pgArrowH = null;
      out.pgArrowDepth = null;
      out.pgArrowOverPlotsLeft = null;
      out.pgArrowOverPlotsRight = null;
    }

    const rightX = farm && farm.arrowRight ? farm.arrowRight.x : 926;
    const rightY = farm && farm.arrowRight ? farm.arrowRight.y : 300;
    const leftX = farm && farm.arrowLeft ? farm.arrowLeft.x : 34;
    const leftY = farm && farm.arrowLeft ? farm.arrowLeft.y : 300;

    // 点右箭头 → 第 2 页
    clickGame(rightX, rightY);
    await wait(400);
    out.pgPageAfterClick = st.farm.page;
    out.pgIdx2 = farm && farm.plotGeo && farm.plotGeo[0] ? farm.plotGeo[0].idx : null;
    out.pgLeft2 = !!(farm && farm.arrowLeft && farm.arrowLeft.visible);
    out.pgRight2 = !!(farm && farm.arrowRight && farm.arrowRight.visible);
    out.pgHud2 = farm && farm.hudText ? String(farm.hudText.text) : '';

    // 末页再点右箭头：不该翻出第 3 页
    clickGame(rightX, rightY);
    await wait(250);
    out.pgPageAfterExtraRight = st.farm.page;

    // 点左箭头 → 回第 1 页
    clickGame(leftX, leftY);
    await wait(400);
    out.pgPageAfterLeft = st.farm.page;
    out.pgIdxBack = farm && farm.plotGeo && farm.plotGeo[0] ? farm.plotGeo[0].idx : null;
    out.pgLeftBack = !!(farm && farm.arrowLeft && farm.arrowLeft.visible);
    out.pgRightBack = !!(farm && farm.arrowRight && farm.arrowRight.visible);

    // 页码持久化：重进农场仍在第 2 页
    st.farm.page = 1;
    window.EmberfieldUI.save(st);
    sc.stop('Farm');
    await wait(200);
    sc.start('Farm');
    await wait(900);
    const farm2 = sc.getScene('Farm');
    out.pgPageAfterRestart = st.farm.page;
    out.pgIdxAfterRestart = farm2 && farm2.plotGeo && farm2.plotGeo[0]
      ? farm2.plotGeo[0].idx : null;

    // 回到第 1 页做播种对照（第 1 页才有 9 块可点）。
    // turnPage 的契约是数字方向（-1 左 / +1 右），与 hitArrow 的返回值一致 —
    // 这里传 'left' 会落到 +1 分支上（字符串与数字比较是 false），第 1 步就错。
    if (farm2 && typeof farm2.turnPage === 'function') farm2.turnPage(-1);
    await wait(400);
    out.pgPageForGuard = st.farm.page;

    if (farm2 && farm2.arrowLeft && farm2.plotGeo && farm2.plotGeo[1]) {
      st.meta.seeds = 40;
      st.farm.plots.forEach(function (p) { p.state = 'empty'; p.growth = 0; });
      window.EmberfieldUI.save(st);
      farm2.redrawField();
      farm2.refreshHud();

      const g0 = farm2.plotGeo[0];
      const g1 = farm2.plotGeo[1];

      // 对照组：直接点空田 → 真的种下去了
      clickGame(g0.cx, g0.cy);
      await wait(350);
      out.pgCtrlSeedDelta = 40 - st.meta.seeds;
      out.pgCtrlPlotState = st.farm.plots[g0.idx] ? st.farm.plots[g0.idx].state : null;

      // 实验组：把左箭头挪到第 2 块空地上，再点同一个坐标
      const sx0 = farm2.arrowLeft.x, sy0 = farm2.arrowLeft.y;
      const seedsBeforeArrow = st.meta.seeds;
      farm2.arrowLeft.setPosition(g1.cx, g1.cy);
      farm2.arrowLeft.setVisible(true);
      clickGame(g1.cx, g1.cy);
      await wait(350);
      out.pgGuardSeedsSame = st.meta.seeds === seedsBeforeArrow;
      out.pgGuardPlotState = st.farm.plots[g1.idx] ? st.farm.plots[g1.idx].state : null;
      out.pgGuardPage = st.farm.page;
      // 复位，免得后面的断言看到一只跑偏的箭头
      farm2.arrowLeft.setPosition(sx0, sy0);
      if (typeof farm2.refreshArrows === 'function') farm2.refreshArrows();
      else farm2.arrowLeft.setVisible(false);
    }

    // 中间页（V17 第三条）：27 块 = 3 页，停在第 2 页时**左右都有**。
    // 这一条必须真的造出三页，两页的布局下"中间页"不存在 ——
    // 首页只有右、末页只有左，两条都可能对着一份"只画右箭头"的坏实现变绿。
    if (farm2 && farm2.arrowLeft && farm2.arrowRight) {
      while (st.farm.plots.length < 27) st.farm.plots.push({ state: 'empty', growth: 0 });
      st.farm.page = 1;
      window.EmberfieldUI.save(st);
      farm2.redrawField();
      farm2.refreshHud();
      farm2.refreshArrows();
      await wait(250);
      out.pgMidPages = window.GameLogic.farmPageCount(st);
      out.pgMidLeft = farm2.arrowLeft.visible;
      out.pgMidRight = farm2.arrowRight.visible;
      farm2.turnPage(1);
      await wait(250);
      out.pgMidPageAfterNext = st.farm.page;
      out.pgMidRightAfterNext = farm2.arrowRight.visible;
      out.pgMidLeftAfterNext = farm2.arrowLeft.visible;
      farm2.turnPage(-1);
      await wait(250);
      out.pgMidPageBack = st.farm.page;
      out.pgMidBothBack = farm2.arrowLeft.visible && farm2.arrowRight.visible;
    }

    // 收尾：把状态与场景复位，后面的段落还要用 Hub
    st.farm.plots = st.farm.plots.slice(0, 9);
    st.farm.page = 0;
    st.meta.seeds = seedsOrig;
    window.EmberfieldUI.save(st);
    sc.stop('Farm');
    await wait(200);
    sc.start('Hub');
    await wait(500);
  }

  // ---- 4. 重开（restart）按钮存在 ----
  out.hasAgainButton = !!document.getElementById('btn-again') ||
                       document.body.innerHTML.indexOf('再来一局') >= 0;

  // ---- 背包面板（V2 / V4）----
  // ⚠️ 必须用守卫：实现之前 window.BagHud 是 undefined，裸调会抛异常，
  //    驱动把它当成 {error} 直接中止整个脚本 —— 45 条既有断言全部消失，
  //    看起来像"游戏全线崩了"，实际只是新功能还没写。
  const bagEl = () => document.getElementById('bag');
  out.bagExists = !!bagEl();
  out.bagApiExists = !!(window.BagHud && typeof window.BagHud.open === 'function');
  const stBag = window.EmberfieldApp.__state;
  if (out.bagApiExists) {
    window.BagHud.open(stBag);
    await wait(300);
    out.bagOpen = window.BagHud.isOpen();
    out.bagDisplayed = !!(bagEl() && getComputedStyle(bagEl()).display !== 'none');
  }

  // V2：推到屏幕外，clamp() 之后必须回到可见范围
  if (out.bagApiExists && bagEl()) {
    bagEl().style.left = '-9999px';
    bagEl().style.top = '-9999px';
    window.BagHud.clamp();
    out.bagLeft = parseFloat(bagEl().style.left);
    out.bagTop = parseFloat(bagEl().style.top);
    out.bagW = bagEl().offsetWidth;
    out.bagH = bagEl().offsetHeight;
    out.viewW = window.innerWidth;
    out.viewH = window.innerHeight;
    // 只夹左上角是不够的：右下角同样会跑出屏幕，两个角都要验
    out.bagEndsWithinView =
      (out.bagLeft + out.bagW <= out.viewW) && (out.bagTop + out.bagH <= out.viewH);
  }

  // V4：第一页 5 列 × 7 行
  out.bagCells = document.querySelectorAll('#bag .cell').length;

  // ---- 背包交互（V3 / V12 / V13 / V26–V29）----
  /*
   * 注意：这一整段会被塞进 Node 侧的模板字符串（SCRIPT），所以
   * **一个反引号都不能出现**，也不写美元大括号插值 —— 上一个任务
   * 就是多了一个反引号，整个 smoke 直接 SyntaxError，一条断言都跑不了。
   */
  const stI = window.EmberfieldApp.__state;
  const Lg = window.GameLogic;
  const hubI = globalThis.__game.scene.getScene('Hub');
  // 英雄装备图层挂在 container 的 layers_ 上（app.js:101-124 的 refreshHeroEquip
  // 改的就是它），不要去遍历 hero.list 猜 —— 直接读那一层最准。
  const heroLayerKeys = function (slot) {
    const img = hubI && hubI.hero && hubI.hero.layers_ ? hubI.hero.layers_[slot] : null;
    return img && img.visible && img.texture ? img.texture.key : '';
  };
  const textOf = function (node) {
    return node && node.textContent ? node.textContent.trim() : '';
  };
  const bagCountText = function () {
    return textOf(document.getElementById('bag-count')).split(' ').join('');
  };
  const firstFilledCell = function () {
    const img = document.querySelector('#bag .cell img');
    return img && img.closest ? img.closest('.cell') : null;
  };

  stI.meta.coins = 99999;
  /*
   * 先清场。现场有两处不确定，都会让下面的等式变成偶然：
   *   1) 3d 段已经给角色穿上了棱晶杖（武器，伤害 +12）。直接换成双刀（+10）
   *      伤害是**下降**的，差额 -2 永远不可能等于声明加成 —— 「差额 == 声明值」
   *      这条在既有状态下根本不可能成立。所以先把武器槽清空，让换装是
   *      「空槽 → 有装」。
   *   2) 前面跑过一局，袋子里可能有 5% 掉落的随机基础装备。V3 要悬停的是
   *      「刚补进去的那一件」，袋子要是还有别的东西，第一个有图的格子就不是它。
   */
  stI.meta.bag.length = 0;
  out.weaponUnequippedBefore = Lg.unequipSlot(stI, 'weapon');
  stI.meta.bag.length = 0;

  // V13：面板开着时换装，英雄图层必须真的换（不是等下一帧的 update）
  const wId = 'twinBlades';
  if (Lg.equipOwned(stI, wId) === null) Lg.buyEquipment(stI, wId);
  window.BagHud.open(stI);
  await wait(250);
  // 背包一开，Hub.update 首行就早退了 —— 这条断言证明"下面看到的图层变化
  // 不可能是 update 循环顺手刷出来的"。
  out.hubPanelOpenWithBag = !!(hubI && hubI.panelOpen);
  out.heroWeaponBefore = heroLayerKeys('weapon');
  out.dmgBefore = Lg.playerStats(stI).damage;
  out.statsTextBefore = textOf(document.querySelector('#bag-stats'));
  const wUid = (stI.meta.bag.filter(function (e) { return e.id === wId; })[0] || {}).uid;
  out.equipResult = Lg.equipItem(stI, wId, wUid);
  window.BagHud.refresh();
  await wait(300);
  out.heroWeaponAfter = heroLayerKeys('weapon');
  // V12：左栏数值必须严格上升，且差额等于该件声明的加成（不能用大于等于）
  out.dmgGainDeclared = window.GameConfig.equipDef(wId).mods.damage;
  out.dmgAfter = Lg.playerStats(stI).damage;
  out.statsTextAfter = textOf(document.querySelector('#bag-stats'));

  // V3：悬停显示信息
  // 不能盲取「第一个 .cell」：空格也渲染（Task 7 的契约），穿上双刀后袋子
  // 可能正好空了 —— 悬停空格什么都不弹，断言会以"没浮层"的形式失败，
  // 看不出真实原因。所以先补一件确定留在袋子里的，再从「有图的格子」里取。
  if (Lg.equipOwned(stI, 'ironHelm') === 'equipped') Lg.unequipSlot(stI, 'head');
  stI.meta.bag.length = 0;
  out.helmBought = Lg.buyEquipment(stI, 'ironHelm');
  window.BagHud.refresh();
  await wait(250);
  const cell0 = firstFilledCell();
  out.cellWithItemFound = !!cell0;
  if (cell0) {
    cell0.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    await wait(150);
    const tip = document.getElementById('bag-tip');
    out.tipVisible = !!(tip && getComputedStyle(tip).display !== 'none' &&
                        tip.textContent.trim().length > 0);
    out.tipText = tip ? tip.textContent.trim().slice(0, 80) : null;
    cell0.dispatchEvent(new MouseEvent('pointerout', { bubbles: true }));
    await wait(150);
    const tip2 = document.getElementById('bag-tip');
    out.tipHiddenAfterOut = !!(tip2 && getComputedStyle(tip2).display === 'none');
  }

  // 点格子 = 穿上；左栏的槽位与英雄图层都必须当场跟着变（同一个 onChange 钩子）
  const headSlotSel = '#bag-wear [data-slot="head"]';
  const headSlot0 = document.querySelector(headSlotSel);
  // 3d 段已经给头上穿了角盔，所以这一格不是空的 —— 正好拿它测"替换"：
  // 换穿另一件时，旧的那件必须回到背包里，而不是凭空消失。
  out.headSlotAltBefore = headSlot0 && headSlot0.querySelector('img')
    ? headSlot0.querySelector('img').alt : null;
  out.headSlotWornBefore = !!(headSlot0 && headSlot0.classList.contains('on'));
  out.headKeyBeforeClick = heroLayerKeys('head');
  if (cell0) cell0.click();
  await wait(300);
  const headSlot = document.querySelector(headSlotSel);
  out.headSlotWorn = !!(headSlot && headSlot.classList.contains('on'));
  out.headSlotImgAlt = headSlot && headSlot.querySelector('img')
    ? headSlot.querySelector('img').alt : null;
  out.headKeyAfterClick = heroLayerKeys('head');
  out.statsTextAfterClick = textOf(document.querySelector('#bag-stats'));
  out.bagIdsAfterClick = stI.meta.bag.map(function (e) { return e.id; });

  // 点已穿戴的槽 = 卸下（设计 §4.1）
  if (headSlot) headSlot.click();
  await wait(250);
  out.headSlotEmptyAfterUnequip = !!(headSlot && headSlot.classList.contains('empty'));
  out.heroHeadAfterUnequip = heroLayerKeys('head');
  out.bagCountAfterUnequip = bagCountText();

  // 整理：特效装备排在最前（设计 §4.5）
  stI.meta.bag.length = 0;
  Lg.bagAdd(stI, 'emberBoots', 1);
  Lg.bagAdd(stI, 'ironHelm', 1);
  Lg.bagAdd(stI, 'battleAxe', 1);
  window.BagHud.refresh();
  await wait(150);
  const firstAlt = function () {
    const img = document.querySelector('#bag .cell img');
    return img ? img.alt : null;
  };
  out.sortFirstBefore = firstAlt();
  const sortBtnEl = document.querySelector('#bag [data-act="sort"]');
  out.sortBtn = !!sortBtnEl;
  if (sortBtnEl) { sortBtnEl.click(); await wait(200); }
  out.sortFirstAfter = firstAlt();

  // V26–V29：批量出售。三件同 id（Lv1/2/3）+ 一件别的 ——
  // 每 id 必须留一件，且留等级最高的那件。
  stI.meta.bag.length = 0;
  Lg.bagAdd(stI, 'ironHelm', 1);
  Lg.bagAdd(stI, 'ironHelm', 2);
  Lg.bagAdd(stI, 'ironHelm', 3);
  Lg.bagAdd(stI, 'emberBoots', 1);
  window.BagHud.refresh();
  await wait(150);
  const batchBtn = document.querySelector('#bag [data-act="batch-sell"]');
  out.batchBtn = !!batchBtn;
  if (batchBtn) {
    batchBtn.click();
    await wait(200);
    const confirm0 = document.querySelector('#bag .confirm-ok');
    out.batchConfirmDisabledWhenEmpty = !!(confirm0 && confirm0.disabled);
    // 批量条几何（Task 16）。上一版全绿是因为 .click() 不经过命中测试：
    // 右栏只有 267px，这条 bar 的内容要 334px，被 #bag{overflow:hidden} 裁掉，
    // 「确认」「取消」画在面板外，真鼠标点上去命中的是 BODY。
    // 这里量的是几何与命中，不看 .click() 的返回值。
    const barZero = document.getElementById('bag-batchbar');
    const bagZero = document.getElementById('bag').getBoundingClientRect();
    out.batchBarZero = barZero ? {
      w: barZero.clientWidth,
      scroll: barZero.scrollWidth,
      left: Math.round(barZero.getBoundingClientRect().left),
      right: Math.round(barZero.getBoundingClientRect().right),
      panelLeft: Math.round(bagZero.left),
      panelRight: Math.round(bagZero.right),
    } : null;
    const pick = document.querySelector('#bag [data-act="pick-dups"]');
    out.pickDupsBtn = !!pick;
    if (pick) { pick.click(); await wait(200); }
    const confirm1 = document.querySelector('#bag .confirm-ok');
    out.batchConfirmEnabledAfterPick = !!(confirm1 && !confirm1.disabled);
    out.batchSumText = textOf(document.getElementById('bag-sum'));
    // 逐件求和，不是"单价 × 件数"：留 Lv3，卖 Lv1 与 Lv2，两件价不同。
    out.batchExpectedTotal = Lg.sellValue('ironHelm', 1) + Lg.sellValue('ironHelm', 2);
    out.batchUnitPrice = Lg.sellValue('ironHelm', 1);
    out.batchCells = document.querySelectorAll('#bag .cell').length;
    // 选中两件之后量：整条 bar 的左右缘、两个按钮的右缘、按钮中心命中谁。
    const barSel = document.getElementById('bag-batchbar');
    const bagSel = document.getElementById('bag').getBoundingClientRect();
    const sumSel = document.getElementById('bag-sum');
    const okSel = document.querySelector('#bag .confirm-ok');
    const cancelSel = document.querySelector('#bag [data-act="batch-cancel"]');
    const barBox = barSel ? barSel.getBoundingClientRect() : null;
    out.batchBarSel = barSel ? {
      w: barSel.clientWidth,
      scroll: barSel.scrollWidth,
      left: Math.round(barBox.left),
      right: Math.round(barBox.right),
      panelLeft: Math.round(bagSel.left),
      panelRight: Math.round(bagSel.right),
    } : null;
    out.batchBarRight = barBox ? Math.round(barBox.right) : null;
    out.batchBagRight = Math.round(bagSel.right);
    out.batchSumBox = sumSel ? {
      scroll: sumSel.scrollWidth,
      client: sumSel.clientWidth,
      right: Math.round(sumSel.getBoundingClientRect().right),
    } : null;
    // 命中测试用按钮矩形中心。elementFromPoint 只看指针能落到的元素，
    // 被 overflow:hidden 裁到面板外的部分命中的是 BODY —— 这正是"点不到"。
    const centerHit = function (el) {
      if (!el) return { self: false, tag: 'null' };
      const r = el.getBoundingClientRect();
      const h = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      if (!h) return { self: false, tag: 'null' };
      return { self: h === el || el.contains(h), tag: h.id || h.className || h.tagName };
    };
    const okHit = centerHit(okSel);
    const cnHit = centerHit(cancelSel);
    out.batchOkHit = okHit.self;
    out.batchOkHitTag = String(okHit.tag);
    out.batchCancelHit = cnHit.self;
    out.batchCancelHitTag = String(cnHit.tag);
    out.batchOkRight = okSel ? Math.round(okSel.getBoundingClientRect().right) : null;
    out.batchCancelRight = cancelSel
      ? Math.round(cancelSel.getBoundingClientRect().right) : null;
    // 反证：批量态下分页条必须还是隐藏的（两条 bar 占同一个槽位、互斥）。
    out.batchPageBarDisplay = getComputedStyle(
      document.getElementById('bag-pagebar')).display;
    // 不许"修好一条 bar、挤掉一行格子"：第 7 行整行仍在面板内。
    const cellsSel = document.querySelectorAll('#bag .cell');
    const lastCellSel = cellsSel[cellsSel.length - 1];
    out.batchLastRowInside = lastCellSel
      ? lastCellSel.getBoundingClientRect().bottom <= bagSel.bottom + 0.5 : null;
    out.batchGridH = Math.round(
      document.getElementById('bag-grid').getBoundingClientRect().height);
    if (confirm1 && !confirm1.disabled) { confirm1.click(); await wait(250); }
    out.batchExitPageBar = getComputedStyle(
      document.getElementById('bag-pagebar')).display;
    out.batchExitBatchBar = getComputedStyle(
      document.getElementById('bag-batchbar')).display;
    out.bagCountAfterBatch = bagCountText();
    out.bagAfterBatch = stI.meta.bag.map(function (e) {
      return e.id + '@' + (e.level || 1);
    });
  }

  // 右键出售：对着格子点右键 → 卖掉 + toast 报出卖价
  stI.meta.bag.length = 0;
  Lg.bagAdd(stI, 'ironHelm', 1);
  window.BagHud.refresh();
  await wait(150);
  out.bagCountBeforeSell = bagCountText();
  const sellCell = firstFilledCell();
  out.sellCellFound = !!sellCell;
  if (sellCell) {
    sellCell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await wait(300);
  }
  out.sellExpectedValue = Lg.sellValue('ironHelm', 1);
  const toastEl = document.getElementById('toast');
  out.toastAfterSell = textOf(toastEl);
  out.toastOnAfterSell = !!(toastEl && toastEl.classList.contains('on'));
  out.bagCountAfterSell = bagCountText();

  // 分页：+扩容 → 第 N/M 页 → 翻页之后格子数仍然恒为 35（不能长也不能缩）
  const expandBtn = document.querySelector('#bag [data-act="expand"]');
  out.expandBtn = !!expandBtn;
  out.prevBtn = !!document.querySelector('#bag [data-page="prev"]');
  out.pageLabelBefore = textOf(document.getElementById('bag-page'));
  if (expandBtn) { expandBtn.click(); await wait(250); }
  out.pageLabelAfterExpand = textOf(document.getElementById('bag-page'));
  out.bagCountAfterExpand = bagCountText();
  const nextBtn = document.querySelector('#bag [data-page="next"]');
  out.nextBtn = !!nextBtn;
  if (nextBtn) { nextBtn.click(); await wait(200); }
  out.pageLabelOnPage2 = textOf(document.getElementById('bag-page'));
  out.bagCellsOnPage2 = document.querySelectorAll('#bag .cell').length;

  // ---- Tab 打开背包 + 暂停（V1 / V21）----
  // 注意：本段整体在 SCRIPT 模板字符串里，**一个反引号都不能出现**。
  const stP = window.EmberfieldApp.__state;
  const hubP = globalThis.__game.scene.getScene('Hub');
  window.BagHud.close();              // 从关闭态开始，保证 Tab 真的从无到有
  stP.hub.x = 300; stP.hub.z = 105;   // 放在空地，避免撞到点位边界
  await wait(350);
  out.pauseClosedBefore = window.BagHud.isOpen();

  key('keydown', 'Tab', 9); await wait(90); key('keyup', 'Tab', 9);
  await wait(350);
  out.pauseOpenedByTab = window.BagHud.isOpen();
  out.pauseScenePaused = hubP.scene.isPaused();

  const x0 = stP.hub.x;
  key('keydown', 'KeyD', 68); await wait(700); key('keyup', 'KeyD', 68);
  await wait(120);
  out.pauseXBefore = x0;
  out.pauseXWhileOpen = stP.hub.x;

  // 关掉背包，同样的按键必须能动 —— 证明上一条的「不动」是暂停造成的
  key('keydown', 'Tab', 9); await wait(90); key('keyup', 'Tab', 9);
  await wait(350);
  out.pauseClosedAfter = window.BagHud.isOpen();
  out.pauseSceneResumed = !hubP.scene.isPaused();
  const x1 = stP.hub.x;
  key('keydown', 'KeyD', 68); await wait(700); key('keyup', 'KeyD', 68);
  await wait(120);
  out.pauseXBeforeReopen = x1;
  out.pauseXAfterClose = stP.hub.x;

  // Tab 默认会把焦点移到下一个控件，必须被 preventDefault 吃掉。
  // cancelable:true 是真实键盘事件的取值；这里不带上就测不到任何东西。
  let defaultPrevented = false;
  const probe = (e) => { defaultPrevented = e.defaultPrevented; };
  window.addEventListener('keydown', probe);
  key('keydown', 'Tab', 9, { cancelable: true }); await wait(60); key('keyup', 'Tab', 9);
  window.removeEventListener('keydown', probe);
  out.tabDefaultPrevented = defaultPrevented;
  await wait(250);
  window.BagHud.close();

  // ---- 背包取图：按内容紧裁切 + 整数倍放大（Task 19）----
  /*
   * 病：格子与穿戴槽还在画整身 40x60 画布 —— 同一顶皮盔在兵器架里是宽扁的
   * 帽子（内容占比 1.000），进了背包只剩 32x46 盒子中央一条 13px 的色带
   * （内容占比 0.108），玩家的原话是"背包里看不出是什么"。
   * 药：格子按 32x46、穿戴槽按 20x28 去问 SpriteLib.fitUrl，取不到才退回整图；
   * 纸娃娃那一层是"主角本体 + 五层叠图"，必须继续用整身画布，不许改。
   *
   * 读数全部来自同一帧（面板开着、35 格与 10 个槽都在 DOM 里）：每张图的
   * naturalWidth x naturalHeight、内容包围盒占比、CSS 落点。明细在 RESULT.t19。
   * 这一整段在 SCRIPT 模板字符串里：不许反引号，也不写美元大括号。
   */
  if (window.BagHud && typeof window.BagHud.open === 'function') {
    const t19 = {};
    const stT = window.EmberfieldApp.__state;
    const snapEq19 = JSON.parse(JSON.stringify(stT.meta.equipment));
    const snapBag19 = JSON.parse(JSON.stringify(stT.meta.bag));

    // 夹具：10 件覆盖五个部位，其中三顶头盔（头部是最难认的那些）
    const fix19 = [
      ['leatherHelm'], ['ironHelm'], ['guardHelm'],
      ['rustySword'], ['shortSword'], ['broadSword'], ['crystalStaff'],
      ['chestPlate'], ['shortCape'], ['windBoots']
    ];
    stT.meta.bag.length = 0;
    fix19.forEach(function (p, i) {
      stT.meta.bag.push({ uid: 't19-' + i, id: p[0], level: 1 + (i % 3) });
    });
    stT.meta.equipment = {
      head: { id: 'leatherHelm', level: 2 },
      torso: { id: 'chestPlate', level: 1 },
      back: { id: 'shortCape', level: 1 },
      weapon: { id: 'rustySword', level: 3 },
      feet: { id: 'windBoots', level: 1 }
    };
    window.BagHud.open(stT);
    await wait(450);

    // 内容包围盒（alpha > 8）：只有这样才知道"交出来的这张位图里，
    // 内容到底占了多少"，光看自然尺寸分不出整身画布与裁切图。
    const bbox19 = function (im) {
      const nw = im.naturalWidth, nh = im.naturalHeight;
      if (!nw || !nh) return null;
      const cv = document.createElement('canvas');
      cv.width = nw; cv.height = nh;
      const c2 = cv.getContext('2d', { willReadFrequently: true });
      if (!c2) return null;
      c2.clearRect(0, 0, nw, nh);
      c2.drawImage(im, 0, 0);
      const d = c2.getImageData(0, 0, nw, nh).data;
      let x0 = nw, y0 = nh, x1 = -1, y1 = -1;
      for (let y = 0; y < nh; y++) {
        for (let x = 0; x < nw; x++) {
          if (d[(y * nw + x) * 4 + 3] > 8) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 < 0) return { ratio: 0, w: 0, h: 0 };
      return {
        ratio: Math.round(((x1 - x0 + 1) * (y1 - y0 + 1)) / (nw * nh) * 1000) / 1000,
        w: x1 - x0 + 1, h: y1 - y0 + 1
      };
    };
    const read19 = function (im) {
      const bb = bbox19(im);
      const rc = im.getBoundingClientRect();
      return {
        nw: im.naturalWidth, nh: im.naturalHeight,
        cssW: Math.round(rc.width), cssH: Math.round(rc.height),
        aspect: im.naturalWidth ? Math.round(im.naturalHeight / im.naturalWidth * 1000) / 1000 : -1,
        ratio: bb ? bb.ratio : -1, bw: bb ? bb.w : -1, bh: bb ? bb.h : -1
      };
    };
    const min19 = function (list, k) {
      return list.length ? Math.min.apply(null, list.map(function (r) { return r[k]; })) : null;
    };
    const max19 = function (list, k) {
      return list.length ? Math.max.apply(null, list.map(function (r) { return r[k]; })) : null;
    };

    // (1) 网格：每格一张图
    const cells19 = Array.prototype.slice.call(document.querySelectorAll('#bag .cell'));
    t19.cells = cells19.length;
    const cr19 = cells19[0] ? cells19[0].getBoundingClientRect() : null;
    t19.cellW = cr19 ? Math.round(cr19.width * 10) / 10 : null;
    t19.cellH = cr19 ? Math.round(cr19.height * 10) / 10 : null;
    const srcs19 = {};
    let srcN19 = 0;
    t19.grid = [];
    cells19.forEach(function (c, i) {
      const im = c.querySelector('img');
      if (!im) return;
      const rec = read19(im);
      rec.i = i;
      rec.title = String(c.title || '');
      t19.grid.push(rec);
      const s = String(im.src);
      if (!srcs19[s]) { srcs19[s] = 1; srcN19++; }
    });
    t19.filled = t19.grid.length;
    t19.gridSrcDistinct = srcN19;
    const dims19 = {};
    let dimN19 = 0;
    t19.grid.forEach(function (r) {
      const k = r.nw + 'x' + r.nh;
      if (!dims19[k]) { dims19[k] = 1; dimN19++; }
    });
    t19.gridDimDistinct = dimN19;
    const widths19 = {};
    let widthN19 = 0;
    t19.grid.forEach(function (r) {
      if (!widths19[r.nw]) { widths19[r.nw] = 1; widthN19++; }
    });
    // 只按宽度去重会假红：胸甲 63x54 与疾风靴 63x27 同宽 → 主断言用 nw x nh 对
    t19.gridWidthDistinct = widthN19;
    t19.minRatio = min19(t19.grid, 'ratio');
    t19.maxCssW = max19(t19.grid, 'cssW');
    t19.maxCssH = max19(t19.grid, 'cssH');
    // 头部三件按标题里的「盔」认，不按格子序号（序号随整理/排序会变）
    t19.heads = t19.grid.filter(function (r) { return r.title.indexOf('盔') >= 0; });
    t19.headMinNatW = min19(t19.heads, 'nw');
    t19.headMaxAspect = max19(t19.heads, 'aspect');
    t19.headMinRatio = min19(t19.heads, 'ratio');

    // (2) 穿戴槽：5 个部位 x 左右两列 = 10 个槽，已穿戴的每个都有图
    const slotImgs19 = Array.prototype.slice.call(document.querySelectorAll('#bag-wear .slot img'));
    t19.slotNodes = document.querySelectorAll('#bag-wear .slot').length;
    t19.slotImgs = slotImgs19.length;
    t19.slots = slotImgs19.map(function (im) {
      const rec = read19(im);
      const sl = im.parentNode;
      rec.slot = sl && sl.dataset ? sl.dataset.slot : null;
      return rec;
    });
    t19.slotRaw = t19.slots.filter(function (r) { return r.nw === 40 && r.nh === 60; }).length;
    t19.slotMinRatio = min19(t19.slots, 'ratio');
    t19.slotMaxW = max19(t19.slots, 'nw');
    t19.slotMaxH = max19(t19.slots, 'nh');
    t19.slotMaxCssW = max19(t19.slots, 'cssW');
    t19.slotMaxCssH = max19(t19.slots, 'cssH');

    // (3) 纸娃娃：1 张身体 + 已穿戴的 5 层，全部仍是 40x60 整身画布
    const dollImgs19 = Array.prototype.slice.call(document.querySelectorAll('#bag-wear .doll img'));
    t19.dollImgs = dollImgs19.length;
    t19.doll = dollImgs19.map(function (im) {
      const rec = read19(im);
      rec.alt = im.alt;
      return rec;
    });
    t19.dollRaw = dollImgs19.filter(function (im) {
      return im.naturalWidth === 40 && im.naturalHeight === 60;
    }).length;

    // 量完成对还原：后面的用例依赖这份状态
    stT.meta.equipment = snapEq19;
    stT.meta.bag = snapBag19;
    window.BagHud.refresh();
    window.BagHud.close();
    await wait(200);
    t19.snapBag = snapBag19.length;
    t19.restoredBag = stT.meta.bag.length;
    t19.snapEq = Object.keys(snapEq19).filter(function (k) { return !!snapEq19[k]; }).length;
    t19.restoredEq = Object.keys(stT.meta.equipment).filter(function (k) {
      return !!stT.meta.equipment[k];
    }).length;
    out.t19 = t19;
  }

  // ---- 背包面板收口（Task 10b）：尺寸 / 层级 / 跨页签勾选 / 保留件 / 拖动 ----
  // 本段整体在 SCRIPT 模板字符串里：注释里一个反引号都不许出现。
  // 上一段最后 close() 了面板，display:none 的元素 rect 全是 0，
  // 所以尺寸必须在重新 open() 之后再量。
  window.BagHud.open(stI);
  await wait(250);
  // 先放点东西进背包：空格子没有贴图，量不到"贴图有没有被挤扁"，
  // 而且下面逐页签计数也要非空才有意义。
  stI.meta.bag.length = 0;
  ['ironHelm', 'fullPlate', 'crystalStaff', 'emberBoots', 'bloodCharm', 'battleAxe']
    .forEach(function (id) { Lg.bagAdd(stI, id, 1); });
  window.BagHud.refresh();
  await wait(150);
  {
    const el = document.getElementById('bag');
    const box = el.getBoundingClientRect();
    out.ratioW = Math.round(box.width);
    out.ratioH = Math.round(box.height);
    out.areaRatio = Math.round((box.width * box.height) / (960 * 600) * 1000) / 1000;

    const allCells = el.querySelectorAll('.cell');
    const lastCell = allCells[allCells.length - 1];
    out.lastRowInside = lastCell
      ? lastCell.getBoundingClientRect().bottom <= box.bottom + 0.5 : null;
    const cellImg = document.querySelector('#bag .cell img');
    out.cellImgW = cellImg ? Math.round(cellImg.getBoundingClientRect().width) : null;

    // toast 必须画在面板之上：右键出售的反馈全靠它，被盖住就是静默失败。
    const toast = document.getElementById('toast');
    const toastTextBefore = toast.textContent;
    toast.textContent = '探针';
    toast.classList.add('on');
    out.toastZ = parseInt(getComputedStyle(toast).zIndex, 10) || 0;
    out.bagZ = parseInt(getComputedStyle(el).zIndex, 10) || 0;
    // #toast 是 pointer-events:none（纯展示层，不该挡住点击），而 elementFromPoint
    // 会跳过这类元素 —— 不临时打开命中测试，正确实现下这条断言也永远是 false。
    // 绘制顺序与 pointer-events 无关，所以临时打开不改变被断言的事实。
    const peBefore = toast.style.pointerEvents;
    toast.style.pointerEvents = 'auto';
    const tb = toast.getBoundingClientRect();
    const hit = document.elementFromPoint((tb.left + tb.right) / 2, (tb.top + tb.bottom) / 2);
    out.toastHit = !!(hit && (hit === toast || toast.contains(hit)));
    out.toastHitTag = hit ? (hit.id || hit.className || hit.tagName) : 'null';
    toast.style.pointerEvents = peBefore;
    toast.classList.remove('on');
    toast.textContent = toastTextBefore;

    // 夹边两角都要夹：只测左上角时，Math.min(..., maxL) 写坏也照样通过。
    el.style.left = '9999px';
    el.style.top = '9999px';
    window.BagHud.clamp(el);
    const se = el.getBoundingClientRect();
    out.clampSE = { right: Math.round(se.right), bottom: Math.round(se.bottom),
      vw: innerWidth, vh: innerHeight,
      inside: se.right <= innerWidth + 0.5 && se.bottom <= innerHeight + 0.5 };
  }

  // 逐页签：可见填充格数必须与逻辑层同口径（bagFilter 的长度，本页最多 35 格）。
  // 注意没有 filled 这个类（paintCell 只给 empty / noart / worn / keep / sel / pickable），
  // 所以"有东西的格子"只能按 :not(.empty) 数。
  out.tabCounts = {};
  out.tabExpect = {};
  out.tabButtons = 0;
  const tabIds = ['all', 'head', 'torso', 'back', 'weapon', 'feet', 'special'];
  for (let ti = 0; ti < tabIds.length; ti++) {
    const tid = tabIds[ti];
    const tabBtn = document.querySelector('#bag [data-tab="' + tid + '"]');
    if (tabBtn) out.tabButtons++;
    if (!tabBtn) continue;
    tabBtn.click();
    await wait(120);
    out.tabCounts[tid] = document.querySelectorAll('#bag .cell:not(.empty)').length;
    out.tabExpect[tid] = Math.min(Lg.bagFilter(stI.meta.bag, tid).length, 35);
  }
  // 页签太多时会被 #bag-tabs 裁掉：截图上就看不见「特殊」了。
  const tabsRow = document.getElementById('bag-tabs');
  out.tabsFit = tabsRow ? { scroll: tabsRow.scrollWidth, client: tabsRow.clientWidth } : null;

  const allTabBtn = document.querySelector('#bag [data-tab="all"]');
  if (allTabBtn) { allTabBtn.click(); await wait(120); }

  // 批量勾选不许跨页签 / 跨页保留（勾选态是"看得见的承诺"，切走后就不该还在）。
  // 用 3 件同名、等级 1/2/3：逻辑层保留等级最高那件，UI 必须把那件标出来。
  stI.meta.bag.length = 0;
  Lg.bagAdd(stI, 'ironHelm', 1);
  Lg.bagAdd(stI, 'ironHelm', 2);
  Lg.bagAdd(stI, 'ironHelm', 3);
  window.BagHud.refresh();
  await wait(120);
  const batchBtn2 = document.querySelector('#bag [data-act="batch-sell"]');
  out.batchBtn2 = !!batchBtn2;
  if (batchBtn2) { batchBtn2.click(); await wait(150); }
  const pickDups2 = document.querySelector('#bag [data-act="pick-dups"]');
  if (pickDups2) { pickDups2.click(); await wait(200); }
  out.selBeforeTabSwitch = document.querySelectorAll('#bag .cell.sel').length;

  const keepCells = [].slice.call(document.querySelectorAll('#bag .cell.keep'));
  out.keepCount = keepCells.length;
  out.keepLv = keepCells.length === 1 && keepCells[0].querySelector('.lv')
    ? keepCells[0].querySelector('.lv').textContent : null;
  out.keepTitleHasNote = keepCells.length === 1
    ? (keepCells[0].title || '').indexOf('保留') >= 0 : null;
  const sellableNow = Lg.sellableUids(stI) || [];
  let keepUidExpect = null;
  stI.meta.bag.forEach(function (e) {
    if (sellableNow.indexOf(e.uid) < 0) keepUidExpect = e.uid;
  });
  out.keepUid = keepCells.length === 1 ? keepCells[0].dataset.uid : null;
  out.keepUidExpect = keepUidExpect;

  const weaponTab2 = document.querySelector('#bag [data-tab="weapon"]');
  if (weaponTab2) { weaponTab2.click(); await wait(150); }
  if (allTabBtn) { allTabBtn.click(); await wait(150); }
  out.selAfterTabSwitch = document.querySelectorAll('#bag .cell.sel').length;
  const confirm2 = document.querySelector('#bag .confirm-ok');
  out.confirmDisabledAfterTabSwitch = !!(confirm2 && confirm2.disabled);

  // 翻页同样要清空：勾了第 1 页的件、翻到第 2 页确认，卖掉的是看不见的东西。
  if (pickDups2) { pickDups2.click(); await wait(150); }
  out.selBeforePageSwitch = document.querySelectorAll('#bag .cell.sel').length;
  const nextBtn2 = document.querySelector('#bag [data-page="next"]');
  out.nextEnabled2 = !!(nextBtn2 && !nextBtn2.disabled);
  if (nextBtn2 && !nextBtn2.disabled) { nextBtn2.click(); await wait(150); }
  const prevBtn2 = document.querySelector('#bag [data-page="prev"]');
  if (prevBtn2 && !prevBtn2.disabled) { prevBtn2.click(); await wait(150); }
  out.selAfterPageSwitch = document.querySelectorAll('#bag .cell.sel').length;

  const cancel2 = document.querySelector('#bag [data-act="batch-cancel"]');
  if (cancel2) { cancel2.click(); await wait(150); }

  // open() 要复位页签：第二次打开还停在「武器」就违背"打开就是一次全新开始"。
  const feetTab2 = document.querySelector('#bag [data-tab="feet"]');
  if (feetTab2) { feetTab2.click(); await wait(120); }
  window.BagHud.close();
  await wait(150);
  window.BagHud.open(stI);
  await wait(200);
  const onTab2 = document.querySelector('#bag .tab.on');
  out.tabAfterReopen = onTab2 ? onTab2.dataset.tab : null;

  // 真实拖动：pointerdown 在标题栏 → pointermove → 面板跟着动；拖到屏幕外时当场夹住。
  // 标题栏整条都是把手（只有标题文字能拖的话玩家会以为面板卡住了）。
  {
    const elD = document.getElementById('bag');
    const barD = document.getElementById('bag-bar');
    const r0 = elD.getBoundingClientRect();
    barD.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true,
      button: 0, pointerId: 11, clientX: r0.left + 60, clientY: r0.top + 12 }));
    await wait(60);
    out.barGrabbingDuringDrag = barD.classList.contains('grabbing');
    barD.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true,
      pointerId: 11, clientX: r0.left + 60 - 120, clientY: r0.top + 12 - 80 }));
    await wait(60);
    const r1 = elD.getBoundingClientRect();
    out.dragDx = Math.round(r1.left - r0.left);
    out.dragDy = Math.round(r1.top - r0.top);
    // 拖到左上角之外：边拖边夹，left/top 必须停在 0 而不是负坐标
    barD.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true,
      pointerId: 11, clientX: -500, clientY: -500 }));
    await wait(60);
    const r2 = elD.getBoundingClientRect();
    out.dragClampLeft = Math.round(r2.left);
    out.dragClampTop = Math.round(r2.top);
    barD.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true,
      pointerId: 11 }));
    await wait(60);
    out.barGrabbingAfterUp = barD.classList.contains('grabbing');

    // 拖到一半关闭：抓取光标不许留在那儿（close() 要清 grabbing 并释放 pointer capture）
    barD.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true,
      button: 0, pointerId: 12, clientX: 60, clientY: 12 }));
    await wait(60);
    out.barGrabbingBeforeClose = barD.classList.contains('grabbing');
    window.BagHud.close();
    await wait(150);
    out.barGrabbingAfterClose = barD.classList.contains('grabbing');
    // 关闭后残留的 pointermove 不许再动面板（drag 必须清干净）
    const leftBefore = document.getElementById('bag').style.left;
    barD.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true,
      pointerId: 12, clientX: 400, clientY: 300 }));
    await wait(60);
    out.panelLeftAfterStrayMove = document.getElementById('bag').style.left === leftBefore;
    window.BagHud.close();
    await wait(100);
  }

  // F4 回归：连开两次 + 关一次，宿主只该收到一次 onOpen / 一次 onClose。
  // 多通知一次就把"打开前的状态"记成了 true，关背包时永远恢复成 true，
  // update() 从此早退 —— 角色永久走不动（原缺陷实测位移 0px）。
  window.BagHud.open(stI);
  window.BagHud.open(stI);
  await wait(200);
  out.doubleOpenPanelOpen = !!hubP.panelOpen;
  window.BagHud.close();
  await wait(250);
  out.panelOpenAfterDoubleOpen = !!hubP.panelOpen;
  stI.hub.x = 300;
  stI.hub.z = 105;
  await wait(150);
  out.doubleOpenXBefore = stI.hub.x;
  key('keydown', 'KeyD', 68);
  await wait(700);
  key('keyup', 'KeyD', 68);
  await wait(120);
  out.doubleOpenXAfter = stI.hub.x;
  window.BagHud.close();
  await wait(100);

  // ---- 基地六点位错落 + 头顶键帽（V16 现场 / V17）----
  //
  // 探针必须拿真实的 Hub 场景对象。旧的长提示是画布里的 Text，用 DOM 查询
  // 永远拿到 null —— 那种写法出来的断言恒真恒假，什么也证明不了，所以这里
  // 先断言"确实取到了 Hub 场景"，再往下测。
  const stZ = window.EmberfieldApp.__state;
  const hubZ = globalThis.__game.scene.getScene('Hub');
  out.hubProbe = {
    isScene: !!(hubZ && hubZ.scene && hubZ.scene.key === 'Hub'),
    key: hubZ && hubZ.scene ? hubZ.scene.key : null,
    hasZoneArt: !!(hubZ && hubZ.zoneArt),
    hasKeycap: !!(hubZ && hubZ.keycap),
  };
  const hubTexts = function () {
    return (hubZ && hubZ.children ? hubZ.children.list : [])
      .filter(function (c) { return c && c.type === 'Text'; })
      .map(function (c) { return String(c.text); });
  };
  // 场景里所有文字。要同时证明两件事：六个点位名字还在（别删过头），
  // 长提示的文案一个不剩（别只把 visible 关掉）。
  out.hubTexts = hubTexts();
  out.hubTextsWithPrompt = out.hubTexts.filter(function (t) { return t.indexOf('按 J') >= 0; });
  // 长提示对象是不是真的不在了（而不是 setVisible(false) 留着）
  out.hasPromptObj = !!hubZ.prompt;
  // 点位名字从 ZONES 现取，别在断言里写死中文名 —— 改名就误报
  out.zoneNames = (window.GameHub.ZONES || []).map(function (z) { return z.name; });
  // 六个设施实际画在屏幕上的底边 y 与缩放：错落必须能量出来，
  // 而不是靠"看着像错落"。同一 y 说明仍然是一条直线。
  out.zoneArtY = {};
  out.zoneArtScale = {};
  if (hubZ && hubZ.zoneArt) {
    Object.keys(hubZ.zoneArt).forEach(function (id) {
      const a = hubZ.zoneArt[id];
      out.zoneArtY[id] = Math.round(a.y);
      out.zoneArtScale[id] = Math.round((a.scaleX === undefined ? 1 : a.scaleX) * 1000) / 1000;
    });
  }

  // ---- 名字胶囊必须挂在各自设施美术的顶边上方（Task 11b）----
  // 判据全部用真实包围盒：容器 getBounds() 含缩放，文字 getBounds() 含 padding。
  // 胶囊按 ZONES 里的名字精确匹配 —— 场景里还有别的 Text，按"第几个"取位会随
  // 别人的改动错位，那时断言的是一张完全不相干的标签。
  const zoneTexts = (hubZ && hubZ.children ? hubZ.children.list : [])
    .filter(function (c) { return c && c.type === 'Text'; });
  const labelOf = function (z) {
    return zoneTexts.filter(function (t) {
      return String(t.text) === z.name;
    })[0] || null;
  };
  out.zoneLabels = {};
  if (hubZ && hubZ.zoneArt) {
    (window.GameHub.ZONES || []).forEach(function (z) {
      const art = hubZ.zoneArt[z.id];
      const lb = labelOf(z);
      if (!art || !lb) return;
      const ab = art.getBounds();
      const tb = lb.getBounds();
      out.zoneLabels[z.id] = {
        artTop: Math.round(ab.top * 10) / 10,
        artBottom: Math.round(ab.bottom * 10) / 10,
        labelTop: Math.round(tb.top * 10) / 10,
        labelBottom: Math.round(tb.bottom * 10) / 10,
        originY: lb.originY,
      };
    });
  }

  // 反证的核心：角色站在该设施正前方（z = 0，画面最前排）时，
  // 胶囊矩形与角色矩形不许相交。胶囊原先在设施底边下方 y + 14，
  // 那时正好落在脑袋高度，被头盔切成两片残字。
  out.labelHeroHits = [];
  {
    const zonesForLabel = (window.GameHub.ZONES || []).slice();
    for (let i = 0; i < zonesForLabel.length; i++) {
      const z = zonesForLabel[i];
      stZ.hub.x = z.x;
      stZ.hub.z = 0;
      stZ.hub.facing = 1;
      await wait(220);
      const lb = labelOf(z);
      const hero = hubZ && hubZ.hero;
      if (!lb || !hero) { out.labelHeroHits.push({ id: z.id, missing: true }); continue; }
      const tb = lb.getBounds();
      const hb = hero.getBounds();
      const overlapX = Math.min(tb.right, hb.right) - Math.max(tb.left, hb.left);
      const overlapY = Math.min(tb.bottom, hb.bottom) - Math.max(tb.top, hb.top);
      out.labelHeroHits.push({
        id: z.id,
        hit: overlapX > 0 && overlapY > 0,
        overlapX: Math.round(overlapX * 10) / 10,
        overlapY: Math.round(overlapY * 10) / 10,
        labelBottom: Math.round(tb.bottom * 10) / 10,
        heroTop: Math.round(hb.top * 10) / 10,
        heroX: Math.round(hb.centerX * 10) / 10,
      });
    }
  }

  // 远离点位：x=500 落在 shop 与 forgewear 的横向容差之外，z 取默认中线。
  stZ.hub.x = 500;
  stZ.hub.z = 105;
  await wait(500);
  out.farZone = (window.GameHub.zoneAt(stZ) || {}).id || null;
  out.farCap = !!(hubZ.keycap && hubZ.keycap.visible);
  out.farCapAlpha = hubZ.keycap ? Math.round(hubZ.keycap.alpha * 100) / 100 : null;

  // 站到铁匠铺前（anvil 的错落深度是 122，不是默认 105 —— 这正是二维判定的现场）
  stZ.hub.x = 265;
  stZ.hub.z = 122;
  await wait(600);
  out.nearZoneId = (window.GameHub.zoneAt(stZ) || {}).id || null;
  out.nearCap = !!(hubZ.keycap && hubZ.keycap.visible);
  out.nearCapAlpha = hubZ.keycap ? Math.round(hubZ.keycap.alpha * 100) / 100 : null;
  out.nearPromptTexts = hubTexts().filter(function (t) { return t.indexOf('按 J') >= 0; });
  if (hubZ.keycap && hubZ.hero) {
    // 键帽必须贴在角色头顶右上方；尺寸要真是键帽那么大（约 26x26）。
    // 注意：容器 getBounds() 只量得到里面的 J 字（10x17），量不到键帽本体，
    // 所以优先读容器自己声明的尺寸。
    const b = hubZ.keycap.getBounds();
    out.capPos = { x: Math.round(hubZ.keycap.x), y: Math.round(hubZ.keycap.y) };
    out.capSize = {
      w: Math.round(hubZ.keycap.width || b.width),
      h: Math.round(hubZ.keycap.height || b.height),
    };
    out.capBounds = { w: Math.round(b.width), h: Math.round(b.height) };
    out.heroPos = { x: Math.round(hubZ.hero.x), y: Math.round(hubZ.hero.y) };
    out.capDepth = hubZ.keycap.depth;
    out.heroDepth = hubZ.hero.depth;
    // 键帽里必须真的有 J 这个字，而且只有这一个字
    out.capText = (hubZ.keycap.list || [])
      .filter(function (o) { return o && o.type === 'Text'; })
      .map(function (o) { return String(o.text); });
  }

  // 逐个点位走一遍：每个设施都得能触发（判定 + 键帽一起看）
  out.zoneHits = [];
  const zoneList = (window.GameHub.ZONES || []).slice();
  for (let i = 0; i < zoneList.length; i++) {
    const z = zoneList[i];
    stZ.hub.x = z.x;
    stZ.hub.z = z.z;
    await wait(160);
    out.zoneHits.push({
      want: z.id,
      got: (window.GameHub.zoneAt(stZ) || {}).id || null,
      cap: !!(hubZ.keycap && hubZ.keycap.visible),
      z: z.z,
    });
  }

  // ---- ESC 菜单 / 音量滑块 / 退出战斗（Task 13）----
  // 注意：这一段在 SCRIPT 这个模板字符串里，**一个反引号都不许出现**，
  // 也不能出现"美元符号 + 左花括号"（会被外层模板字符串当插值吞掉）。
  //
  // 整段包在 typeof 守卫里：本文件在实现之前就要能跑（红阶段要的是"新断言红、
  // 旧断言绿"），裸调 window.EmberfieldUI.openEsc 会把上面 200+ 条既有断言
  // 一起带走 —— 那时红的是"脚本抛异常"，不是"功能没做"。
  out.escUiExists = !!(window.EmberfieldUI &&
    typeof window.EmberfieldUI.openEsc === 'function');
  out.escDomExists = !!document.getElementById('esc');
  if (out.escUiExists && out.escDomExists) {
    const escUi = window.EmberfieldUI;
    const escRoot = document.getElementById('esc');
    const stE = window.EmberfieldApp.__state;
    const hubE = globalThis.__game.scene.getScene('Hub');
    // 0) 收拾前置：上面的段落是用 Run 场景自己 scene.start('Hub') 切回来的，
    //    并没有走结算 —— state.phase 还停在 'run'。而菜单行是按 state.phase 决定的
    //    （设计 §5.6：在战斗中才有「退出战斗」），不清掉这一局的残留，
    //    这一节测到的就不是基地。
    out.escPhaseBefore = String(stE.phase);
    if (stE.phase === 'run' && stE.run) window.GameLogic.exitRun(stE);
    if (stE.phase === 'result') window.GameLogic.returnToFarm(stE);
    out.escPhaseNorm = String(stE.phase);
    await wait(250);

    // 1) 背包开着时按 ESC：先关背包，不叠第二层暂停
    //    （两层 pause 叠起来时，关掉上面那层的 resume 只解掉一层，玩家会被冻住）
    window.BagHud.open(stE);
    await wait(250);
    out.escBagWasOpen = window.BagHud.isOpen();
    key('keydown', 'Escape', 27); await wait(60); key('keyup', 'Escape', 27);
    await wait(300);
    out.escBagClosedFirst = !window.BagHud.isOpen();
    out.escMenuNotOpenedOverBag = !escUi.isEscOpen();
    out.escHubResumedAfterBag = !hubE.scene.isPaused();

    // 2) 基地 ESC：只有「设置」一行，游戏真的停住
    stE.hub.x = 300; stE.hub.z = 105;
    await wait(200);
    out.escDisplayedBefore = getComputedStyle(escRoot).display;
    key('keydown', 'Escape', 27); await wait(60); key('keyup', 'Escape', 27);
    await wait(320);
    out.escOpenedHub = escUi.isEscOpen();
    out.escDisplayedHub = getComputedStyle(escRoot).display;
    out.escPausedHub = hubE.scene.isPaused();
    const rowsHubE = document.querySelectorAll('#esc .esc-row');
    out.escRowsHub = rowsHubE.length;
    out.escRowLabelsHub = Array.prototype.map.call(rowsHubE,
      function (b) { return String(b.textContent); });
    out.escQuitInHub = !!document.querySelector('#esc [data-act="quit"]');
    // 暂停的硬证据：按 D 半秒，坐标不该动（isPaused() 只是个标志位，能自己写）
    const hx0 = stE.hub.x;
    key('keydown', 'KeyD', 68); await wait(600); key('keyup', 'KeyD', 68);
    await wait(200);
    out.escXDeltaPaused = Math.round((stE.hub.x - hx0) * 100) / 100;

    // 3) 设置页：两个原生 range、左侧填绿、圆钮、拖动真落地
    const rowSet = document.querySelector('#esc .esc-row[data-act="settings"]');
    out.escSettingsRow = !!rowSet;
    if (rowSet) { rowSet.click(); await wait(280); }
    const volM = document.getElementById('vol-master');
    const volS = document.getElementById('vol-music');
    out.volMaster = volM ? { tag: volM.tagName, type: volM.type, min: volM.min,
      max: volM.max, value: volM.value, h: volM.getBoundingClientRect().height } : null;
    out.volMusic = volS ? { tag: volS.tagName, type: volS.type, min: volS.min,
      max: volS.max, value: volS.value } : null;
    const bgM = volM ? String(getComputedStyle(volM).backgroundImage) : '';
    out.volMasterBg = bgM.slice(0, 160);
    out.volMasterBgIsGradient = bgM.indexOf('linear-gradient') >= 0;
    // 绿色必须出现在"已划过的那一段"上：127,196,92 = #7fc45c
    out.volMasterBgHasGreen = /127,\\s*196,\\s*92/.test(bgM);
    // 圆钮：样式表里要真的有 ::-webkit-slider-thumb 规则且是 50%
    // 滑块有两条 thumb 规则（常态 + :focus-visible），逐条读、拼起来判 ——
    // 只留"最后一条"会读到 focus 那条，它没有 border-radius。
    let thumbRule = '';
    const sheetsE = document.styleSheets;
    for (let si = 0; si < sheetsE.length; si++) {
      const rs = sheetsE[si].cssRules;
      for (let ri = 0; ri < rs.length; ri++) {
        const txt = String(rs[ri].cssText || '');
        if (txt.indexOf('::-webkit-slider-thumb') >= 0 && txt.indexOf('vol') >= 0) {
          thumbRule += txt + ' ';
        }
      }
    }
    out.volThumbRule = thumbRule.slice(0, 200);
    out.volThumbRound = /border-radius:\\s*50%/.test(thumbRule);
    out.musicNote = (document.getElementById('vol-music-note') || {}).textContent || '';
    out.volMasterValueText = (document.getElementById('vol-master-val') || {}).textContent || '';
    // 拖到 40：值必须同时落到存档与真实增益上（只写 meta = 滑块没接上音频；
    // 只调音频 = 关掉再开就回到 30%）
    if (volM) {
      volM.value = '40';
      volM.dispatchEvent(new Event('input', { bubbles: true }));
      // 先响一声再读增益：AudioParam 的自动化要等音频图真的被拉取
      // 才会反映到 .value 上（实测：只排梯度不播声音，读数停在旧值）。
      // 这也更接近真实用法 —— 玩家调完音量通常马上就会有音效。
      if (window.GameAudio && typeof window.GameAudio.play === 'function') {
        window.GameAudio.play('coin');
      }
      await wait(300);
    }
    out.volMetaAfter = stE.meta.settings ? stE.meta.settings.volume : null;
    out.volGainAfter = window.GameAudio && window.GameAudio.masterGain
      ? window.GameAudio.masterGain.gain.value : null;
    out.volFillAfter = volM ? (volM.style.getPropertyValue('--fill') || '') : '';
    out.volValueTextAfter = (document.getElementById('vol-master-val') || {}).textContent || '';
    // 音乐滑块：存值、但不接任何声源（本作没有 BGM），界面必须自己说明
    if (volS) {
      volS.value = '70';
      volS.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(200);
    }
    out.musicMetaAfter = stE.meta.settings ? stE.meta.settings.music : null;
    out.musicGainUnaffected = window.GameAudio && window.GameAudio.masterGain
      ? window.GameAudio.masterGain.gain.value : null;

    // 3b) 环境音滑块（Task 23 / V21）：只动虫鸣那一条增益，总音量纹丝不动
    const volA = document.getElementById('vol-ambient');
    out.volAmbient = volA ? { tag: volA.tagName, type: volA.type, min: volA.min,
      max: volA.max, value: volA.value } : null;
    out.volAmbientLabel = (function () {
      const row = volA && volA.parentNode;
      const lab = row && row.querySelector ? row.querySelector('.vol-lab') : null;
      return lab ? String(lab.textContent) : '';
    })();
    out.ambientMetaBefore = stE.meta.settings ? stE.meta.settings.ambient : null;
    const masterBeforeAmb = window.GameAudio && window.GameAudio.masterGain
      ? window.GameAudio.masterGain.gain.value : null;
    if (volA) {
      volA.value = '55';
      volA.dispatchEvent(new Event('input', { bubbles: true }));
      if (window.GameAudio && typeof window.GameAudio.play === 'function') {
        window.GameAudio.play('coin');
      }
      await wait(300);
    }
    out.ambientMetaAfter = stE.meta.settings ? stE.meta.settings.ambient : null;
    out.volAmbientValueText = (document.getElementById('vol-ambient-val') || {}).textContent || '';
    out.ambientGainAfter55 = window.GameAudio && window.GameAudio.ambientGain
      ? window.GameAudio.ambientGain.gain.value : null;
    out.masterBeforeAmbientDrag = masterBeforeAmb;
    out.masterAfterAmbientDrag = window.GameAudio && window.GameAudio.masterGain
      ? window.GameAudio.masterGain.gain.value : null;
    // 3) 拖到 0：虫鸣必须真的归零，而总音量**不许**跟着动。
    // 这条是"两条通道独立"的硬证据 —— 一起静音就说明滑块接错了通道。
    if (volA) {
      volA.value = '0';
      volA.dispatchEvent(new Event('input', { bubbles: true }));
      if (window.GameAudio && typeof window.GameAudio.play === 'function') {
        window.GameAudio.play('coin');
      }
      await wait(300);
    }
    out.ambientGainAtZero = window.GameAudio && window.GameAudio.ambientGain
      ? window.GameAudio.ambientGain.gain.value : null;
    out.masterAtAmbientZero = window.GameAudio && window.GameAudio.masterGain
      ? window.GameAudio.masterGain.gain.value : null;
    // 拖回 55，后面的断言与读数继续按 0.55 走
    if (volA) {
      volA.value = '55';
      volA.dispatchEvent(new Event('input', { bubbles: true }));
      if (window.GameAudio && typeof window.GameAudio.play === 'function') {
        window.GameAudio.play('coin');
      }
      await wait(300);
    }
    // 4) 设置页里按 ESC：先退回菜单页（不直接关，少一层误触），再按一次才关
    key('keydown', 'Escape', 27); await wait(60); key('keyup', 'Escape', 27);
    await wait(320);
    out.escFromSettingsStillOpen = escUi.isEscOpen();
    out.escSettingsDisplayAfterEsc = getComputedStyle(
      document.getElementById('esc-settings')).display;
    out.escPausedAfterEscBack = hubE.scene.isPaused();
    key('keydown', 'Escape', 27); await wait(60); key('keyup', 'Escape', 27);
    await wait(320);
    out.escClosedAgain = !escUi.isEscOpen();
    out.escDisplayedAfterClose = getComputedStyle(escRoot).display;
    out.escPausedAfterClose = hubE.scene.isPaused();
    const hx1 = stE.hub.x;
    key('keydown', 'KeyD', 68); await wait(600); key('keyup', 'KeyD', 68);
    await wait(200);
    out.escXDeltaResumed = Math.round((stE.hub.x - hx1) * 100) / 100;

    // 5) 战斗中 ESC：两行，且「退出战斗」按血量折扣结算
    stE.meta.potions = { heal: 0, strength: 0, wall: 0 };
    hubE.startRun('wood');
    await until(function () { return !!(stE.run && stE.run.player); }, 8000, 'escRun');
    await wait(500);
    const runE = stE.run;
    const runSc = globalThis.__game.scene.getScene('Run');
    out.escRunFound = !!runE && !!runSc;
    // V20：进了关卡就没有营地虫鸣（HubScene 关掉环境音，不是把它调成 0）
    out.ambientNameInRun = window.GameAudio && typeof window.GameAudio.ambientName === 'function'
      ? window.GameAudio.ambientName() : null;
    if (runE && runSc) {
      runE.loot.coins = 1000;
      runE.loot.seeds = 200;
      runE.player.hp = runE.player.maxHp;
      const runMaxHp = runE.player.maxHp;
      await wait(200);
      key('keydown', 'Escape', 27); await wait(60); key('keyup', 'Escape', 27);
      await wait(320);
      out.escOpenedRun = escUi.isEscOpen();
      out.escPausedRun = runSc.scene.isPaused();
      const rowsRunE = document.querySelectorAll('#esc .esc-row');
      out.escRowsRun = rowsRunE.length;
      out.escRowLabelsRun = Array.prototype.map.call(rowsRunE,
        function (b) { return String(b.textContent); });
      const quitBtn = document.querySelector('#esc [data-act="quit"]');
      out.escQuitInRun = !!quitBtn;
      // 战斗停住的硬证据：elapsed 由 logic 每帧 += dt，update 不跑就不会涨
      const e0 = runE.elapsed;
      await wait(450);
      out.escElapsedWhilePaused = Math.round((runE.elapsed - e0) * 1000) / 1000;

      const coinsBefore = stE.meta.coins;
      if (quitBtn) { quitBtn.click(); await wait(500); }
      out.escPhaseAfterQuit = stE.phase;
      out.escRunClearedAfterQuit = stE.run === null;
      out.escResultTitle = (document.getElementById('panelTitle') || {}).textContent || '';
      out.escResultBody = String((document.getElementById('panelBody') || {}).innerHTML || '')
        .replace(/\\s+/g, ' ');
      out.escResultCoins = stE.lastResult ? stE.lastResult.coins : null;
      out.escResultSeeds = stE.lastResult ? stE.lastResult.seeds : null;
      out.escResultExited = stE.lastResult ? !!stE.lastResult.exited : null;
      out.escResultKeep = stE.lastResult ? stE.lastResult.keep : null;
      out.escCoinsGained = stE.meta.coins - coinsBefore;
      out.escPanelOpen = !!document.querySelector('#panel.overlay.on');
      // 连点第二次：不许再发一份钱（反刷）
      const coinsAfter = stE.meta.coins;
      const dup = window.GameLogic.exitRun(stE);
      out.escDupOk = dup && dup.ok;
      out.escDupCoinsDelta = stE.meta.coins - coinsAfter;
      // 收尾：点「回基地」回到基地，再把背包打开 ——
      // 后面的 resize 段要的是"基地 + 背包面板开着"，别把它要的前置状态换掉。
      const backBtn = document.getElementById('btn-back');
      if (backBtn) backBtn.click();
      await wait(500);
      out.escPhaseBackHub = stE.phase;
      window.BagHud.open(stE);
      await wait(350);
      out.escBagReopened = window.BagHud.isOpen();
      out.escRunMaxHp = runMaxHp;
    }
  }

  // ---- 药水铺卖「背包页数+1」：真浏览器里点得到、买得着（Task 20）----
  /*
   * 本节量的是"需求原文指定的那条路径真的通了"：PM 要的是在药水铺卖扩容，
   * 而改前药水铺只有三瓶药水，扩容只能从背包面板的 +扩容 点 —— 药水铺这条
   * 路径根本没接。逻辑层由 test_game_meta.js 的 6c 节钉；这里钉的是渲染层：
   * 行渲染出来没有、按钮写的是什么、点下去 meta 是不是真的变了。
   *
   * 本段整体在 SCRIPT 模板字符串里：注释里一个反引号都不许写，
   * 正则里不许出现单个反斜杠。
   */
  {
    const stB = window.EmberfieldApp.__state;
    const hubB = globalThis.__game.scene.getScene('Hub');
    window.BagHud.close();
    hubB.panelOpen = false;
    window.EmberfieldUI.closePanel();
    await wait(200);

    // 站到药水铺上（x/z 取 ZONES 里的真值，别写死坐标）
    const shopZone = (window.GameHub.ZONES || []).filter(function (z) {
      return z.id === 'shop';
    })[0];
    stB.hub.x = shopZone ? shopZone.x : 565;
    stB.hub.z = shopZone ? shopZone.z : 122;
    await wait(300);
    out.t20ShopZone = (window.GameHub.zoneAt(stB) || {}).id || null;

    // 把钱包和页数摆到确定状态：1 页、钱刚好够买第 2 页（200）
    //
    // Task 21 §六：这段是**借**了 state.meta 来造确定状态，后面 3e / 重开 /
    // 远征都读同一份 state.meta —— 所以有借必须有还。进入前先记原值
    // （不假设是 1 / 1000），段末还原并断言。
    // 存原值，用来在段末还原。但要注意：原值可能**恰好等于**买完后的值
    // （实测进入本节时 bagPages 已经是 2，而买完也是 2）—— 那样末尾那条
    // "复位成进入值"在完全不复位时也成立，是恒真断言。所以还原目标
    // 单独取一个与买完后（1 → 2）必然不同的数：maxPages（6）。
    out.t20PagesEntry = stB.meta.bagPages;
    out.t20CoinsEntry = stB.meta.coins;
    out.t20PagesRestoreTo = (window.GameConfig && window.GameConfig.BAG
      ? window.GameConfig.BAG.maxPages : 6);
    stB.meta.bagPages = 1;
    stB.meta.coins = 1000;
    const coinsBeforeBuy = stB.meta.coins;
    const pagesBeforeBuy = stB.meta.bagPages;

    hubB.panelOpen = true;
    hubB.showPanel(window.GameHub.zoneById('shop'));
    await wait(260);

    const rowsB = document.querySelectorAll('#panelBody .act');
    out.t20Rows = rowsB.length;
    out.t20ShopTabs = document.querySelectorAll('#panel .tabs button').length;
    // Task 24 被迫改值：商店多了一行「开垦一块田地」，最后一行不再是扩容。
    // 改成按标签找 —— 按下标取到的会是田地那一行，量错了对象。
    const bagRowOf = function (list) {
      for (let i = 0; i < list.length; i++) {
        const t = list[i].querySelector('.t');
        if (t && t.textContent === '背包页数+1') return list[i];
      }
      return null;
    };
    const lastB = bagRowOf(rowsB);
    out.t20LastLabel = lastB
      ? (lastB.querySelector('.t') ? lastB.querySelector('.t').textContent : null) : null;
    out.t20LastSub = lastB
      ? (lastB.querySelector('.s') ? lastB.querySelector('.s').textContent : null) : null;
    const btnB = lastB ? lastB.querySelector('button') : null;
    out.t20BtnText = btnB ? String(btnB.textContent) : null;
    out.t20BtnDisabled = btnB ? !!btnB.disabled : null;
    // 按钮矩形也记下来：截图之外还能证明"这颗按钮真的有可点面积"
    if (btnB) {
      const rb = btnB.getBoundingClientRect();
      out.t20BtnRect = { left: Math.round(rb.left), top: Math.round(rb.top),
        w: Math.round(rb.width), h: Math.round(rb.height) };
    }
    // 每行的标签文本（四行齐全的证据）
    out.t20AllLabels = Array.prototype.slice.call(rowsB).map(function (r) {
      const t = r.querySelector('.t');
      return t ? t.textContent : null;
    }).join('/');

    // 真的点一下 —— 这是 A5 第 4 条：从 UI 能买到，不是只有 logic 层通
    if (btnB) { btnB.click(); await wait(320); }
    /*
     * 提示条不能压在卡片上。
     *
     * 实测到过一次：在商店买完田地，「已购买」那声提示正好落在卡片最后一行，
     * 刚变成「当前 10/27 块」的那行被自己盖住，要等两秒才看得见结果 ——
     * 买了东西看不见结果，等于没有反馈。原因是 #toast 的 bottom:96px 是
     * 为了跑图时让开底部技能条（#skills 高 60px、也在 bottom:14px），
     * 而面板打开时那个位置正好在卡片内部。
     *
     * 只量位置不够：提示条如果是隐藏的，位置照样成立。所以同时记下它是不是
     * 真的亮着、写着什么 —— 两条一起才说明"买完立刻看得见结果"。
     */
    const cardEl = document.querySelector('#panel .card');
    const toastEl = document.getElementById('toast');
    if (cardEl && toastEl) {
      const rc = cardEl.getBoundingClientRect();
      const rt = toastEl.getBoundingClientRect();
      out.t20CardBottom = Math.round(rc.bottom);
      out.t20ToastTop = Math.round(rt.top);
      out.t20ToastOn = String(toastEl.className).indexOf('on') >= 0;
      out.t20ToastText = String(toastEl.textContent);
      out.t20ToastClear = rt.top >= rc.bottom - 0.5;
    }
    out.t20CoinsAfter = stB.meta.coins;
    out.t20CoinsBefore = coinsBeforeBuy;
    out.t20PagesAfter = stB.meta.bagPages;
    out.t20PagesBefore = pagesBeforeBuy;
    out.t20CoinsDelta = coinsBeforeBuy - stB.meta.coins;

    // 点完面板会同步刷新（showPanel 的 onAction 会调 refreshPanel）：
    // 最后一行的价格必须跳到 500 —— 证明刷新读到的是新状态。
    const rowsB2 = document.querySelectorAll('#panelBody .act');
    const lastB2 = bagRowOf(rowsB2);
    out.t20RowsAfter = rowsB2.length;
    out.t20LabelAfter = lastB2
      ? (lastB2.querySelector('.t') ? lastB2.querySelector('.t').textContent : null) : null;
    const btnB2 = lastB2 ? lastB2.querySelector('button') : null;
    out.t20BtnTextAfter = btnB2 ? String(btnB2.textContent) : null;
    out.t20SubAfter = lastB2
      ? (lastB2.querySelector('.s') ? lastB2.querySelector('.s').textContent : null) : null;

    // 面板里的异常也要收：driver 的 console-message 只收 level===3，
    // 场景/渲染里抛出但没冒到 console 的错会漏掉（沿用 3e 段的 __pageErrs 口径）。
    out.t20Errs = window.__pageErrs ? window.__pageErrs.length : 0;

    hubB.panelOpen = false;
    window.EmberfieldUI.closePanel();
    await wait(150);

    // Task 21 §六：有借有还 —— 把 bagPages / coins 还原成进入本节前的值，
    // 再让面板/背包刷新一次。后面 3e（进田地）、重开、远征都读同一份
    // state.meta，不复位就是"后续段落被前面污染的副作用"。
    stB.meta.bagPages = out.t20PagesRestoreTo;
    stB.meta.coins = out.t20CoinsEntry;
    await wait(80);
    // 复位后的回读值：Node 侧断言拿它跟 entry 比。
    out.t20PagesRestored = stB.meta.bagPages;
    out.t20CoinsRestored = stB.meta.coins;
  }

  // ---- V8/V9：进关卡要渐黑，且渐黑期间连点不会进两局 ----
  /*
   * 为什么在真浏览器里验：渐黑是 Phaser 相机的行为。桩测试只能证明
   * "调了 fadeOut"，证明不了画面真的黑了 340ms 才切场景。
   *
   * 两个容易写成恒真的坑，这里刻意绕开：
   *  1. 点完立刻读 isActive('Run') 不能当"不是硬切"的证据 ——
   *     scene.start 是排队执行，硬切在同一 tick 里也不会 active。
   *     真正能区分的是 fadeEffect.isRunning，和"120ms（<340ms）时还没切"。
   *  2. 反证不能写"没抛错"。这里直接包住 hub.scene.start 数真实调用次数。
   */
  try {
    const scV = globalThis.__game.scene;
    const stV = window.EmberfieldApp.__state;
    out.v8DiagStart = {
      hubActive: scV.isActive('Hub'),
      hubPaused: scV.isPaused('Hub'),
      hubSleeping: scV.isSleeping('Hub'),
      hubStatus: scV.getScene('Hub') ? scV.getScene('Hub').sys.settings.status : null,
      hasCameras: !!(scV.getScene('Hub') && scV.getScene('Hub').cameras),
      hasMain: !!(scV.getScene('Hub') && scV.getScene('Hub').cameras &&
        scV.getScene('Hub').cameras.main),
      activeKeys: scV.getScenes(true).map(function (x) { return x.scene.key; }).join(','),
    };
    if (!scV.isActive('Hub')) {
      if (scV.isActive('Farm')) scV.stop('Farm');
      if (scV.isActive('Run')) scV.stop('Run');
      scV.start('Hub');
      await wait(400);
    }
    const hubV = scV.getScene('Hub');
    // 相机引用必须提前抓住：硬切一旦发生，Hub 被 shutdown，hubV.cameras.main
    // 就没了 —— 在 120ms 后再去取会抛 "Cannot read properties of undefined"，
    // 把"渐黑没开始"这个真正的症状淹没成一片 undefined。
    const camV = hubV.cameras.main;
    out.v9PhaseBefore = stV.phase;
    hubV.panelOpen = false;
    window.EmberfieldUI.closePanel();

    // 站到远征之门（zone id 'gate'）。按 J 在这里只打开面板，不会直接进关 ——
    // 所以"按 J 进第一个关卡"必须再加一步点面板里的按钮，这才是玩家的真实路径。
    stV.hub.x = 880; stV.hub.z = 105;
    await wait(250);
    out.v8ZoneId = (window.GameHub.zoneAt(stV) || {}).id || null;

    // keydown/keyup 之间必须隔一帧：justPressed 读的是"这一帧 down 为真"，
    // 同一 tick 里按下又抬起，update 跑到时已经是 false，键等于没按（实测）。
    key('keydown', 'KeyJ', 74);
    await wait(80);
    key('keyup', 'KeyJ', 74);
    await wait(160);
    const gateRows = document.querySelectorAll('#panelBody .act');
    out.v8PanelOpen = !!hubV.panelOpen;
    out.v8Rows = gateRows.length;
    const runBtn = gateRows.length ? gateRows[0].querySelector('button') : null;
    out.v8HasRunBtn = !!runBtn;
    out.v8RunBtnText = runBtn ? String(runBtn.textContent) : null;
    out.v8FadeBefore = camV.fadeEffect.isRunning;
    out.v8RunBefore = scV.isActive('Run');

    if (runBtn) runBtn.click();

    // 同一个 tick 里读：渐黑必须已经开始
    out.v8FadeAt0 = camV.fadeEffect.isRunning;
    out.v8RunAt0 = scV.isActive('Run');
    out.v8HubAt0 = scV.isActive('Hub');
    out.v8PanelAt0 = !!hubV.panelOpen;

    // 120ms（< 340ms）：硬切此刻早切完了；渐黑必须还没切
    await wait(120);
    out.v8FadeAt120 = camV.fadeEffect.isRunning;
    out.v8RunAt120 = scV.isActive('Run');
    out.v8HubAt120 = scV.isActive('Hub');

    // 连点反证：数 hub.scene.start('Run') 的真实调用次数。
    // 只在本段内生效，finally 里删掉自己加的那层。
    let runStartsV = 0;
    const origStartV = hubV.scene.start;
    hubV.scene.start = function (k, d) {
      if (k === 'Run') runStartsV++;
      return origStartV.call(this, k, d);
    };
    try {
      // 渐黑期间再按一次 J（玩家第二次点）：不能打开面板
      key('keydown', 'KeyJ', 74);
      await wait(80);
      key('keyup', 'KeyJ', 74);
      await wait(40);
      out.v9PanelDuringFade = !!hubV.panelOpen;
      // 再直接调一次入口（面板按钮最终都走这里）：必须被挡
      hubV.startRun('wood');
      await wait(600);
      out.v9RunStarts = runStartsV;
      out.v8RunAfter = scV.isActive('Run');
      out.v8HubAfter = scV.isActive('Hub');
      out.v9PhaseAfter = stV.phase;
      out.v9Difficulty = stV.run ? stV.run.difficultyId : null;
    } finally {
      delete hubV.scene.start;
    }

    // 回基地一次：确认渐黑没有留下"永久黑屏"（相机会不会被场景重启复位）。
    scV.stop('Run');
    scV.start('Hub');
    await wait(500);
    const hubW = scV.getScene('Hub');
    out.v8HubBack = scV.isActive('Hub');
    out.v8HubFadeAfter = hubW.cameras.main.fadeEffect.isRunning;
    out.v8HubAlpha = hubW.cameras.main.alpha;
    // 本段是"故意进去又出来"，别把世界状态留给后面的段落。
    stV.run = null;
    stV.phase = out.v9PhaseBefore;
    window.EmberfieldUI.showHud(false);
    hubW.panelOpen = false;
    window.EmberfieldUI.closePanel();
  } catch (e) {
    // 本段任何一处接线错误都记下来，让 Node 侧报根因而不是 20 条 undefined。
    out.v8Err = String((e && e.message) || e);
  }

  // ---- 面板开着时缩小窗口：先把大窗口下的矩形记下来（Task 10c）----
  // 主段结束时必须保持面板打开，driver 会在 RESULT 之后把窗口缩到 520x420，
  // 再由 RESIZESCRIPT 量一次。这里记的是反证素材：如果"缩小前有一截在 520
  // 之外"都不成立，那么"缩小后在里面"就什么也证明不了（它本来就在里面）。
  stZ.hub.x = 500;
  stZ.hub.z = 105;
  window.BagHud.open(window.EmberfieldApp.__state);
  await wait(300);
  {
    const bb = document.getElementById('bag').getBoundingClientRect();
    out.beforeShrink = {
      vw: innerWidth,
      vh: innerHeight,
      left: Math.round(bb.left),
      right: Math.round(bb.right),
      top: Math.round(bb.top),
      bottom: Math.round(bb.bottom),
      open: window.BagHud.isOpen(),
    };
  }

  return out;
})();
`;

// 第三段脚本：主段结束是面板开着的大窗口，driver 把窗口缩到 520x420 之后再调这里。
// 这里**不许**再调 open()：重开会走 placeDefault() 复位，那时量到的是"打开时复位"，
// 不是"resize 触发的重新夹边"——两者都能让面板回到视口内，断言就区分不出来了。
// 同样不许出现反引号（这本身也是模板字符串）。
const RESIZESCRIPT = `
(function () {
  var out = {};
  var el = document.getElementById('bag');
  out.vw = innerWidth;
  out.vh = innerHeight;
  out.open = window.BagHud.isOpen();
  var r = el.getBoundingClientRect();
  out.w = Math.round(r.width);
  out.h = Math.round(r.height);
  out.left = Math.round(r.left);
  out.top = Math.round(r.top);
  out.right = Math.round(r.right);
  out.bottom = Math.round(r.bottom);
  out.inside = r.left >= -0.5 && r.top >= -0.5 &&
    r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5;
  window.BagHud.close();
  return out;
})()
`;

// 第二段脚本：驱动先把窗口改成 520x420，再在这里量。#bag 一旦比视口大，
// clamp() 只能把 left/top 夹到 0，right/bottom 照样越界 —— 1100x800 下永远复现不了。
// 同样不许出现反引号（这本身也是模板字符串）。
const SMALLSCRIPT = `
(function () {
  var out = {};
  var el = document.getElementById('bag');
  out.vw = innerWidth;
  out.vh = innerHeight;
  window.BagHud.open(window.EmberfieldApp.__state);
  var box = el.getBoundingClientRect();
  out.w = Math.round(box.width);
  out.h = Math.round(box.height);
  el.style.left = '9999px';
  el.style.top = '9999px';
  window.BagHud.clamp(el);
  var r = el.getBoundingClientRect();
  out.left = Math.round(r.left);
  out.top = Math.round(r.top);
  out.right = Math.round(r.right);
  out.bottom = Math.round(r.bottom);
  out.inside = r.left >= -0.5 && r.top >= -0.5 &&
    r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5;
  var grid = document.getElementById('bag-grid');
  out.gridOverflowY = getComputedStyle(grid).overflowY;
  var cells = document.querySelectorAll('#bag .cell');
  out.cells = cells.length;
  var last = cells.length ? cells[cells.length - 1] : null;
  out.lastRowBottom = last ? Math.round(last.getBoundingClientRect().bottom) : null;
  out.gridBottom = Math.round(grid.getBoundingClientRect().bottom);
  var tabs = document.getElementById('bag-tabs');
  out.tabsFit = { scroll: tabs.scrollWidth, client: tabs.clientWidth };
  var wear = document.getElementById('bag-wear');
  out.wearH = Math.round(wear.getBoundingClientRect().height);
  var slot = document.querySelector('#bag-wear .slot');
  out.slotH = slot ? Math.round(slot.getBoundingClientRect().height) : null;
  window.BagHud.close();
  return out;
})()
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
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '', TARGET: `http://127.0.0.1:${PORT}/game/`, SCRIPT, SMALLSCRIPT, RESIZESCRIPT },
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
  const sm = buf.match(/SMALL (\{.*\})/);
  const small = sm ? JSON.parse(sm[1]) : null;
  // RESIZE 段（面板开着缩小窗口，Task 10c）。RESIZE-FAIL / RESIZE-BACK-FAIL
  // 这两行不含花括号，所以下面这个正则只会命中真正的 JSON 行。
  const rzm = buf.match(/^RESIZE (\{.*\})/m);
  const resize = rzm ? JSON.parse(rzm[1]) : null;

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

    // 脚步（Task 23 / V4 V5）：走路真的踩出声音，冲刺更密，站住一声都没有。
    ok(r.hubWalkDist > 100, '前置：900ms 走路位移足够跨过好几步', r.hubWalkDist);
    ok(r.hubStepsWalk >= 3, '基地里走 900ms 真的踩出脚步声（按位移触发，V4）',
       r.hubStepsWalk);
    ok(r.hubSprintDist > r.hubWalkDist * 1.2, '前置：按住 Shift 真的跑得更快',
       r.hubWalkDist + ' -> ' + r.hubSprintDist);
    ok(r.hubStepsSprint / r.hubSprintDist > (r.hubStepsWalk / r.hubWalkDist) * 1.1,
       '同样位移下冲刺的步数更密（V5：步距 22 < 26）',
       (r.hubStepsSprint / r.hubSprintDist).toFixed(4) + ' vs ' +
       (r.hubStepsWalk / r.hubWalkDist).toFixed(4));
    eq(r.hubStepsStill, 0, '松手站 3 秒，一声脚步都没有（V4 反证：不是定时器）');
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
  ok(r.hpAfterHeal > r.hpDamaged, '按 1 后血量回升（治疗真的回了血）',
     `${r.hpDamaged} -> ${r.hpAfterHeal}`);
  eq(r.potionAfterHeal, 1, '治疗消耗掉一瓶');
  eq(r.potionBuff, 'strength', '按 2 挂上了力量 buff');
  eq(r.potionAfterStrength, 1, '力量消耗掉一瓶');
  ok(r.potionBarVisible === true, '药水栏在战斗中可见');
  eq(r.potionBarSlots, 3, '药水栏有三个槽位（治疗/力量/护盾）');
  ok(r.potionBarHasActive === true, 'buff 生效时对应槽位有 active 标记');
  ok(typeof r.potionBarText === 'string' && r.potionBarText.indexOf('治疗') >= 0,
     '药水栏写出了药水名', r.potionBarText);

  console.log('\n--- 3d. 装备：穿上后主角分层渲染 ---');
  ok(r.heroIsContainer === true, '主角是 Container（装备分层的前提）',
     String(r.heroIsContainer));
  ok(r.heroChildCount >= 6, '主角容器含身体 + 五个装备层',
     String(r.heroChildCount));
  eq(r.torsoTexture, 'eq-torso-fullPlate', '躯干层换成了全身板甲的贴图');
  ok(r.torsoVisible === true, '躯干层可见（穿上就该显示）');
  eq(r.weaponTexture, 'eq-weapon-crystalStaff', '武器层换成了棱晶杖的贴图');
  ok(r.weaponVisible === true, '武器层可见');
  ok(r.allLayersFlipped === true, '左右镜像时每一层都跟着翻（不会人朝左剑朝右）',
     String(r.allLayersFlipped));
  ok(r.headHiddenWhenEmpty === true, '没穿的部位保持隐藏（不会残留上一件）',
     String(r.headHiddenWhenEmpty));
  ok(r.panelFoundHelmRow === true, '面板里找到了角盔那一行（不然上面的断言是空跑）',
     String(r.panelFoundHelmRow));
  eq(r.headTextureWhilePanelOpen, 'eq-head-hornHelm',
     '面板开着换装也当场换贴图（不能等关面板才变）');
  ok(r.headVisibleWhilePanelOpen === true, '面板开着换上的头盔当场可见',
     String(r.headVisibleWhilePanelOpen));

  console.log('\n--- 3d-2. 兵器架三态与页签（V14 / Task 21 部位维度）---');
  eq(r.tabLabels, '全部/头部/躯干/背部/武器/脚部/特殊', '兵器架有七个部位页签');
  ok(r.tabRowsAll === r.tabExpectedRowsAll,
     '全部页签一件不少（穿戴件两条动作，行数按状态现算）',
     r.tabRowsAll + ' vs ' + r.tabExpectedRowsAll + '，穿戴中 ' + r.tabWornCount + ' 件');
  ok(r.tabRowsHead === r.tabExpectedHead,
     '点「头部」后只剩头部件（逐件按 slot 现算，穿戴件算 2 行）',
     r.tabRowsHead + ' vs ' + r.tabExpectedHead);
  ok(r.tabHeadAllHead === true, '头部页签里每一行都是头部件（没有别的部位混进来）',
     String(r.tabHeadAllHead));
  ok(r.tabHeadSpecialCount === 2,
     '头部件里有 2 件 special（雷鸣角盔 / 雷鸣指环）—— 部位页签不排除 special',
     String(r.tabHeadSpecialCount));
  ok(r.tabHeadHasHelm === true, '角盔出现在头部页签（否则上一条是空跑）',
     String(r.tabHeadHasHelm));
  ok(typeof r.helmBtnBuy === 'string' && r.helmBtnBuy.indexOf('购买') === 0,
     '未买时按钮写"购买"（不是物品名、不是"执行"）', r.helmBtnBuy);
  ok(typeof r.helmBtnWear === 'string' && r.helmBtnWear.indexOf('穿戴') === 0,
     '买完未穿按钮写"穿戴"', r.helmBtnWear);
  ok(typeof r.helmWornBtns === 'string' && r.helmWornBtns.split('|').length === 2 &&
     r.helmWornBtns.indexOf('升级') === 0 && r.helmWornBtns.indexOf('|卸掉') > 0,
     '穿上后同一件出现两个按钮：升级 + 卸掉', r.helmWornBtns);

  console.log('\n--- 3d-3. 设施面板的贴图与铁匠铺分类页签（Task 17 / V31 V32）---');
  const t17 = r.t17 || {};
  eq(t17.anvilZone, 'anvil', '站到了铁匠铺（站错地方下面全是在量别处）');
  eq(t17.anvilTitle, '铁匠铺', '打开的是铁匠铺面板');
  eq(t17.anvilTabs, 4, '铁匠铺有 4 个页签（改前 0 个）');
  eq(t17.anvilLabels, '全部/攻击/生存/机动', '铁匠铺页签文案与顺序');
  eq(t17.anvilRows, 3, '「全部」页签仍是三条强化');
  eq(t17.anvilImg && t17.anvilImg.n, 3, '铁匠铺三行各一张图标（改前 0 张）');
  ok(t17.anvilImg && t17.anvilImg.dataUrl === true,
     '三张图标都是 data URL（不引入图片文件）');
  ok(t17.anvilImg && t17.anvilImg.natural === true,
     '三张图标真的解码成功（naturalWidth > 0，不是坏图）',
     JSON.stringify(t17.anvilImg && t17.anvilImg.nat));
  eq(t17.anvilImg && t17.anvilImg.uniq, 3, '三个强化项的图标两两不同（不是一张图贴三次）');
  ok(t17.anvilGeom && t17.anvilGeom.within === true,
     '图在行内：左缘不越行、右缘不压到文字', JSON.stringify(t17.anvilGeom));
  ok(t17.anvilActH && t17.anvilActH.every((h) => h >= 62 && h <= 74),
     '铁匠铺行高没被图撑破（改前 62）', JSON.stringify(t17.anvilActH));
  eq(t17.anvilBtnTexts, '25/30/28', '按钮仍写价格（加图标没动按钮语义）');
  eq(t17.atkRows, 1, '点「攻击」后只剩 1 行');
  eq(t17.atkImgs, 1, '点「攻击」后仍有 1 张图（不是连图一起消失）');
  eq(t17.atkRowName, '锋刃', '「攻击」页签剩下的那一行就是锋刃');
  eq(t17.atkBtn, '25', '「攻击」页签那行的按钮仍写价格');
  eq(t17.atkOn, '攻击', '点中的页签变成选中态，且只有一个');
  eq(t17.backRows, 3, '点回「全部」恢复 3 行');

  eq(t17.wearZone, 'forgewear', '站到了兵器架');
  eq(t17.stillWorn, 0, '测量前穿戴已清空（否则穿戴件多一行，35 这个数就对不上）');
  eq(t17.wearRows, 35, '兵器架 35 行');
  eq(t17.wearTabs, 7, '兵器架是 7 个部位页签（Task 21：与背包同构）');
  eq(t17.wearLabels, '全部/头部/躯干/背部/武器/脚部/特殊', '兵器架页签文案与顺序（部位维度）');
  eq(t17.wearImg && t17.wearImg.n, 35, '兵器架 35 行各一张装备贴图（改前 0 张）');
  eq(t17.wearImg && t17.wearImg.uniq, 35, '35 张贴图两两不同（PM「要贴图片」的实质）');
  ok(t17.wearImg && t17.wearImg.dataUrl === true, '兵器架贴图都是 data URL');
  ok(t17.wearImg && t17.wearImg.natural === true,
     '兵器架贴图全部解码成功（naturalWidth > 0）',
     JSON.stringify(t17.wearImg && t17.wearImg.nat));
  ok(t17.wearGeom && t17.wearGeom.within === true,
     '兵器架的图在行内：左缘不越行、右缘不压到文字', JSON.stringify(t17.wearGeom));
  ok(t17.wearActHMax - 62 <= 8 && t17.wearActHMax - t17.wearActHMin <= 2,
     '兵器架行高没被撑破（改前 62，允许 +8 且各行一致）',
     t17.wearActHMin + '~' + t17.wearActHMax + '（改前 62）');

  console.log('\n--- 3d-4b. 设施面板页签条不被裁（Task 21 复核）---');
  /*
   * 为什么单独一层
   * --------------
   * 背包面板收窄成 470px 时发生过「DOM 里有 7 个页签、屏幕上只剩 6 个」的事故
   * （Task 10c）：数量断言全绿，控件对真实鼠标不可用。设施面板比背包宽，
   * 当时的复核只写在一个临时探针里（`task-21` 报告 §5）——探针用完就删，
   * 下次改样式没有任何东西会红。
   *
   * 这里把那时量的两个量固化：容器自己有没有溢出（scrollWidth vs clientWidth），
   * 以及最后一个页签的右缘有没有伸出容器。两条都要，
   * 因为 scrollWidth 相等也可能是"外层没设 overflow、直接画到面板外面"。
   */
  const fitRows = [
    ['铁匠铺', t17.anvilTabsFit, t17.anvilTabs],
    ['兵器架', t17.wearTabsFit, t17.wearTabs],
  ];
  fitRows.forEach(function (pair) {
    const label = pair[0]; const f = pair[1]; const n = pair[2];
    ok(!!f, label + '页签条的读数存在（' + n + ' 个页签）', JSON.stringify(f));
    if (!f) return;
    ok(f.scroll <= f.client + 1,
       label + '页签一行放得下（没被 overflow 裁掉）',
       'scroll ' + f.scroll + ' vs client ' + f.client);
    ok(f.within === true,
       label + '最后一个页签的右缘在容器内（不是画到面板外面）',
       '最后右缘 ' + f.lastR + ' vs 容器右缘 ' + f.rowR + '，宽 ' + f.lastW);
    ok(f.lastW >= 24,
       label + '最后一个页签没被压成一条缝（>= 24px）', f.lastW + 'px');
  });

  console.log('\n--- 3d-4. 图标可读性：紧裁切 + 整数倍放大（Task 18）---');
  /*
   * 病：装备贴图是 40x60 的整身画布，头部装备只占其中一条横带；塞进 28x42 的
   * object-fit:contain 硬盒后按 0.7 倍缩小，画面上就是一条色带（Task 17 报告 §4）。
   * 药：先按 alpha 通道裁到内容，再整数倍放大（像素不插值），盒子改成 max 32x44。
   *
   * 读数全部来自同一帧（面板开着、图在 DOM 里），明细见 smoke 的 RESULT 里的 t18：
   * 每张图的 nw x nh、内容包围盒占比 ratio、CSS 落点 cssW x cssH。
   */
  const t18 = r.t18 || {};
  ok(t18.fitExists === true, 'SpriteLib.fitUrl 存在（裁切放大的入口）');
  // (a) 铁匠铺三张图标：改前是 28x28 的原图，content 只有 ~25x25 → 缩到 28px 宽
  ok(Array.isArray(t18.anvilRead) && t18.anvilRead.length === 3,
     '铁匠铺三张图标都取到了读数', JSON.stringify(t18.anvilRead && t18.anvilRead.length));
  ok((t18.anvilRead || []).every((x) => x.nw >= 28 && x.nh >= 28),
     '铁匠铺图标 naturalWidth 均 >= 28（没有被缩成小图）',
     JSON.stringify((t18.anvilRead || []).map((x) => x.nw + 'x' + x.nh)));
  ok((t18.anvilRead || []).every((x) => x.ratio >= 0.55),
     '铁匠铺图标里内容真的占满画面（包围盒占比 >= 0.55）',
     JSON.stringify((t18.anvilRead || []).map((x) => x.ratio)));
  ok(t18.anvilGeom && t18.anvilGeom.within === true && t18.anvilGeom.imgH >= 24,
     '铁匠铺图标在行内且高度没被压成一条线（>= 24px）',
     JSON.stringify(t18.anvilGeom));
  // (b) 兵器架 35 张：内容占比、不放大失真、盒子不越界
  eq(t18.wearKeys, 35, '兵器架 35 行的贴图都能对上装备键（否则下面的读数是在量空气）');
  ok(Array.isArray(t18.wearRead) && t18.wearRead.length === 35,
     '35 张图都有同帧读数', JSON.stringify(t18.wearRead && t18.wearRead.length));
  ok(t18.minRatio >= 0.55,
     '每张装备贴图里内容占比 >= 0.55（改前 40x60 整身画布，头部只有 0.1 上下）',
     'min ratio ' + t18.minRatio);
  ok(t18.notUpscaled === true,
     '没有一张图被浏览器拉伸放大（naturalWidth >= CSS 宽、naturalHeight >= CSS 高）');
  ok(t18.maxCssW <= 32 && t18.maxCssH <= 44,
     '图标落点不超过 CSS 盒子（max 32x44）',
     t18.maxCssW + 'x' + t18.maxCssH);
  ok(t18.wearGeom && t18.wearGeom.within === true && t18.wearGeom.imgW >= 12,
     '兵器架图标在行内且宽度不是一条色带（>= 12px）', JSON.stringify(t18.wearGeom));
  // (c) 头部装备：改前 40x60 → 高/宽 = 1.5，内容只占 0.1；裁切后接近横带比例
  eq((t18.headKeys || []).length, 6, '头部 6 件都取到了读数',
     JSON.stringify(t18.headKeys));
  ok(t18.headMaxAspect > 0 && t18.headMaxAspect < 1.5,
     '头部贴图不再顶着整身画布的 3:2 比例（高/宽 < 1.5）', String(t18.headMaxAspect));
  ok(t18.headMinNatW >= 36,
     '头部贴图放大到至少 36px 宽（改前 40x60 整图里那片内容只有 ~20px 宽）',
     String(t18.headMinNatW));
  const headRatios = (t18.headRead || []).map((x) => x.ratio);
  ok(headRatios.length === 6 && headRatios.every((x) => x >= 0.55),
     '头部贴图的内容占满画面（改前那一片内容只占整张 40x60 的一成多）',
     JSON.stringify(headRatios));
  // (d) 退化与缓存
  ok(t18.cacheIsDataUrl === true, 'fitUrl 交出 data:image/png（不引入图片文件）');
  ok(t18.cacheSame === true, '同一个 key 连调两次返回同一字符串（缓存生效）');
  ok(t18.differsFromUrl === true, 'fitUrl 的结果与 url() 不是同一张图（真的裁过了）');
  ok(t18.differsByBox === true, '盒子尺寸不同结果也不同（缓存键带盒子尺寸）');
  ok(t18.missGraceful === true,
     '纹理键不存在时不抛（要么交图、要么返回 null —— Phaser 给的是 __MISSING 占位图）',
     JSON.stringify([t18.missGraceful, t18.missErr]));
  ok(t18.nullKeyNull === true && t18.zeroBoxNull === true,
     'key 为空 / 盒子尺寸为 0 时返回 null（调用方退回整图）',
     JSON.stringify([t18.nullKeyNull, t18.zeroBoxNull]));
  // 量完必须还原：后面"点格子换装"的用例依赖 3d 段穿上的那件还在身上。
  // 这条断言守的是"测试不污染后续用例"，不是产品行为。
  // 不写死 id：改前是多少就还原成多少，测试不该赌"3d 段穿的是哪件"。
  eq(t17.restoredHead, t17.headBefore, '量完把身上那件穿回去（否则后面的替换用例全红）');
  eq(t17.restoredWorn, t17.wornBefore, '还原后身上件数与测量前一致（不多不少）');
  eq(t17.restoredBag, t17.bagBefore, '还原后背包件数与测量前一致（没有凭空多/少）');

  console.log('\n--- 3d-5. 背包取图：格子与穿戴槽也走紧裁切（Task 19）---');
  /*
   * 这一节量的是"背包里的图是不是同一件东西的紧裁切版"：
   *   - 内容占比：整身 40x60 画布上，一顶皮盔的内容只占 0.108（13px 高的一条），
   *     裁切后应当 1.000；这一条改前全红（0.043 ~ 0.170）。
   *   - 头部尺寸：改前 naturalWidth 恒为 40（整身画布宽），裁切后是 60/44/54。
   *   - 高宽比：改前恒 1.5（40x60 画布），裁切后 0.65 / 0.636 / 0.519。
   *   - 纸娃娃那层必须反着红：它继续是 40x60 —— 那是"主角本体 + 五层叠图"，
   *     裁切了就对不上场景里的角色。
   */
  const t19 = r.t19 || {};
  eq(t19.cells, 35, '背包格子仍是 35 格（换取图方式没动网格）');
  ok(typeof t19.cellW === 'number' && Math.abs(t19.cellW - 48) <= 1
     && typeof t19.cellH === 'number' && Math.abs(t19.cellH - 54.6) <= 1,
     '格子几何与改前一致（48 x 54.6，允许 +-1px）',
     JSON.stringify([t19.cellW, t19.cellH]));
  eq(t19.filled, 10, '夹具 10 件都画出了图（下面量的是 10 张真图，不是空气）');
  ok(t19.maxCssW <= 32 && t19.maxCssH <= 46,
     '格子图的 CSS 落点没越出 32x46 的盒子（CSS 不用改）',
     t19.maxCssW + 'x' + t19.maxCssH);
  ok(t19.minRatio >= 0.55,
     '每张格子图里内容都占满画面（改前 0.043~0.170：整身画布中间那一条）',
     'min ratio ' + t19.minRatio);
  eq((t19.heads || []).length, 3, '三顶头盔都量到了（按标题里的「盔」认）',
     JSON.stringify((t19.heads || []).map(function (h) { return h.title + ' ' + h.nw + 'x' + h.nh; })));
  ok(t19.headMinNatW > 40,
     '头部图的 naturalWidth 都 > 40（改前恒为 40：整身画布就那么宽）',
     String(t19.headMinNatW));
  ok(t19.headMaxAspect > 0 && t19.headMaxAspect < 1.0,
     '头部图不再是整身画布的 3:2 比例（高/宽改前恒 1.5）', String(t19.headMaxAspect));
  ok(t19.headMinRatio >= 0.55,
     '头部图的内容占满画面（改前那一片内容只占画布的一成多）', String(t19.headMinRatio));
  /*
   * 两两不同只按宽度算会**假红**：胸甲裁成 63x54、疾风靴裁成 63x27，宽度都是 63。
   * 所以主断言用 nw x nh 对（改后 10 对全不同），宽度去重数只当读数抄进报告。
   */
  eq(t19.gridDimDistinct, t19.filled,
     '10 格各自的位图尺寸两两不同（每件取的是自己那张裁切图）',
     JSON.stringify([t19.gridDimDistinct, t19.gridWidthDistinct, t19.filled]));
  eq(t19.gridSrcDistinct, t19.filled, '10 格的图两两不同（没有共用一张整身图）');
  eq(t19.slotImgs, 10, '5 个部位 x 左右两列 = 10 个穿戴槽都有图');
  ok(t19.slotNodes === 10, '穿戴槽节点仍是 10 个（换取图方式没动布局）', t19.slotNodes);
  eq(t19.slotRaw, 0, '穿戴槽里不再出现 40x60 的整身画布（改前 10 张全是 40x60）');
  ok(t19.slotMinRatio >= 0.55,
     '穿戴槽的图内容也占满画面（改前 0.043~0.158）', 'min ratio ' + t19.slotMinRatio);
  ok(t19.slotMaxW <= 40 && t19.slotMaxH <= 56,
     '穿戴槽的位图不超过盒子的 2 倍（20x28 的 @2x）',
     t19.slotMaxW + 'x' + t19.slotMaxH);
  ok(t19.slotMaxCssW <= 20 && t19.slotMaxCssH <= 28,
     '穿戴槽的 CSS 落点没越出 20x28（CSS 不用改）',
     t19.slotMaxCssW + 'x' + t19.slotMaxCssH);
  eq(t19.dollImgs, 6, '纸娃娃 = 1 张身体 + 5 层已穿戴的叠图');
  eq(t19.dollRaw, 6, '纸娃娃那 6 张仍是 40x60 整身画布（这层刻意没改，改了就和场景里的角色对不上）');
  eq(t19.restoredBag, t19.snapBag, '量完把背包还原（不污染后面的用例）');
  eq(t19.restoredEq, t19.snapEq, '量完把穿戴还原（不污染后面的用例）');

  console.log('\n--- 3d-6. 药水铺卖「背包页数+1」（Task 20）---');
  /*
   * PM 原话「在药水铺卖一个『背包页数+1』的道具」。改前药水铺只有三瓶药水，
   * 扩容只能从背包面板的 +扩容 点 —— 需求指定的那条入口是空的。
   * 这一节在真浏览器里量四件事：行出来了、文案对、按钮写"购买 · 200"、
   * 点下去 meta 真的变了（页数 +1、铜币 -200）。逻辑层由 test_game_meta 的
   * 6c 节钉，这一节钉的是"渲染 + 点击这条链真的通"。
   */
  eq(r.t20ShopZone, 'shop', '站到了商店（站错地方下面全是在量别处）');
  // Task 24 被迫改值：商店多了「开垦一块田地」，4 → 5。
  eq(r.t20Rows, 5, '商店面板 = 三瓶药水 + 一行扩容 + 一行田地（改前 3 行）');
  eq(r.t20ShopTabs, 0, '商店没有页签条（本轮刻意不加，改了这条会响）');
  eq(r.t20AllLabels, '治疗药水/力量药水/护盾药水/背包页数+1/开垦一块田地',
     '五行标签依次是三种药水 + 扩容 + 田地（扩容排在田地前面）');
  eq(r.t20LastLabel, '背包页数+1', '扩容行的标签就是需求原文那五个字');
  ok(typeof r.t20LastSub === 'string' && r.t20LastSub.indexOf('当前 1/6 页') >= 0,
     '说明行写出当前页数（1 页时）', r.t20LastSub);
  ok(typeof r.t20BtnText === 'string' && r.t20BtnText.indexOf('购买 · ') === 0,
     '按钮写「购买 · 价格」（不是纯数字、不是「执行」）', r.t20BtnText);
  eq(r.t20BtnDisabled, false, '钱够（1000 >= 200）时按钮可点');
  ok(r.t20BtnRect && r.t20BtnRect.w > 0 && r.t20BtnRect.h > 0,
     '按钮真的有可点面积（不是 0 尺寸的幽灵按钮）', JSON.stringify(r.t20BtnRect));

  // A5 第 4 条：从 UI 真的能买到
  eq(r.t20PagesBefore, 1, '点之前是 1 页（下面 +1 才有意义）');
  eq(r.t20PagesAfter, 2, '点一下扩容按钮后页数变成 2（UI 这条路真的通）');
  eq(r.t20CoinsBefore, 1000, '点之前的铜币是这个数（下面 -200 才是可核对的）');
  eq(r.t20CoinsAfter, 800, '铜币正好少 200（不多不少）');
  eq(r.t20CoinsDelta, 200, '扣款额 = pagePrices[1]');

  /*
   * 买完立刻看得见结果：提示条不能压在卡片上。
   *
   * 光量"位置对不对"不够 —— 提示条被藏起来时位置照样成立。所以先钉它
   * 真的亮着、写着动作名，再钉几何。两条一起才等于"买完能看见结果"。
   * 拆掉 #panel.on ~ #toast 那条 CSS 这条会红（实测：卡片底边 587 /
   * 提示条顶边 553，提示条钻进卡片 34px）。
   */
  eq(r.t20ToastOn, true, '买完有提示条亮着（否则下面那条是空转）');
  eq(r.t20ToastText, '已购买', '提示条写的是这次动作');
  ok(r.t20ToastClear === true,
     '提示条整个在卡片下面（不压住刚变化的那一行）',
     '卡片底边 ' + r.t20CardBottom + ' / 提示条顶边 ' + r.t20ToastTop);
  ok(typeof r.t20ToastTop === 'number' && r.t20ToastTop > 0,
     '提示条有真实位置（隐藏元素量出来是 0，上面那条就没意义）', r.t20ToastTop);

  // 点完面板同步刷新：价格跳到 500，说明读的是买完后的新状态
  // Task 24 被迫改值：4 → 5（商店多了田地那一行）。
  eq(r.t20RowsAfter, 5, '买完面板仍是 5 行（扩容行没消失、也没裂成两行）');
  eq(r.t20LabelAfter, '背包页数+1', '买完扩容行还在（按标签找到的还是它）');
  ok(typeof r.t20BtnTextAfter === 'string' && r.t20BtnTextAfter.indexOf('购买 · 500') === 0,
     '买完按钮价格跳到 500（跟着页数走）', r.t20BtnTextAfter);
  ok(typeof r.t20SubAfter === 'string' && r.t20SubAfter.indexOf('当前 2/6 页') >= 0,
     '买完说明行的当前页数变成 2', r.t20SubAfter);
  // Task 21 §六：这一段借了 state.meta 造确定状态，必须还回去。
  // 删掉复位代码这两条就会变红（已实测，见报告）。
  //
  // 注意 bagPages 的坑：进入本节时它可能**已经是** 2（前面某段买过一页），
  // 而本节买完也是 2 —— 这时"读回值 == 进入值"在没复位时也成立，断言就成了
  // 恒真。所以先钉一条"本节真的把它从 1 推到了 2"（证明这段确实动了它），
  // 复位断言才有承重。
  eq(r.t20PagesBefore, 1, '本节开始前 bagPages 被摆成 1（下面 +1 才有意义）');
  eq(r.t20PagesAfter, 2, '本节买完 bagPages 变成 2（这段确实动了这个字段）');
  // 承重条件：还原目标必须 != 买完值，否则"复位成还原目标"在没复位时也成立，
  // 就是一条恒真断言。拆掉复位代码这条必红（已实测）。
  ok(r.t20PagesRestoreTo !== r.t20PagesAfter,
     '还原目标 != 买完值（否则下面那条复位断言恒真）',
     'restoreTo=' + r.t20PagesRestoreTo + ' after=' + r.t20PagesAfter);
  eq(r.t20PagesRestored, r.t20PagesRestoreTo,
     '段末把 bagPages 复位成指定值（有借有还）',
     r.t20PagesRestored + ' vs ' + r.t20PagesRestoreTo);
  eq(r.t20CoinsRestored, r.t20CoinsEntry,
     '段末把 coins 复位成进入前的值（有借有还）',
     r.t20CoinsRestored + ' vs ' + r.t20CoinsEntry);

  console.log('\n--- V8/V9. 进关卡渐黑 + 防连点 ---');
  eq(r.v8Err, undefined, 'V8/V9 段落没有接线异常（先看这条，避免症状稀释根因）', r.v8Err);
  ok(r.v8DiagStart && r.v8DiagStart.hasMain === true, '进入本段时 Hub 相机 main 存在',
     JSON.stringify(r.v8DiagStart));
  eq(r.v8ZoneId, 'gate', '站在远征之门上（不然按 J 打不开远征面板）');
  ok(r.v8PanelOpen === true, '基地里按 J 先打开远征面板（不直接进关）',
     String(r.v8PanelOpen));
  ok(r.v8Rows >= 4, '面板列出全部难度行', r.v8Rows);
  ok(r.v8HasRunBtn === true, '第一行有可点的按钮', String(r.v8HasRunBtn));
  // 承重条件：点之前相机没有在渐黑，否则"点完开始渐黑"什么也证明不了。
  eq(r.v8FadeBefore, false, '点之前相机没有在渐黑');
  eq(r.v8RunBefore, false, '点之前不在 Run 场景里');
  eq(r.v8FadeAt0, true, '点完同一 tick 渐黑已经开始（不是硬切）');
  eq(r.v8PanelAt0, false, '点完面板立刻关掉（不盖在渐黑上）');
  eq(r.v8FadeAt120, true, '120ms 时仍在渐黑（总 340ms）');
  // 硬切会在下一个主循环就切完；渐黑在 120ms 时必须还停在 Hub。
  eq(r.v8RunAt120, false, '120ms 时还没切到 Run（硬切会在此前就切完）');
  eq(r.v8HubAt120, true, '120ms 时 Hub 还活着（过渡期间不立刻丢场景）');
  eq(r.v9PanelDuringFade, false, '渐黑期间再按 J 不会重新打开面板');
  eq(r.v9RunStarts, 1, '整段只发生一次 scene.start(Run)（连点不会进两局）', r.v9RunStarts);
  eq(r.v8RunAfter, true, '渐黑结束后 Run 已 active');
  eq(r.v8HubAfter, false, '渐黑结束后 Hub 已停');
  eq(r.v9PhaseAfter, 'run', '进入战斗后 phase 是 run');
  eq(r.v9Difficulty, 'grass', '点第一行进的就是第一档（草丛）');
  eq(r.v8HubBack, true, '能从战斗回到基地');
  // 渐黑是把相机 alpha 拉到 0 的；如果场景重启不复位 FX，基地会永久黑屏。
  eq(r.v8HubFadeAfter, false, '回基地后没有残留渐黑效果（不会永久黑屏）');
  ok(r.v8HubAlpha > 0.99, '回基地后相机 alpha 是 1（画面真的亮着）', r.v8HubAlpha);

  console.log('\n--- 3e. 按 J 进田地：不能卡在黑屏 ---');
  eq(r.fieldZoneId, 'field', '站在田地区域上（不然按 J 进不去）');
  ok(r.farmActive === true, '按 J 后农场场景真的启动了（不是停黑屏）',
     String(r.farmActive));
  ok(r.farmReady === true, '农场建好了（田块几何 + 场景对象齐全）',
     String(r.farmReady));
  ok(r.farmBusyFalse === true, '农场没有卡在 busy 状态', String(r.farmBusyFalse));
  eq(r.farmErrorsAfter, 0, '进农场过程中没有抛异常（keyboardApi 那个 TypeError）',
     JSON.stringify(r.farmErrorSample || []));
  ok(r.backToHub === true, '农场里按 ESC 能回到基地（证明没卡死）',
     String(r.backToHub));

  console.log('\n--- 3f. 农场分页：第 2 页与翻页箭头（Task 24）---');
  ok(r.pgActive === true, '分页测试真的在农场场景里（不是空跑）', String(r.pgActive));
  eq(r.pgPages, 2, '10 块地 = 2 页');
  eq(r.pgFirstIdx, 0, '第 1 页第 1 块的绝对索引是 0');
  eq(r.pgLeftVisible, false, '第 1 页没有左箭头（左边没得翻）');
  eq(r.pgRightVisible, true, '第 1 页有右箭头');
  ok(String(r.pgHud).indexOf('第 1/2 页') >= 0, 'HUD 写「第 1/2 页」', r.pgHud);
  ok(String(r.pgHud).indexOf('/ 10') >= 0,
     'HUD 的成熟田分母跟着块数走（不是写死 /9）', r.pgHud);

  // 箭头几何：44×44、贴屏幕左右缘、纵向居中、层级在田块之上 HUD 之下
  ok(typeof r.pgArrowLeftX === 'number' && r.pgArrowLeftX >= 0 && r.pgArrowLeftX <= 60,
     '左箭头贴着屏幕左缘', r.pgArrowLeftX);
  ok(typeof r.pgArrowRightX === 'number' && r.pgArrowRightX >= 900 && r.pgArrowRightX <= 960,
     '右箭头贴着屏幕右缘', r.pgArrowRightX);
  eq(r.pgArrowW, 44, '箭头宽 44');
  eq(r.pgArrowH, 44, '箭头高 44');
  ok(typeof r.pgArrowLeftY === 'number' && r.pgArrowLeftY > 250 && r.pgArrowLeftY < 350,
     '箭头纵向居中（y 约 300）', r.pgArrowLeftY);
  ok(typeof r.pgArrowDepth === 'number' && r.pgArrowDepth > 20 && r.pgArrowDepth < 900,
     '箭头层级高于作物(20)、低于 HUD(900)', r.pgArrowDepth);
  eq(r.pgArrowOverPlotsLeft, 0, '左箭头没有压在任何田块上');
  eq(r.pgArrowOverPlotsRight, 0, '右箭头没有压在任何田块上');

  // 点右箭头翻页：真的翻过去了，且第 2 页第 1 块是绝对索引 9
  eq(r.pgPageAfterClick, 1, '点右箭头翻到第 2 页');
  eq(r.pgIdx2, 9, 'V18 第 2 页第 1 块 = 绝对索引 9');
  eq(r.pgLeft2, true, '第 2 页出现左箭头');
  eq(r.pgRight2, false, '末页没有右箭头');
  ok(String(r.pgHud2).indexOf('第 2/2 页') >= 0, 'HUD 跟着翻到「第 2/2 页」', r.pgHud2);
  eq(r.pgPageAfterExtraRight, 1, '末页再点右箭头不会翻出第 3 页');

  // 点左箭头翻回去
  eq(r.pgPageAfterLeft, 0, '点左箭头回到第 1 页');
  eq(r.pgIdxBack, 0, '回到第 1 页后第 1 块又是索引 0');
  eq(r.pgLeftBack, false, '第 1 页左箭头消失');
  eq(r.pgRightBack, true, '第 1 页右箭头回来');

  // 页码持久化
  eq(r.pgPageAfterRestart, 1, '重进农场仍停在第 2 页（页码存了）');
  eq(r.pgIdxAfterRestart, 9, '重进后第 2 页第 1 块仍是绝对索引 9');

  // 箭头不能压在田块上导致误播种（对照组 + 实验组）
  eq(r.pgPageForGuard, 0, '守卫测试回到第 1 页');
  eq(r.pgCtrlSeedDelta, 1, '对照组：直接点空田真的种下了一颗种子', r.pgCtrlSeedDelta);
  eq(r.pgCtrlPlotState, 'growing', '对照组：那块田进入生长（点击通道是通的）');
  eq(r.pgGuardSeedsSame, true, '实验组：点压在空田上的箭头不播种（箭头优先）');
  eq(r.pgGuardPlotState, 'empty', '实验组：那块田仍是空的');
  eq(r.pgGuardPage, 0, '实验组：第 1 页点左箭头不翻页（没有第 0 页）');

  // V17 中间页：3 页时停在第 2 页，左右箭头都得在
  eq(r.pgMidPages, 3, '27 块地 = 3 页（中间页存在的前提）');
  eq(r.pgMidLeft, true, '中间页有左箭头');
  eq(r.pgMidRight, true, '中间页也有右箭头（首页/末页的用例盖不住这一条）');
  eq(r.pgMidPageAfterNext, 2, '中间页点右箭头翻到第 3 页');
  eq(r.pgMidRightAfterNext, false, '第 3 页（末页）右箭头消失');
  eq(r.pgMidLeftAfterNext, true, '第 3 页左箭头在');
  eq(r.pgMidPageBack, 1, '末页点左箭头翻回第 2 页');
  eq(r.pgMidBothBack, true, '翻回中间页后左右箭头又都在');

  console.log('\n--- 4. 重开（restart）---');
  ok(r.hasAgainButton === true, '存在「再来一局」（restart）入口');

  console.log('\n--- 5. 控制台错误 ---');
  ok(errors.length === 0, '页面无控制台错误', errors.slice(0, 2).join(' | '));

  console.log('\n--- 背包面板（V2 / V4）---');
  ok(r.bagExists === true, '#bag 容器存在');
  ok(r.bagApiExists === true, 'window.BagHud.open 是可调用函数（API 已接上）');
  ok(r.bagOpen === true, 'BagHud.open() 后面板处于打开态');
  ok(r.bagDisplayed === true, '面板真的显示出来了（不是只有 className）');
  ok(typeof r.bagLeft === 'number' && r.bagLeft >= 0 && r.bagLeft <= r.viewW - 40,
     '夹边后 left 在可视范围内', r.bagLeft);
  ok(typeof r.bagTop === 'number' && r.bagTop >= 0 && r.bagTop <= r.viewH - 40,
     '夹边后 top 在可视范围内', r.bagTop);
  ok(r.bagW > 0 && r.bagH > 0, '面板有真实尺寸', r.bagW + 'x' + r.bagH);
  ok(r.bagEndsWithinView === true, '面板右下角也不越界');
  ok(r.bagCells === 35, '第一页 5×7 = 35 格', r.bagCells);

  console.log('\n--- 背包交互（V3 / V12 / V13 / V26–V29）---');
  ok(r.cellWithItemFound === true, '背包里有带贴图的格子（否则悬停测试测的是空格）');
  ok(r.equipResult && r.equipResult.ok === true, '穿戴成功', JSON.stringify(r.equipResult));
  ok(typeof r.heroWeaponBefore === 'string', '能读到英雄的武器图层（探针有效）');
  ok(r.heroWeaponAfter === 'eq-weapon-twinBlades',
     '面板开着换装后英雄图层真的换成新武器', r.heroWeaponAfter);
  ok(r.heroWeaponAfter !== r.heroWeaponBefore,
     '图层确实变了，不是同一张', r.heroWeaponBefore + ' -> ' + r.heroWeaponAfter);
  ok(r.hubPanelOpenWithBag === true,
     '背包打开时 Hub.update 处于早退状态（所以上面的变化只能来自 onChange 钩子）',
     String(r.hubPanelOpenWithBag));
  ok(typeof r.dmgGainDeclared === 'number' && r.dmgGainDeclared > 0,
     '该武器声明的加成是正数', r.dmgGainDeclared);
  ok(r.dmgAfter - r.dmgBefore === r.dmgGainDeclared,
     '伤害上升幅度恰好等于武器加成（不是巧合变绿）',
     r.dmgBefore + ' + ' + r.dmgGainDeclared + ' vs ' + r.dmgAfter);
  ok(typeof r.statsTextBefore === 'string' && r.statsTextBefore.indexOf('伤害' + r.dmgBefore) >= 0,
     '左栏「当前数值」写着换装前的伤害', r.statsTextBefore);
  ok(typeof r.statsTextAfter === 'string' && r.statsTextAfter.indexOf('伤害' + r.dmgAfter) >= 0,
     '换装后左栏数值当场变了（不是等关面板）', r.statsTextAfter);
  ok(r.statsTextBefore !== r.statsTextAfter, '左栏文案确实变了，不是同一份',
     r.statsTextBefore + ' -> ' + r.statsTextAfter);
  ok(typeof r.statsTextAfter === 'string' && r.statsTextAfter.indexOf('生命上限') >= 0 &&
     r.statsTextAfter.indexOf('移速') >= 0 && r.statsTextAfter.indexOf('受伤') >= 0,
     '四项数值都在（生命上限 / 伤害 / 移速 / 受伤）', r.statsTextAfter);

  ok(r.tipVisible === true, '悬停出现物品信息', r.tipText);
  ok(typeof r.tipText === 'string' && r.tipText.indexOf('铁盔') >= 0,
     'tooltip 显示的确实是悬停那一件的名字（铁盔）', r.tipText);
  ok(r.tipText && r.tipText.length > 0, '提示里有文字（不是空框）', r.tipText);
  ok(typeof r.tipText === 'string' && r.tipText.indexOf('头部') >= 0,
     'tooltip 写出槽位（设计 §4.3 要求名称/槽位/等级/效果/售价）', r.tipText);
  ok(typeof r.tipText === 'string' && r.tipText.indexOf('售价') >= 0,
     'tooltip 写出售价', r.tipText);
  ok(r.tipHiddenAfterOut === true, '移开后浮层收起（不是一直挂在那儿）');

  ok(r.helmBought && r.helmBought.ok === true, '补进背包的那件真的买到了', JSON.stringify(r.helmBought));
  ok(r.headSlotWornBefore === true, '点之前头部槽已经穿着 3d 段买的那件（替换场景）');
  eq(r.headSlotAltBefore, '角盔', '点之前头部槽里是角盔（3d 段穿上的）');
  ok(r.headSlotWorn === true, '点格子穿上后头部槽亮起（左栏当场变）');
  eq(r.headSlotImgAlt, '铁盔', '槽位里显示的就是穿上那件的贴图');
  eq(r.headKeyAfterClick, 'eq-head-ironHelm', '英雄头部图层跟着换了（同一个 onChange）');
  ok(r.headKeyBeforeClick !== r.headKeyAfterClick, '头部图层确实变了',
     r.headKeyBeforeClick + ' -> ' + r.headKeyAfterClick);
  ok(r.statsTextAfterClick !== r.statsTextAfter, '再穿一件，数值又变了一次', r.statsTextAfterClick);
  ok(Array.isArray(r.bagIdsAfterClick) && r.bagIdsAfterClick.indexOf('hornHelm') >= 0,
     '换下来的角盔回到背包（不凭空消失）', JSON.stringify(r.bagIdsAfterClick));
  ok(r.headSlotEmptyAfterUnequip === true, '点已穿戴的槽 = 卸下（槽位回到空）');
  eq(r.heroHeadAfterUnequip, '', '卸下后英雄头部图层隐藏（不残留上一件）');
  ok(typeof r.bagCountAfterUnequip === 'string' && r.bagCountAfterUnequip.indexOf('/') > 0,
     '卸下的装备回到背包里（计数可见）', r.bagCountAfterUnequip);

  ok(r.sortBtn === true, '有「整理」按钮');
  eq(r.sortFirstBefore, '熔火战靴', '整理前第一格是按入包顺序（熔火战靴）');
  eq(r.sortFirstAfter, '战斧', '整理后特效装备排到最前（设计 §4.5 第一段）');

  ok(r.batchBtn === true, '有「批量出售」按钮');
  ok(r.batchConfirmDisabledWhenEmpty === true, '没勾选任何东西时确认按钮是禁用的');
  ok(r.pickDupsBtn === true, '有「勾选全部重复件」快捷勾选');
  ok(r.batchConfirmEnabledAfterPick === true, '勾上重复件后确认按钮可用');
  ok(typeof r.batchSumText === 'string' &&
     r.batchSumText.indexOf('2 件') >= 0 &&
     r.batchSumText.indexOf(String(r.batchExpectedTotal)) >= 0,
     '确认条写着件数与总价', r.batchSumText);
  ok(r.batchExpectedTotal !== r.batchUnitPrice * 2,
     '总价是按每件算的，不是单价 × 件数（否则这条断言区分不出错实现）',
     r.batchUnitPrice + ' x2 vs ' + r.batchExpectedTotal);
  eq(r.batchCells, 35, '选择态下格子数仍然是 35（不能多也不能少）');

  console.log('\n--- 批量条的几何：确认/取消必须真的在面板内（Task 16）---');
  // 这一段是给"手动用户"的：.click() 走的是合成点击，被裁到面板外的按钮照样
  // 能触发 click 事件，所以上面那批断言对着坏布局全绿。下面量几何与命中测试。
  ok(r.batchBarZero && r.batchBarZero.scroll <= r.batchBarZero.w + 1,
     '批量态零选：批量条内容不溢出（不被面板裁掉）', JSON.stringify(r.batchBarZero));
  ok(r.batchBarZero && r.batchBarZero.left >= r.batchBarZero.panelLeft - 0.5 &&
     r.batchBarZero.right <= r.batchBarZero.panelRight + 0.5,
     '批量态零选：批量条左右缘都在面板内', JSON.stringify(r.batchBarZero));
  ok(r.batchBarSel && r.batchBarSel.scroll <= r.batchBarSel.w + 1,
     '批量态选中 2 件：批量条内容不溢出', JSON.stringify(r.batchBarSel));
  ok(r.batchBarSel && r.batchBarSel.left >= r.batchBarSel.panelLeft - 0.5 &&
     r.batchBarSel.right <= r.batchBarSel.panelRight + 0.5,
     '批量态选中 2 件：批量条整条横在面板内', JSON.stringify(r.batchBarSel));
  ok(typeof r.batchOkRight === 'number' && r.batchOkRight <= r.batchBagRight + 0.5,
     '「确认」按钮右缘不超出面板右缘', r.batchOkRight + ' vs ' + r.batchBagRight);
  ok(typeof r.batchCancelRight === 'number' && r.batchCancelRight <= r.batchBagRight + 0.5,
     '「取消」按钮右缘不超出面板右缘', r.batchCancelRight + ' vs ' + r.batchBagRight);
  ok(r.batchOkHit === true, '「确认」按钮中心命中的是它自己（真鼠标点得到）',
     '命中: ' + String(r.batchOkHitTag));
  ok(r.batchCancelHit === true, '「取消」按钮中心命中的是它自己（真鼠标点得到）',
     '命中: ' + String(r.batchCancelHitTag));
  ok(r.batchSumBox && r.batchSumBox.right <= r.batchBarRight + 0.5,
     '合计文案整段可见（右缘不越过批量条右缘，否则「铜币」被裁）',
     JSON.stringify(r.batchSumBox) + ' barRight=' + r.batchBarRight);
  ok(typeof r.batchSumText === 'string' && r.batchSumText.indexOf('铜币') >= 0 &&
     r.batchSumText.indexOf(String(r.batchExpectedTotal)) >= 0,
     '合计文案完整：件数 + 总价 + 「铜币」都在', r.batchSumText);
  ok(r.batchPageBarDisplay === 'none',
     '批量态下分页条仍是隐藏的（两条 bar 互斥没破）', String(r.batchPageBarDisplay));
  ok(r.batchExitPageBar === 'flex' && r.batchExitBatchBar === 'none',
     '退出批量态后分页条回来、批量条收起',
     String(r.batchExitPageBar) + ' / ' + String(r.batchExitBatchBar));
  ok(r.batchLastRowInside === true,
     '批量态下第 7 行整行仍在面板内（修 bar 不许挤掉一行格子）',
     String(r.batchLastRowInside));
  ok(r.batchGridH === 394, '批量态下网格高度仍是 394px（面板总高没变）',
     String(r.batchGridH));
  console.log('  [读数] 零选 w=' + (r.batchBarZero ? r.batchBarZero.w : '-') +
    ' scroll=' + (r.batchBarZero ? r.batchBarZero.scroll : '-') +
    ' | 选中2 件 w=' + (r.batchBarSel ? r.batchBarSel.w : '-') +
    ' scroll=' + (r.batchBarSel ? r.batchBarSel.scroll : '-') +
    ' sumW=' + (r.batchSumBox ? r.batchSumBox.scroll : '-') +
    ' | okRight=' + r.batchOkRight + ' cancelRight=' + r.batchCancelRight +
    ' bagRight=' + r.batchBagRight +
    ' | okHit=' + r.batchOkHitTag + ' cancelHit=' + r.batchCancelHitTag +
    ' | gridH=' + r.batchGridH);

  ok(Array.isArray(r.bagAfterBatch) && r.bagAfterBatch.length === 2 &&
     r.bagAfterBatch.indexOf('ironHelm@3') >= 0,
     '每 id 至少留一件，且留的是等级最高的那件', JSON.stringify(r.bagAfterBatch));
  ok(typeof r.bagCountAfterBatch === 'string' && r.bagCountAfterBatch.indexOf('2') === 0,
     '卖掉两件后计数变成 2', r.bagCountAfterBatch);

  ok(r.sellCellFound === true, '右键前确实有一格可卖的装备');
  ok(r.toastOnAfterSell === true, '右键出售弹出 toast（不是静默失败）', r.toastAfterSell);
  ok(typeof r.toastAfterSell === 'string' && r.toastAfterSell.indexOf('铁盔') >= 0,
     'toast 写出卖的是哪一件', r.toastAfterSell);
  ok(typeof r.toastAfterSell === 'string' &&
     r.toastAfterSell.indexOf(String(r.sellExpectedValue)) >= 0,
     'toast 写出真实卖价（sellValue 逐件算）', r.toastAfterSell);
  eq(r.bagCountAfterSell, '0/35', '卖掉后背包空了');

  ok(r.expandBtn === true, '有「+扩容」按钮');
  ok(r.prevBtn === true && r.nextBtn === true, '有上一页 / 下一页按钮');
  ok(typeof r.pageLabelBefore === 'string' && r.pageLabelBefore.indexOf('1 / 1') >= 0,
     '一开始是第 1 / 1 页', r.pageLabelBefore);
  ok(typeof r.pageLabelAfterExpand === 'string' &&
     r.pageLabelAfterExpand.indexOf('1 / 2') >= 0,
     '扩容后变成第 1 / 2 页', r.pageLabelAfterExpand);
  eq(r.bagCountAfterExpand, '0/70', '容量按页数 × 35 算（2 页 = 70 格）');
  ok(typeof r.pageLabelOnPage2 === 'string' && r.pageLabelOnPage2.indexOf('2 / 2') >= 0,
     '翻页后是第 2 / 2 页', r.pageLabelOnPage2);
  eq(r.bagCellsOnPage2, 35, '翻到第二页格子数仍然恒为 35');

  console.log('\n--- Tab 打开背包 + 暂停（V1 / V21）---');
  ok(r.pauseClosedBefore === false, '起始态背包是关着的（否则下面测不到 Tab）');
  ok(r.pauseOpenedByTab === true, '按 Tab 打开背包');
  ok(r.pauseScenePaused === true, '背包打开时 Hub 场景真的 pause 了');
  ok(r.pauseXWhileOpen === r.pauseXBefore,
     '暂停期间按住 D 位置不变', r.pauseXBefore + ' -> ' + r.pauseXWhileOpen);
  ok(r.pauseClosedAfter === false, '再按 Tab 关闭背包');
  ok(r.pauseSceneResumed === true, '关闭后场景恢复运行（pause/resume 成对）');
  ok(r.pauseXAfterClose > r.pauseXBeforeReopen + 5,
     '关闭后同样按 D 位置真的变了（反证：上一条不是按键失效）',
     r.pauseXBeforeReopen + ' -> ' + r.pauseXAfterClose);
  ok(r.tabDefaultPrevented === true, 'Tab 的浏览器默认行为被 preventDefault 拦掉');

  console.log('\n--- 背包面板收到 470x500（Task 10b / V2）---');
  ok(Math.abs(r.ratioW - 470) <= 1, '#bag 宽度收到 470（设计初稿写 620）', r.ratioW);
  ok(Math.abs(r.ratioH - 500) <= 1, '#bag 高度收到 500（初稿写 540）', r.ratioH);
  ok(typeof r.areaRatio === 'number' && r.areaRatio >= 0.38 && r.areaRatio <= 0.43,
     '面板面积约占 960x600 画布的 40%（V2 的验收值；620x540 是 58%）', r.areaRatio);
  ok(r.lastRowInside === true, '第 7 行整行仍在面板内（网格没被裁）', String(r.lastRowInside));
  ok(typeof r.cellImgW === 'number' && r.cellImgW >= 28 && r.cellImgW <= 34,
     '格子贴图仍是 32px 宽（收窄后没被挤扁）', r.cellImgW);

  console.log('\n--- toast 必须画在背包之上（F1）---');
  ok(r.toastZ > r.bagZ, 'toast 的层级高于面板（下层的话出售反馈看不见）',
     r.toastZ + ' vs ' + r.bagZ);
  ok(r.toastHit === true, 'toast 中心点命中的是 toast 本身，不是面板',
     '命中: ' + String(r.toastHitTag));

  console.log('\n--- 夹边两角 + 页签过滤（F3 / 尺寸表）---');
  ok(r.clampSE && r.clampSE.inside === true, '推到右下角后 right/bottom 都不越界',
     JSON.stringify(r.clampSE));
  eq(r.tabButtons, 7, '七个页签都在 DOM 里');
  ['all', 'head', 'torso', 'back', 'weapon', 'feet', 'special'].forEach((t) => {
    eq(r.tabCounts ? r.tabCounts[t] : undefined, r.tabExpect ? r.tabExpect[t] : null,
       '页签「' + t + '」的可见格数 = 逻辑层 bagFilter 的长度');
  });
  ok(r.tabsFit && r.tabsFit.scroll <= r.tabsFit.client + 1,
     '七个页签一行放得下（面板收窄后没把「特殊」裁掉）', JSON.stringify(r.tabsFit));

  console.log('\n--- 勾选不许跨页签 / 跨页保留（F2）---');
  eq(r.selBeforeTabSwitch, 2, '勾上重复件后有两格是选中态');
  eq(r.selAfterTabSwitch, 0, '切到别的页签再切回来：勾选已清空');
  ok(r.confirmDisabledAfterTabSwitch === true, '确认按钮随之变灰（不能卖看不见的件）');
  eq(r.selBeforePageSwitch, 2, '翻页前重新勾了两件（探针有效）');
  ok(r.nextEnabled2 === true, '有第 2 页可翻（否则下面测不到翻页）');
  eq(r.selAfterPageSwitch, 0, '翻到第 2 页再翻回来：勾选已清空');

  console.log('\n--- 批量态标出「每 id 保留的那件」---');
  eq(r.keepCount, 1, '3 件同名里只有一件标了「保留」');
  eq(r.keepLv, 'Lv3', '标的是等级最高的那件');
  ok(r.keepTitleHasNote === true, '保留件的 title 写出了原因', String(r.keepTitleHasNote));
  ok(r.keepUid === r.keepUidExpect,
     '标的就是逻辑层 duplicateUids 保留的那一件（UI 不自己比等级）',
     String(r.keepUid) + ' vs ' + String(r.keepUidExpect));

  console.log('\n--- open() 复位页签 / 真实拖动 / 关闭清场 ---');
  eq(r.tabAfterReopen, 'all', '重新打开时页签回到「全部」');
  eq(r.barGrabbingDuringDrag, true, '拖动时标题栏是抓取光标（探针有效）');
  ok(Math.abs(r.dragDx + 120) <= 2, '真实拖动：面板横向跟手 120px', r.dragDx);
  ok(Math.abs(r.dragDy + 80) <= 2, '真实拖动：面板纵向跟手 80px', r.dragDy);
  eq(r.dragClampLeft, 0, '拖出左上角时 left 当场夹在 0');
  eq(r.dragClampTop, 0, '拖出左上角时 top 当场夹在 0');
  eq(r.barGrabbingAfterUp, false, '松手后抓取光标撤掉');
  eq(r.barGrabbingBeforeClose, true, '拖到一半时确实是抓取态（探针有效）');
  eq(r.barGrabbingAfterClose, false, '拖到一半关闭：抓取光标不留着');
  eq(r.panelLeftAfterStrayMove, true, '关闭后残留的 pointermove 不再移动面板');

  console.log('\n--- 重复 open 幂等（F4 回归）---');
  eq(r.doubleOpenPanelOpen, true, '连开两次时宿主认为面板是开着的');
  eq(r.panelOpenAfterDoubleOpen, false, '连开两次 + 关一次：宿主状态回到 false');
  ok(r.doubleOpenXAfter > r.doubleOpenXBefore + 5,
     '关掉后按 D 角色真的能走（反证：上一条不是按键失效）',
     r.doubleOpenXBefore + ' -> ' + r.doubleOpenXAfter);

  console.log('\n--- 小窗口 520x420：面板不许越界（F3）---');
  ok(!!small, '小窗口探针返回了结果');
  if (small) {
    ok(small.error === undefined, '小窗口探针没有抛异常', small.error);
    ok(small.vw <= 560 && small.vh <= 460,
       '视口真的被改小了（否则下面测的还是大窗口）', small.vw + 'x' + small.vh);
    ok(small.w <= small.vw && small.h <= small.vh,
       '面板本身不超过视口（min(…, 100vw/vh - 24px)）', small.w + 'x' + small.h);
    ok(small.inside === true, '推到右下角后 right/bottom 都在视口内',
       'left ' + small.left + ' top ' + small.top + ' / right ' + small.right +
       ' bottom ' + small.bottom + ' / 视口 ' + small.vw + 'x' + small.vh);
    eq(small.gridOverflowY, 'auto', '小窗口时网格自己滚，不再被裁（overflow:auto）');
    eq(small.cells, 35, '小窗口下格子数仍然是 35');
    ok(small.lastRowBottom !== null && small.lastRowBottom <= small.gridBottom + 0.5,
       '第 7 行没被网格切掉', small.lastRowBottom + ' vs ' + small.gridBottom);
    ok(small.tabsFit && small.tabsFit.scroll <= small.tabsFit.client + 1,
       '小窗口下七个页签也放得下', JSON.stringify(small.tabsFit));
    ok(typeof small.slotH === 'number' && small.slotH >= 26 && small.slotH <= 28,
       '装备槽没被挤扁（34x27）', small.slotH);
  }

  console.log('\n--- 面板开着时缩小窗口要重新夹边（Task 10c）---');
  ok(!!resize, '缩放探针返回了结果');
  if (resize) {
    ok(resize.error === undefined, '缩放探针没有抛异常', resize.error);
    ok(r.beforeShrink && r.beforeShrink.vw > 900,
       '缩小前确实是大窗口（否则反证没有意义）',
       r.beforeShrink ? r.beforeShrink.vw + 'x' + r.beforeShrink.vh : 'null');
    ok(r.beforeShrink && r.beforeShrink.open === true,
       '主段结束时面板是开着的（缩小的是打开中的面板）',
       r.beforeShrink ? String(r.beforeShrink.open) : 'null');
    ok(r.beforeShrink && r.beforeShrink.left > 520,
       '反证：缩小前面板确实有一截在 520 的右边之外',
       r.beforeShrink ? 'left ' + r.beforeShrink.left + ' / right ' + r.beforeShrink.right : 'null');
    ok(resize.vw <= 560 && resize.vh <= 460,
       '视口真的缩到了 520x420', resize.vw + 'x' + resize.vh);
    ok(resize.open === true, '窗口缩小时面板仍然开着（不是关了才夹边）');
    ok(resize.w <= resize.vw && resize.h <= resize.vh,
       '缩小后连面板自身的尺寸都没超过视口', resize.w + 'x' + resize.h);
    ok(resize.right <= resize.vw + 0.5 && resize.bottom <= resize.vh + 0.5,
       '缩小后右下角都在视口内（resize 真的重新夹了边）',
       'right ' + resize.right + ' bottom ' + resize.bottom +
       ' / 视口 ' + resize.vw + 'x' + resize.vh);
    ok(resize.inside === true, '缩小后整个面板矩形都在视口内',
       'left ' + resize.left + ' top ' + resize.top +
       ' / right ' + resize.right + ' bottom ' + resize.bottom);
  }

  console.log('\n--- 远征里按 Tab 也暂停（Task 9）---');
  ok(r.runSceneFound === true, '远征场景存在');
  ok(r.runAlive === true, '这一局还活着（否则 elapsed 停了也证明不了什么）');
  ok(r.runBagOpenedByTab === true, '远征里按 Tab 也能打开背包');
  ok(r.runScenePaused === true, '背包打开时 Run 场景真的 pause 了');
  ok(r.runElapsedWhilePaused === 0, '暂停期间 run.elapsed 一帧都没涨（战斗真的停住）', r.runElapsedWhilePaused);
  ok(r.runBagClosedByTab === true, '再按 Tab 关闭背包（Run）');
  ok(r.runSceneResumed === true, '关闭后 Run 场景恢复运行');
  ok(r.runElapsedAfterResume > 0, '恢复后 run.elapsed 继续往上涨（反证：上一帧数不是本来就停）', r.runElapsedAfterResume);

  console.log('\n--- 基地六点位上下错落 + 删长提示（Task 11 V16）---');
  ok(r.hubProbe && r.hubProbe.isScene === true,
     '探针确实拿到了 Hub 场景（不是查了个不存在的对象）', JSON.stringify(r.hubProbe));
  ok(r.hubProbe && r.hubProbe.hasZoneArt === true,
     'Hub 场景里有 zoneArt（下面量错落用得到）', JSON.stringify(r.hubProbe));
  eq(r.hasPromptObj, false, '地面长提示的对象整个被删掉了（不是留着不写字）');
  ok(Array.isArray(r.hubTextsWithPrompt) && r.hubTextsWithPrompt.length === 0,
     '场景里没有任何「按 J · …」长提示文案', JSON.stringify(r.hubTextsWithPrompt));
  ok(Array.isArray(r.hubTexts) && r.hubTexts.length >= 6,
     '场景里还读得到文字（证明上一条不是"全删光了"的假绿）',
     JSON.stringify(r.hubTexts));
  {
    const names = r.zoneNames || [];
    const missing = names.filter(function (n) { return (r.hubTexts || []).indexOf(n) < 0; });
    ok(names.length === 6 && missing.length === 0,
       '六个点位的名字标签都还在（只删长提示，没删过头）',
       '缺: ' + missing.join(','));
  }
  {
    const ys = r.zoneArtY || {};
    const vals = Object.keys(ys).map(function (id) { return ys[id]; });
    const distinct = vals.filter(function (v, i, a) { return a.indexOf(v) === i; });
    ok(Object.keys(ys).length === 6, '六个设施的绘制坐标都读到了', JSON.stringify(ys));
    ok(distinct.length >= 3, '六个设施不再共用一个 y（至少三档高低）', JSON.stringify(ys));
    ok(ys.field === ys.forgewear && ys.forgewear === ys.altar,
       '下排三个（田地/兵器架/祭坛）在同一档', JSON.stringify(ys));
    ok(ys.anvil === ys.shop, '上排两个（铁匠铺/杂货铺）在同一档', JSON.stringify(ys));
    ok(ys.anvil < ys.gate && ys.gate < ys.field,
       '门在中间档：上排比门高、门比下排高', JSON.stringify(ys));
    ok(ys.field - ys.anvil >= 25,
       '上下两档的落差肉眼可辨（>= 25px）', (ys.field - ys.anvil) + 'px');
    ok(r.zoneArtScale && r.zoneArtScale.anvil < r.zoneArtScale.field,
       '靠后的设施按景深略小一点（不是平铺同一尺寸）',
       JSON.stringify(r.zoneArtScale));
  }

  console.log('\n--- 名字胶囊挂在设施顶边上方，不再被角色穿头（Task 11b）---');
  {
    const zl = r.zoneLabels || {};
    const ids = Object.keys(zl);
    eq(ids.length, 6, '六个点位的胶囊与设施包围盒都量到了');
    const notAbove = ids.filter(function (id) {
      return !(zl[id].labelBottom <= zl[id].artTop + 0.5);
    });
    ok(notAbove.length === 0,
       '每颗胶囊的下边缘都在对应设施包围盒的顶边之上（文字向上长，不再压进美术）',
       JSON.stringify(notAbove.map(function (id) {
         return id + ': labelBottom ' + zl[id].labelBottom +
           ' vs artTop ' + zl[id].artTop;
       })));
    const originOk = ids.filter(function (id) { return zl[id].originY === 1; });
    eq(originOk.length, 6, '六颗胶囊的原点都是 (0.5, 1)（文字往上长，不是往下堆）');
    // 错落必须还在：胶囊跟着各自设施的 y 走，不是又被拉成一条直线。
    const tops = ids.map(function (id) { return zl[id].labelTop; });
    const distinctTops = tops.filter(function (v, i, a) { return a.indexOf(v) === i; });
    ok(distinctTops.length >= 3, '六颗胶囊仍然至少三档高低（没有退回一条直线）',
       JSON.stringify(zl));
    const hits = r.labelHeroHits || [];
    eq(hits.length, 6, '六个点位都试了一遍「角色站正前方」');
    const bad = hits.filter(function (h) { return h.missing === true || h.hit === true; });
    ok(bad.length === 0,
       '反证：角色站在每个设施正前方（z = 0）时，胶囊矩形与角色矩形都不相交',
       JSON.stringify(bad));
  }

  console.log('\n--- 头顶键帽（Task 11 V17）---');
  eq(r.farZone, null, '远离点位时判定不到任何区域');
  eq(r.farCap, false, '远离点位时头顶没有键帽');
  ok(r.farCapAlpha <= 0.01, '键帽淡出到底（不是留一层半透明）', r.farCapAlpha);
  eq(r.nearZoneId, 'anvil', '站在铁匠铺坐标（265, 122）上判定为 anvil');
  eq(r.nearCap, true, '靠近铁匠铺时头顶出现键帽');
  ok(r.nearCapAlpha > 0.95, '键帽确实淡入到不透明（150ms 动画跑完了，不是只设了 visible）',
     r.nearCapAlpha);
  ok(Array.isArray(r.nearPromptTexts) && r.nearPromptTexts.length === 0,
     '靠近时地面上也没有长提示（文案没退化成"靠近才写出来"）',
     JSON.stringify(r.nearPromptTexts));
  ok(r.capSize && r.capSize.w >= 22 && r.capSize.w <= 32 && r.capSize.h >= 20 && r.capSize.h <= 32,
     '键帽就是键帽大小（约 26x26），不是一条横幅', JSON.stringify(r.capSize));
  eq(Array.isArray(r.capText) ? r.capText.join('') : null, 'J',
     '键帽上写的就是一个 J（不是「按 J」这类长文案）');
  ok(r.capPos && r.heroPos && r.capPos.y < r.heroPos.y - 45,
     '键帽在头顶上方（明显高于角色落脚点）', JSON.stringify([r.capPos, r.heroPos]));
  ok(r.capPos && r.heroPos && r.capPos.x > r.heroPos.x + 3,
     '键帽偏在角色的右上方（不是压在正中/左边）', JSON.stringify([r.capPos, r.heroPos]));
  ok(typeof r.capDepth === 'number' && typeof r.heroDepth === 'number' && r.capDepth > r.heroDepth,
     '键帽画在角色图层之上（不会被身体挡住）', r.capDepth + ' vs ' + r.heroDepth);

  console.log('\n--- 逐个点位实测（每个设施都要能按 J）---');
  {
    const zh = r.zoneHits || [];
    const bad = zh.filter(function (h) { return h.want !== h.got; });
    const noCap = zh.filter(function (h) { return h.cap !== true; });
    eq(zh.length, 6, '六个点位都走了一遍');
    ok(bad.length === 0, '每个设施的坐标上都能判定到自己（走到跟前就能按 J）',
       JSON.stringify(bad));
    ok(noCap.length === 0, '每个设施前头顶都出现了键帽', JSON.stringify(noCap));
  }

  console.log('\n--- ESC 菜单 / 音量滑块 / 退出战斗（Task 13）---');
  // 断言的判据全部取自真浏览器读数：computed style、真实的 input 事件、
  // 真实的 scene.isPaused() 与"暂停时按 D 坐标不动"。
  eq(r.escUiExists, true, '页面暴露 ESC 菜单 API（EmberfieldUI.openEsc）');
  eq(r.escDomExists, true, '页面里有 #esc 容器');
  if (r.escUiExists && r.escDomExists) {
    // ⓪ 前置清理：这一段要求"人在基地"，而上面的段落留下了 phase='run' 的残留
    eq(r.escPhaseNorm, 'farm', '前置：清掉残留的远征，真的回到基地', r.escPhaseBefore);
    // ① 背包开着时按 ESC：只关背包，不叠第二层暂停
    eq(r.escBagWasOpen, true, '前置：背包确实开着');
    console.log('  [读数] 滑块拖到 40：meta=' + r.volMetaAfter +
      ' gain=' + r.volGainAfter + ' fill=' + r.volFillAfter +
      ' 圆钮50%=' + r.volThumbRound + ' | 菜单行=' + JSON.stringify(r.escRowLabelsHub));
    eq(r.escBagClosedFirst, true, '背包开着时按 ESC 先关背包');
    eq(r.escMenuNotOpenedOverBag, true, '这一下不会同时弹出 ESC 菜单（两层暂停会互相锁死）');
    eq(r.escHubResumedAfterBag, true, '关掉背包后场景已恢复（不是卡在暂停）');

    // ② 基地 ESC：一行「设置」，游戏停住
    eq(r.escDisplayedBefore, 'none', '未打开时 #esc 是 display:none');
    eq(r.escOpenedHub, true, '基地按 ESC 打开菜单');
    ok(r.escDisplayedHub && r.escDisplayedHub !== 'none', '#esc 真的显示了',
       r.escDisplayedHub);
    eq(r.escRowsHub, 1, '基地菜单只有一行', JSON.stringify(r.escRowLabelsHub));
    eq(JSON.stringify(r.escRowLabelsHub), JSON.stringify(['设置']),
       '基地这一行写「设置」', JSON.stringify(r.escRowLabelsHub));
    eq(r.escQuitInHub, false, '基地没有「退出战斗」行');
    eq(r.escPausedHub, true, '打开菜单时基地场景被暂停（scene.isPaused()）');
    ok(Math.abs(r.escXDeltaPaused) < 0.5, '暂停期间按 D 角色不动（暂停是真的）',
       'Δx = ' + r.escXDeltaPaused);

    // ③ 设置页：两个原生滑块 + 绿色已划段 + 圆钮 + 拖动真落地
    eq(r.escSettingsRow, true, '菜单里有「设置」行');
    ok(r.volMaster && r.volMaster.tag === 'INPUT' && r.volMaster.type === 'range',
       '总音量是原生 input[type=range]', JSON.stringify(r.volMaster));
    eq(r.volMaster && r.volMaster.min, '0', '总音量滑块最左是 0');
    eq(r.volMaster && r.volMaster.max, '100', '总音量滑块最右是 100');
    ok(r.volMusic && r.volMusic.tag === 'INPUT' && r.volMusic.type === 'range',
       '音乐音量是原生 input[type=range]', JSON.stringify(r.volMusic));
    eq(r.volMusic && r.volMusic.min, '0', '音乐滑块最左是 0');
    eq(r.volMusic && r.volMusic.max, '100', '音乐滑块最右是 100');
    eq(r.volMasterBgIsGradient, true, '轨道用渐变画"已划过的那一段"',
       r.volMasterBg);
    eq(r.volMasterBgHasGreen, true, '已划过的部分是绿色 #7fc45c', r.volMasterBg);
    eq(r.volThumbRound, true, '滑钮是圆的（::-webkit-slider-thumb border-radius:50%）',
       r.volThumbRule);
    ok(/BGM|未接入|暂无/.test(r.musicNote), '音乐滑块旁明确写了"没有 BGM / 未接入"',
       r.musicNote);
    ok(Math.abs(Number(r.volMetaAfter) - 0.4) < 0.001,
       '拖到 40 后存档里的音量是 0.4', r.volMetaAfter);
    ok(typeof r.volGainAfter === 'number' && Math.abs(r.volGainAfter - 0.4) < 0.02,
       '拖到 40 后 masterGain.gain 真的跟着变（滑块接上了音频层）', r.volGainAfter);
    eq(r.volFillAfter, '40%', '绿色填充宽度跟着滑块走（--fill = 40%）', r.volFillAfter);
    eq(r.volValueTextAfter, '40', '右端数值显示 40', r.volValueTextAfter);
    ok(Math.abs(Number(r.musicMetaAfter) - 0.7) < 0.001,
       '音乐滑块的值也存进存档（0.7）', r.musicMetaAfter);
    ok(Math.abs(r.musicGainUnaffected - r.volGainAfter) < 0.001,
       '音乐滑块不改变总音量（没有接任何声源，不能假装有声音）',
       r.musicGainUnaffected + ' vs ' + r.volGainAfter);

    // ③b 环境音滑块（Task 23 / V21）：真的接上了虫鸣，且不串到总音量
    ok(r.volAmbient && r.volAmbient.tag === 'INPUT' && r.volAmbient.type === 'range',
       '环境音是原生 input[type=range]', JSON.stringify(r.volAmbient));
    eq(r.volAmbient && r.volAmbient.min, '0', '环境音滑块最左是 0');
    eq(r.volAmbient && r.volAmbient.max, '100', '环境音滑块最右是 100');
    eq(r.volAmbientLabel, '环境音', '滑块标签写的是「环境音」', r.volAmbientLabel);
    ok(Math.abs(Number(r.ambientMetaBefore) - 0.3) < 0.001,
       '前置：默认环境音 0.3（拖动前）', r.ambientMetaBefore);
    ok(Math.abs(Number(r.ambientMetaAfter) - 0.55) < 0.001,
       '拖到 55 后存档里的环境音是 0.55', r.ambientMetaAfter);
    ok(typeof r.ambientGainAfter55 === 'number' &&
       Math.abs(r.ambientGainAfter55 - 0.55) < 0.02,
       '虫鸣增益真的跟着变（滑块接上了环境音通道，V21）', r.ambientGainAfter55);
    ok(Math.abs(r.masterAfterAmbientDrag - r.masterBeforeAmbientDrag) < 0.001,
       '拖环境音不改变总音量（两条通道互不串）',
       r.masterBeforeAmbientDrag + ' vs ' + r.masterAfterAmbientDrag);
    eq(r.volAmbientValueText, '55', '环境音右端数值显示 55', r.volAmbientValueText);
    ok(typeof r.ambientGainAtZero === 'number' && Math.abs(r.ambientGainAtZero) < 0.001,
       '环境音拖到 0 时虫鸣增益真的归零', r.ambientGainAtZero);
    ok(typeof r.masterAtAmbientZero === 'number' && r.masterAtAmbientZero > 0.001,
       '虫鸣归零时总音量照常（两条通道独立，不是一起静音）', r.masterAtAmbientZero);
    console.log('  [读数·环境音] 存档 ' + r.ambientMetaBefore + ' -> ' + r.ambientMetaAfter +
      ' 虫鸣增益 ' + r.ambientGainAfter55 +
      ' 总音量 ' + r.masterBeforeAmbientDrag + ' -> ' + r.masterAfterAmbientDrag);

    // ④ 设置页里按 ESC 先退一层：菜单还在、设置页收起、场景仍暂停
    eq(r.escFromSettingsStillOpen, true, '设置页里按 ESC 只退回菜单页（不直接关）');
    eq(r.escSettingsDisplayAfterEsc, 'none', '退回后设置页收起来了');
    eq(r.escPausedAfterEscBack, true, '退回菜单页时场景仍在暂停');
    // 再按一次：关掉并恢复
    eq(r.escClosedAgain, true, '再按 ESC 关掉菜单');
    eq(r.escDisplayedAfterClose, 'none', '关掉后 #esc 回到 display:none');
    eq(r.escPausedAfterClose, false, '关掉菜单后场景恢复（isPaused() = false）');
    ok(r.escXDeltaResumed > 1, '恢复后按 D 角色真的动了（不是冻住的）',
       'Δx = ' + r.escXDeltaResumed);

    // ⑤ 战斗中两行 + 主动退出结算
    eq(r.escRunFound, true, '前置：进入了 Run 场景');
    eq(r.ambientNameInRun, null,
       '进入关卡后环境音停了（V20：虫鸣只在营地，不是调成 0）');
    eq(r.escOpenedRun, true, '战斗中按 ESC 打开菜单');
    eq(r.escRowsRun, 2, '战斗中菜单两行', JSON.stringify(r.escRowLabelsRun));
    eq(JSON.stringify(r.escRowLabelsRun), JSON.stringify(['设置', '退出战斗']),
       '两行依次是「设置」「退出战斗」', JSON.stringify(r.escRowLabelsRun));
    eq(r.escQuitInRun, true, '战斗中有「退出战斗」行（data-act=quit）');
    eq(r.escPausedRun, true, '战斗中打开菜单会把 Run 场景暂停');
    ok(Math.abs(r.escElapsedWhilePaused) < 0.001,
       '暂停期间战斗计时一秒都没走（update 真停了）', r.escElapsedWhilePaused);
    eq(r.escPhaseAfterQuit, 'result', '退出后进入结算阶段，不是直接回基地');
    eq(r.escRunClearedAfterQuit, true, '退出后这一局被清空（不能二次结算）');
    eq(r.escResultTitle, '主动退出', '结算标题区分「主动退出」与「倒下了」', r.escResultTitle);
    ok(r.escResultBody.indexOf('主动退出') >= 0 &&
       /保留\s*50%/.test(r.escResultBody),
       '结算卡写明主动退出与保留比例', r.escResultBody.slice(0, 160));
    eq(r.escResultExited, true, '结算结果带 exited 标记');
    eq(r.escResultCoins, 500, '满血退出：1000 铜币保留 50%', r.escResultCoins);
    eq(r.escResultSeeds, 100, '满血退出：200 种子保留 50%', r.escResultSeeds);
    ok(Math.abs(r.escResultKeep - 0.5) < 1e-9, '满血保留率是 0.5', r.escResultKeep);
    eq(r.escPanelOpen, true, '结算卡真的弹出来了（复用 showResult）');
    eq(r.escDupOk, false, '连点第二次退出被拒绝（ok = false）');
    eq(r.escDupCoinsDelta, 0, '连点第二次一分钱都不发（反刷）');
    eq(r.escPhaseBackHub, 'farm', '点「回基地」后回到基地');
    eq(r.escBagReopened, true, '收尾：背包已重新打开（后续 resize 段的前置状态）');
  }

  console.log('\n--- 音效层：真浏览器里的 AudioContext（Task 12）---');
  // 这一段的判据全部来自真浏览器读数。桩测试（tests/test_audio.js）里
  // currentTime 是手动 tick 的、state 是自己写的字符串，两者都证明不了
  // "这台机器上音频时钟真的在跑"。这里读的是 Electron 里的真 AudioContext。
  ok(r.audioExists === true, '音效层已加载（window.GameAudio 存在且可调用 play）');
  if (r.audioExists) {
    eq(r.audioSfxCount, 21, '配置里有 21 个音效（Task 23：+脚步 3、+胜利，death 改名 defeat）');
    eq(r.audioCtxBeforeGesture, true,
       '手势之前没有建 AudioContext（惰性创建，页面加载不白占一个音频设备）');
    // ensureStarted 就是页面手势监听里调的那个函数。
    eq(r.audioState0, 'running', '触发启动路径之后 AudioContext 是 running');
    ok(r.audioSameCtx === true, '全程是同一个 AudioContext（没有被悄悄关掉重建）');
    ok(typeof r.audioTime0 === 'number' && typeof r.audioTime1 === 'number' &&
       r.audioTime1 > r.audioTime0 + 0.15,
       'currentTime 在真的往前走（音频时钟在跑，不是挂起的空壳）',
       r.audioTime0 + ' -> ' + r.audioTime1);
    ok(r.audioSampleRate >= 8000, 'sampleRate 是真实设备的采样率', r.audioSampleRate);

    {
      const names = r.audioSfxNames || [];
      const unplayable = names.filter(function (n) { return r.audioPlayed[n] !== true; });
      eq(unplayable.length, 0, '21 个音效在真浏览器里逐个播放都返回 true',
         unplayable.join(','));
      ok(r.audioPlayThrew === null, '没有任何音效抛异常', r.audioPlayThrew);
    }

    ok(typeof r.audioMaster === 'number' && r.audioMaster > 0.01,
       '默认总音量不是 0', r.audioMaster);
    ok(typeof r.audioMasterMuted === 'number' && r.audioMasterMuted <= 0.001,
       'setMasterVolume(0) 之后 masterGain.gain 真的归零（不是只翻了某个标志位）',
       r.audioMasterMuted);
    eq(r.audioClosedAfterMute, false, '静音没有 close 掉 context（关了就再也读不回来）');
    ok(typeof r.audioTimeMuted === 'number' && r.audioTimeMuted > r.audioTime1,
       '静音期间音频时钟继续走（静音 ≠ 停掉音频）',
       r.audioTime1 + ' -> ' + r.audioTimeMuted);
    eq(r.audioPlayWhileMuted, true, '静音状态下 play 仍然返回 true');
    ok(Math.abs(r.audioMasterRestored - 0.5) < 0.02,
       '把音量调回 0.5 后 masterGain.gain 跟随', r.audioMasterRestored);
    eq(r.audioStateEnd, 'running', '探针结束时 context 仍是 running');

    // 环境音（Task 23 / V19）：HubScene 一进基地就要求 crickets，起播后要挂上自己的增益。
    eq(r.ambientNameHub, 'cricket', '基地里 ambientName() 报 cricket（V19）');
    eq(r.ambientHasGain, true, '环境音真的挂了一条增益（不是只在存档里记个名字）');
    ok(typeof r.ambientGainValue === 'number' && Math.abs(r.ambientGainValue - 0.3) < 0.02,
       '环境音默认增益就是 0.30（与 meta.settings.ambient 一致）', r.ambientGainValue);

    {
      const th = r.audioThrottle || [];
      eq(th.length, 3, '同帧连打三次，三次都有返回');
      eq(th[0], true, '第一次允许播放');
      eq(th[1], false, '同帧第二次被 25ms 节流吃掉（否则三份波形叠在一起爆音）');
      eq(th[2], false, '同帧第三次同样被吃掉');
    }

    // 读数集中打印一行：报告里的"真浏览器读数"直接抄这一行，
    // 而不是回头去猜实现里写了什么。
    console.log('  [读数] state=' + r.audioState0 +
      ' currentTime=' + (typeof r.audioTime0 === 'number' ? r.audioTime0.toFixed(3) : r.audioTime0) +
      '->' + (typeof r.audioTime1 === 'number' ? r.audioTime1.toFixed(3) : r.audioTime1) +
      ' sampleRate=' + r.audioSampleRate +
      ' gain=' + r.audioMaster + '->' + r.audioMasterMuted +
      '->' + r.audioMasterRestored +
      ' 节流=' + JSON.stringify(r.audioThrottle) +
      ' 局内计数=' + JSON.stringify(r.audioCalls));

    // 脚步/环境音的读数单独一行：报告里的"真浏览器读数"直接抄它。
    console.log('  [读数·脚步] 走 ' + (r.hubWalkDist * 100 | 0) / 100 + 'px / ' +
      r.hubStepsWalk + ' 步（' + (r.hubStepsWalk / r.hubWalkDist).toFixed(4) + ' 步/px）' +
      ' 跑 ' + (r.hubSprintDist * 100 | 0) / 100 + 'px / ' + r.hubStepsSprint + ' 步（' +
      (r.hubStepsSprint / r.hubSprintDist).toFixed(4) + ' 步/px）' +
      ' 站 3 秒 ' + r.hubStepsStill + ' 步' +
      ' ambient=' + r.ambientNameHub + '@' + r.ambientGainValue +
      ' 局内=' + r.ambientNameInRun);

    // 接线：这些计数来自"游戏里按键"，不是测试直接喊 play。
    const calls = r.audioCalls || {};
    ok((calls.slash || 0) >= 1,
       '在 Run 场景按 J 挥击会触发 slash（触发点真的接上了）', JSON.stringify(calls));
    ok((calls.bagOpen || 0) >= 1,
       '按 Tab 开背包会触发 bagOpen', JSON.stringify(calls));
    ok((calls.potion || 0) >= 1,
       '按 1 喝药会触发 potion', JSON.stringify(calls));
    ok(r.audioSlashDelta >= 1,
       '四连挥击里至少响过一次 slash（不是只在首帧响）', r.audioSlashDelta);
  }

  console.log('\n' + '='.repeat(56));
  if (fail === 0) {
    console.log(`全部通过：${pass} 项断言`);
    process.exit(0);
  }
  console.log(`失败 ${fail} 项，通过 ${pass} 项`);
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
})();
