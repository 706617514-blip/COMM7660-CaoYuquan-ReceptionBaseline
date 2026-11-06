/**
 * app.js — Phaser 3 应用层：基地场景、远征场景、美术与输入。
 *
 * 架构边界（重要）
 * ---------------
 * 引擎只管三件事：**画、收键、放特效**。
 * 所有规则仍在 game/logic.js 与 game/hub.js 里，场景每帧只是
 * 「收集输入 → 调 logic.step → 按 state 摆放图形」。
 *
 * 这样做有两个好处：
 *   1. 测试（169 项断言）验证的就是玩家实际跑的那套规则，不会出现"测的和玩的是两套"；
 *   2. 换引擎或改画面不需要重写玩法，反之亦然。
 *
 * 美术全部在运行时用 Graphics 生成纹理，不依赖任何图片文件——
 * 于是部署不需要额外资源，也不会有 404。
 */
(function (global) {
  'use strict';

  const C = global.GameConfig;
  const L = global.GameLogic;
  const H = global.GameHub;
  const P = global.GameProfile;

  const W = 960, HGT = 600;
  const GROUND_Y = C.GROUND_Y;
  const Z_TO_Y = 0.60;
  const Z_SCALE = 0.18;
  const HERO_SCALE = 1.18;   // 角色在 960x600 里偏小，整体放大一点
  const ENEMY_SCALE = 1.18;

  // 当前对局状态。用模块级变量而不是 registry：
  // Phaser 会在 new Game() 之后立刻启动首个场景，registry 可能还没被赋值，
  // 从而出现 state === undefined 的竞态。
  let CURRENT_STATE = null;

  const toScreen = (x, z, h) => ({
    sx: x,
    sy: GROUND_Y - z * Z_TO_Y - h,
    sc: 1 - (z / C.FIELD_D) * Z_SCALE,
  });

  // ================================================================ 纹理
  function buildTextures(scene) {
    const g = scene.add.graphics();

    // 主角：斗篷 + 头 + 剑
    g.clear();
    g.fillStyle(0x2f4a63, 1); g.fillRoundedRect(6, 22, 28, 32, 6);      // 身体
    g.fillStyle(0x6fb1e0, 1); g.fillRoundedRect(9, 18, 20, 22, 5);      // 胸甲
    g.fillStyle(0xf0d3b0, 1); g.fillCircle(20, 12, 10);                 // 头
    g.fillStyle(0x1b2635, 1); g.fillRoundedRect(11, 3, 18, 8, 4);       // 兜帽
    g.fillStyle(0xd8e2ec, 1); g.fillRect(30, 16, 4, 26);                // 剑身
    g.fillStyle(0x8a6b2f, 1); g.fillRect(28, 40, 8, 4);                 // 护手
    g.generateTexture('hero', 40, 58);

    // 爬虫：圆胖团子
    g.clear();
    g.fillStyle(0x3b5a2a, 1); g.fillEllipse(22, 30, 44, 34);
    g.fillStyle(0x7ba05b, 1); g.fillEllipse(22, 26, 40, 30);
    g.fillStyle(0x20301c, 1); g.fillCircle(15, 22, 3.4); g.fillCircle(29, 22, 3.4);
    g.fillStyle(0xffffff, 0.85); g.fillCircle(16.4, 20.8, 1.2); g.fillCircle(30.4, 20.8, 1.2);
    g.generateTexture('crawler', 44, 44);

    // 冲刺虫：带尖角的三角
    g.clear();
    g.fillStyle(0x6b2f1c, 1); g.fillTriangle(22, 2, 44, 40, 0, 40);
    g.fillStyle(0xb8543a, 1); g.fillTriangle(22, 8, 39, 38, 5, 38);
    g.fillStyle(0xffd9a0, 1); g.fillCircle(17, 26, 3); g.fillCircle(27, 26, 3);
    g.generateTexture('runner', 44, 42);

    // 影子
    g.clear();
    g.fillStyle(0x000000, 1); g.fillEllipse(24, 8, 48, 16);
    g.generateTexture('shadow', 48, 16);

    // 树木（基地背景用）
    g.clear();
    g.fillStyle(0x1d2a20, 1); g.fillTriangle(30, 0, 60, 60, 0, 60);
    g.fillTriangle(30, 18, 64, 84, -4, 84);
    g.fillStyle(0x243528, 1); g.fillRect(26, 60, 8, 34);
    g.generateTexture('tree', 60, 96);

    // 铁砧
    g.clear();
    g.fillStyle(0x2e3640, 1); g.fillRect(12, 34, 26, 10);
    g.fillStyle(0x59636f, 1); g.fillRoundedRect(4, 18, 42, 16, 3);
    g.fillStyle(0x59636f, 1); g.fillTriangle(46, 20, 58, 26, 46, 30);
    g.fillStyle(0x3d4650, 1); g.fillRect(20, 44, 10, 12);
    g.generateTexture('anvil', 60, 58);

    // 祭坛：石座 + 浮空符文
    g.clear();
    g.fillStyle(0x3a3350, 1); g.fillRoundedRect(10, 30, 44, 22, 4);
    g.fillStyle(0x504a70, 1); g.fillRoundedRect(16, 20, 32, 14, 3);
    g.fillStyle(0xc9a6ff, 1); g.fillCircle(32, 12, 7);
    g.fillStyle(0xffffff, 0.8); g.fillCircle(32, 12, 3);
    g.generateTexture('altar', 64, 54);

    // 远征文门
    g.clear();
    g.fillStyle(0x2a2f3a, 1); g.fillRect(4, 10, 12, 76);
    g.fillRect(60, 10, 12, 76);
    g.fillStyle(0x2a2f3a, 1); g.fillRect(4, 4, 68, 12);
    g.fillStyle(0xff8a4c, 0.55); g.fillRect(16, 14, 44, 72);
    g.fillStyle(0xffd0a0, 0.35); g.fillRect(22, 20, 32, 60);
    g.generateTexture('gate', 76, 88);

    // 田地：一块土
    g.clear();
    g.fillStyle(0x3a2e22, 1); g.fillRoundedRect(0, 0, 52, 34, 5);
    g.fillStyle(0x2b2119, 1);
    for (let i = 0; i < 3; i++) g.fillRect(6, 7 + i * 9, 40, 3);
    g.generateTexture('soil', 52, 34);

    // 幼苗 / 成熟作物
    g.clear();
    g.fillStyle(0x6fbf4a, 1); g.fillRect(4, 8, 3, 12); g.fillRect(10, 5, 3, 15);
    g.fillStyle(0x3f7a2a, 1); g.fillRect(7, 14, 3, 6);
    g.generateTexture('sprout', 18, 20);

    g.clear();
    g.fillStyle(0xc9a227, 1); g.fillRect(4, 4, 4, 20);
    g.fillStyle(0xe8c14b, 1);
    g.fillTriangle(8, 4, 20, 10, 8, 16);
    g.fillTriangle(8, 12, 18, 18, 8, 24);
    g.generateTexture('crop', 24, 26);

    g.destroy();
  }

  // ================================================================ 输入
  function readKeys(scene) {
    const k = scene.input.keyboard.addKeys({
      up: 'W', down: 'S', left: 'A', right: 'D',
      jump: 'SPACE', attack: 'J',
      whirl: 'U', blink: 'I', slam: 'O', cry: 'K', nova: 'L',
      confirm: 'J', esc: 'ESC',
    });
    const read = () => ({
      up: !!k.up.isDown, down: !!k.down.isDown,
      left: !!k.left.isDown, right: !!k.right.isDown,
      jump: !!k.jump.isDown, attack: !!k.attack.isDown,
      whirl: !!k.whirl.isDown, blink: !!k.blink.isDown,
      slam: !!k.slam.isDown, cry: !!k.cry.isDown, nova: !!k.nova.isDown,
    });
    return { keys: k, read: read };
  }

  // ================================================================ 背景
  function paintBackdrop(scene, mode) {
    const g = scene.add.graphics().setDepth(-1000);

    // 天空
    for (let i = 0; i < 40; i++) {
      const t = i / 39;
      const col = mode === 'hub'
        ? Phaser.Display.Color.Interpolate.ColorWithColor(
            new Phaser.Display.Color(24, 34, 44), new Phaser.Display.Color(52, 68, 78), 39, i)
        : Phaser.Display.Color.Interpolate.ColorWithColor(
            new Phaser.Display.Color(22, 18, 26), new Phaser.Display.Color(58, 40, 34), 39, i);
      g.fillStyle(Phaser.Display.Color.GetColor(col.r, col.g, col.b), 1);
      g.fillRect(0, t * GROUND_Y, W, GROUND_Y / 39 + 1);
    }

    // 远景树
    for (let i = 0; i < 11; i++) {
      scene.add.image(60 + i * 88, GROUND_Y - 148, 'tree')
        .setOrigin(0.5, 1).setScale(1.15).setAlpha(0.28).setDepth(-900);
    }

    // 景深带：必须一直铺到画布底部。
    // 早期只铺到 GROUND_Y+100，结果画布下方约 1/3 是空的，看起来像画错了。
    const zFar = GROUND_Y - C.FIELD_D * Z_TO_Y;
    g.fillStyle(mode === 'hub' ? 0x2b3a2c : 0x2a2320, 1);
    g.fillRect(0, zFar, W, HGT - zFar);
    g.fillStyle(mode === 'hub' ? 0x35472f : 0x3a2f28, 1);
    g.fillRect(0, zFar + 46, W, HGT - zFar - 46);

    // 前景压暗，把视线收在景深带里
    // 底部只做很轻的压暗：早期用了 0.35 的纯黑，整条看起来像"没画完的空白"
    const fg = scene.add.graphics().setDepth(5000);
    for (let i = 0; i < 10; i++) {
      fg.fillStyle(0x000000, 0.018 * (i + 1));
      fg.fillRect(0, GROUND_Y + 40 + i * 8, W, 8);
    }

    // 草丛点缀（固定位置，不用随机，保证每次打开一致）
    const tuft = scene.add.graphics().setDepth(-800);
    for (let i = 0; i < 46; i++) {
      const tx = 14 + (i * 137) % (W - 20);
      const tz = (i * 61) % C.FIELD_D;
      const ty = GROUND_Y - tz * Z_TO_Y + 6;
      tuft.fillStyle(mode === 'hub' ? 0x466b3c : 0x4a3b2e, 0.75);
      tuft.fillRect(tx, ty, 2, 5);
      tuft.fillRect(tx + 3, ty - 2, 2, 7);
      tuft.fillRect(tx - 3, ty - 1, 2, 6);
    }

    g.lineStyle(2, 0xffffff, 0.16);
    g.beginPath(); g.moveTo(0, zFar); g.lineTo(W, zFar); g.strokePath();
    g.lineStyle(1, 0xffffff, 0.07);
    for (let i = 1; i <= 4; i++) {
      const y = zFar + (GROUND_Y - zFar) * (i / 5);
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.strokePath();
    }
    return g;
  }

  // ================================================================ 基地
  class HubScene extends Phaser.Scene {
    constructor() { super('Hub'); }

    create() {
      this.state = CURRENT_STATE;
      this.keyboardApi = readKeys(this);
      this.panelOpen = false;

      paintBackdrop(this, 'hub');

      // 区域美术
      this.zoneArt = {};
      H.ZONES.forEach((z) => {
        const y = GROUND_Y - (H.HUB_D / 2) * Z_TO_Y;
        let img;
        if (z.art === 'field') {
          img = this.add.container(z.x, y);
          for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 2; j++) {
              img.add(this.add.image(-46 + i * 46, -j * 26, 'soil').setScale(0.92));
            }
          }
        } else if (z.art === 'anvil') {
          img = this.add.image(z.x, y, 'anvil');
        } else if (z.art === 'altar') {
          img = this.add.image(z.x, y, 'altar');
        } else {
          img = this.add.image(z.x, y, 'gate');
        }
        img.setDepth(10);
        this.zoneArt[z.id] = img;
        this.add.text(z.x, y + 16, z.name, {
          fontSize: '13px', color: '#cfdae6', fontFamily: 'sans-serif',
        }).setOrigin(0.5, 0).setDepth(20);
      });

      // 场景里同步显示农田状态
      this.plotSprites = [];
      this.refreshPlots();

      this.shadow = this.add.image(0, 0, 'shadow').setScale(0.8).setDepth(1);
      this.hero = this.add.image(0, 0, 'hero').setDepth(100);
      this.prompt = this.add.text(0, 0, '', {
        fontSize: '14px', color: '#ffe07a', backgroundColor: '#00000088',
        padding: { x: 8, y: 4 }, fontFamily: 'sans-serif',
      }).setOrigin(0.5, 1).setDepth(500).setVisible(false);

      this.cameras.main.setBackgroundColor('#141a22');
      this.events.on('wake', () => { this.panelOpen = false; this.refreshPlots(); });
      // 调试钩子：无头探针需要能驱动场景（见 /tmp/probe.js）
      global.EmberfieldApp.__scene = this;
      global.EmberfieldApp.__state = this.state;
    }

    refreshPlots() {
      this.plotSprites.forEach((s) => s.destroy());
      this.plotSprites = [];
      const field = H.ZONES.find((z) => z.id === 'field');
      const y = GROUND_Y - (H.HUB_D / 2) * Z_TO_Y;
      this.state.farm.plots.forEach((plot, i) => {
        if (plot.state === 'empty') return;
        const col = i % 3, row = Math.floor(i / 3);
        const x = field.x - 46 + col * 46;
        const py = y - row * 26 - 6;
        const key = plot.state === 'mature' ? 'crop' : 'sprout';
        const img = this.add.image(x, py, key).setDepth(15).setOrigin(0.5, 1);
        if (plot.state === 'mature') {
          this.tweens.add({ targets: img, scaleX: 1.12, scaleY: 0.94,
            duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
        }
        this.plotSprites.push(img);
      });
    }

    showPanel(zone) {
      this.panelOpen = true;
      global.EmberfieldUI.openPanel(zone, this.state, () => {
        this.panelOpen = false;
        this.refreshPlots();
      }, (action) => {
        // 「出发」不是状态变更动作，由场景接管，不能交给 hub.perform
        if (action.kind === 'run') {
          global.EmberfieldUI.closePanel();
          this.panelOpen = false;
          this.startRun(action.payload.difficultyId);
          return;
        }
        const r = H.perform(this.state, action);
        const isPlant = action.kind === 'plant' || action.kind === 'plant-all';
        global.EmberfieldUI.refreshPanel(zone, this.state);
        this.refreshPlots();
        global.EmberfieldUI.save(this.state);
        global.EmberfieldUI.toast(r.ok ? (isPlant ? '已播种' : '已购买') : (r.reason || '无法执行'),
                                  r.ok);
      });
    }

    startRun(difficultyId) {
      L.startRun(this.state, difficultyId);
      global.EmberfieldUI.save(this.state);
      this.scene.start('Run');
    }

    update(time, delta) {
      if (this.panelOpen) return;
      const dt = Math.min(delta / 1000, 0.05);
      const input = this.keyboardApi.read();
      H.moveHub(this.state, input, dt);

      const hub = this.state.hub;
      const s = toScreen(hub.x, hub.z, 0);
      this.hero.setPosition(s.sx, s.sy).setDepth(1000 - hub.z);
      this.hero.setFlipX(hub.facing < 0);
      this.hero.setScale(s.sc * HERO_SCALE);
      this.shadow.setPosition(s.sx, s.sy + 2).setDepth(1000 - hub.z - 1);

      const zone = H.zoneAt(this.state);
      if (zone) {
        this.prompt.setVisible(true).setText('按 J · ' + zone.name + '（' + zone.hint + '）');
        this.prompt.setPosition(s.sx, s.sy - 70 * s.sc);
        this.shadow.setScale(s.sc * 0.8);
      } else {
        this.prompt.setVisible(false);
      }

      if (Phaser.Input.Keyboard.JustDown(this.keyboardApi.keys.confirm) && zone) {
        this.showPanel(zone);
      }
    }
  }

  // ================================================================ 远征
  class RunScene extends Phaser.Scene {
    constructor() { super('Run'); }

    create() {
      this.state = CURRENT_STATE;
      this.keyboardApi = readKeys(this);
      this.enemyPool = [];

      paintBackdrop(this, 'run');

      this.effectGfx = this.add.graphics().setDepth(900);

      this.shadow = this.add.image(0, 0, 'shadow').setDepth(1).setScale(0.8);
      this.hero = this.add.image(0, 0, 'hero').setDepth(100);
      this.heroSwing = this.add.graphics().setDepth(101);

      this.events.on('wake', () => { this.state = CURRENT_STATE; });
      global.EmberfieldUI.showHud(true, this.state);
      global.EmberfieldApp.__scene = this;
      global.EmberfieldApp.__state = this.state;
    }

    getEnemySprite(i, kind) {
      if (!this.enemyPool[i]) {
        const sh = this.add.image(0, 0, 'shadow').setScale(0.62);
        const img = this.add.image(0, 0, kind);
        this.enemyPool[i] = { img: img, shadow: sh };
      }
      return this.enemyPool[i];
    }

    update(time, delta) {
      const dt = Math.min(delta / 1000, 0.05);
      const run = this.state.run;
      if (!run || this.state.phase !== 'run') return;

      const input = this.keyboardApi.read();
      L.step(this.state, input, dt);

      // 必须每帧清空：Phaser 的 Graphics 会累积绘制命令，
      // 不清的话前一帧的血条、特效、范围圈会全部叠加残留，
      // 屏幕上会出现莫名其妙的色块和长条（真实踩过这个坑）。
      this.effectGfx.clear();

      // 相机轻微跟随，让走位有纵深
      this.cameras.main.scrollX = (run.player.x - W / 2) * 0.04;

      const p = run.player;
      const ps = toScreen(p.x, p.z, p.h);
      this.hero.setPosition(ps.sx, ps.sy).setScale(ps.sc * HERO_SCALE);
      this.hero.setFlipX(p.facing < 0);
      this.hero.setDepth(1000 - p.z);
      this.hero.setAlpha(p.invuln > 0 && Math.floor(time / 60) % 2 === 0 ? 0.55 : 1);
      this.shadow.setPosition(ps.sx, toScreen(p.x, p.z, 0).sy + 2)
        .setDepth(1000 - p.z - 1).setScale(ps.sc * 0.8);

      // 挥击弧线
      this.heroSwing.clear();
      if (p.attackTimer > 0) {
        const t = p.attackTimer / C.ATTACK_DURATION;
        this.heroSwing.fillStyle(0xffe07a, 0.16 + t * 0.18);
        this.heroSwing.fillEllipse(ps.sx + p.facing * 34 * ps.sc,
          ps.sy - 22 * ps.sc, 76 * ps.sc * (1.1 - t * 0.3), 34 * ps.sc);
      }

      // 小怪
      run.enemies.forEach((e, i) => {
        const sp = this.getEnemySprite(i, e.kind);
        const es = toScreen(e.x, e.z, e.h);
        sp.img.setVisible(true).setPosition(es.sx, es.sy).setScale(es.sc * ENEMY_SCALE);
        sp.img.setDepth(1000 - e.z);
        sp.img.setTint(e.hitFlash > 0 ? 0xffffff : 0xffffff);
        sp.shadow.setVisible(true).setPosition(es.sx, toScreen(e.x, e.z, 0).sy + 2)
          .setDepth(1000 - e.z - 1).setScale(es.sc * 0.62);
        if (e.kind === 'runner' && e.state === 'windup') {
          sp.img.setTint(0xff8a6a);
        }
        // 血条
        if (e.hp < e.maxHp) {
          const frac = Math.max(0, e.hp / e.maxHp);
          this.effectGfx.fillStyle(0x000000, 0.5)
            .fillRect(es.sx - 17, es.sy - 46 * es.sc, 34, 4);
          this.effectGfx.fillStyle(0xe8574a, 1)
            .fillRect(es.sx - 17, es.sy - 46 * es.sc, 34 * frac, 4);
        }
      });
      for (let i = run.enemies.length; i < this.enemyPool.length; i++) {
        this.enemyPool[i].img.setVisible(false);
        this.enemyPool[i].shadow.setVisible(false);
      }

      // 技能特效
      run.effects.forEach((ef) => {
        const k = ef.timer / ef.maxTimer;
        const s2 = toScreen(ef.x, ef.z, 0);
        this.effectGfx.lineStyle(4, ef.color, k * 0.9);
        this.effectGfx.strokeEllipse(s2.sx, s2.sy - 16, ef.radius * 1.8 * (1.15 - k * 0.15),
          ef.radius * 0.72 * (1.15 - k * 0.15));
        if (ef.kind === 'nova') {
          this.effectGfx.fillStyle(ef.color, k * 0.22);
          this.effectGfx.fillRect(0, 0, W, GROUND_Y);
        }
      });

      global.EmberfieldUI.updateHud(this.state);

      if (this.state.phase === 'result') {
        global.EmberfieldUI.showHud(false);
        global.EmberfieldUI.save(this.state);
        global.EmberfieldUI.showResult(this.state, () => {
          L.returnToFarm(this.state);
          this.scene.start('Hub');
        });
      }
    }
  }

  // ================================================================ 启动
  // 引导场景：先在所有纹理就绪后再进基地，避免第一帧拿到不存在的纹理而黑屏
  class BootScene extends Phaser.Scene {
    constructor() { super('Boot'); }
    create() {
      buildTextures(this);
      this.scene.start('Hub');
    }
  }

  function boot(state, parentId) {
    CURRENT_STATE = state;
    // 场景数组的第一项会被自动启动 —— BootScene 必须先跑，否则纹理还没生成
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      width: W, height: HGT,
      parent: parentId,
      backgroundColor: '#141a22',
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: [BootScene, HubScene, RunScene],
      audio: { noAudio: true },
    });
    return game;
  }

  global.EmberfieldApp = { boot, BootScene, HubScene, RunScene, buildTextures, toScreen, W, HGT };
})(typeof globalThis !== 'undefined' ? globalThis : this);
