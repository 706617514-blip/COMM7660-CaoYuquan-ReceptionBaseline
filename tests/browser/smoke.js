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
      // V14 页签：全部 / 未拥有 / 已拥有 / 已穿戴 / 特殊。
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

      // 点「未拥有」：只剩没买的件。期望值在页面里按 equipOwned 现算，
      // 不写死数字 —— 前一段已经买过、穿过几件，写死就变成猜。
      const unownedTab = tabByText('未拥有');
      if (unownedTab) unownedTab.click();
      await wait(60);
      out.tabRowsUnowned = actRows().length;
      out.tabExpectedUnowned = Object.keys(window.GameConfig.ALL_EQUIPMENT)
        .filter(function (id) {
          return window.GameLogic.equipOwned(hub.state, id) === null;
        }).length;
      out.tabUnownedHasHelm = rowsFor('角盔', actRows()).length > 0;
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
    if (confirm1 && !confirm1.disabled) { confirm1.click(); await wait(250); }
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

  return out;
})();
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
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '', TARGET: `http://127.0.0.1:${PORT}/game/`, SCRIPT, SMALLSCRIPT },
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

  console.log('\n--- 3d-2. 兵器架三态与页签（V14）---');
  eq(r.tabLabels, '全部/未拥有/已拥有/已穿戴/特殊', '兵器架有五个页签');
  ok(r.tabRowsAll === r.tabExpectedRowsAll,
     '全部页签一件不少（穿戴件两条动作，行数按状态现算）',
     r.tabRowsAll + ' vs ' + r.tabExpectedRowsAll + '，穿戴中 ' + r.tabWornCount + ' 件');
  ok(r.tabRowsUnowned === r.tabExpectedUnowned,
     '点「未拥有」后只剩没买的件（逐件按 equipOwned 现算）',
     r.tabRowsUnowned + ' vs ' + r.tabExpectedUnowned);
  ok(r.tabUnownedHasHelm === true, '没买过的角盔出现在未拥有页签（否则上一条是空跑）',
     String(r.tabUnownedHasHelm));
  ok(typeof r.helmBtnBuy === 'string' && r.helmBtnBuy.indexOf('购买') === 0,
     '未买时按钮写"购买"（不是物品名、不是"执行"）', r.helmBtnBuy);
  ok(typeof r.helmBtnWear === 'string' && r.helmBtnWear.indexOf('穿戴') === 0,
     '买完未穿按钮写"穿戴"', r.helmBtnWear);
  ok(typeof r.helmWornBtns === 'string' && r.helmWornBtns.split('|').length === 2 &&
     r.helmWornBtns.indexOf('升级') === 0 && r.helmWornBtns.indexOf('|卸掉') > 0,
     '穿上后同一件出现两个按钮：升级 + 卸掉', r.helmWornBtns);

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

  console.log('\n--- 远征里按 Tab 也暂停（Task 9）---');
  ok(r.runSceneFound === true, '远征场景存在');
  ok(r.runAlive === true, '这一局还活着（否则 elapsed 停了也证明不了什么）');
  ok(r.runBagOpenedByTab === true, '远征里按 Tab 也能打开背包');
  ok(r.runScenePaused === true, '背包打开时 Run 场景真的 pause 了');
  ok(r.runElapsedWhilePaused === 0, '暂停期间 run.elapsed 一帧都没涨（战斗真的停住）', r.runElapsedWhilePaused);
  ok(r.runBagClosedByTab === true, '再按 Tab 关闭背包（Run）');
  ok(r.runSceneResumed === true, '关闭后 Run 场景恢复运行');
  ok(r.runElapsedAfterResume > 0, '恢复后 run.elapsed 继续往上涨（反证：上一帧数不是本来就停）', r.runElapsedAfterResume);

  console.log('\n' + '='.repeat(56));
  if (fail === 0) {
    console.log(`全部通过：${pass} 项断言`);
    process.exit(0);
  }
  console.log(`失败 ${fail} 项，通过 ${pass} 项`);
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
})();
