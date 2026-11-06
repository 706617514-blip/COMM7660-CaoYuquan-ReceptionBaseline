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
  // 每单位 z 对应的屏幕竖直位移。
  // 0.60 时 210 单位的景深带只有 126px 高，画面下方空掉一大块；
  // 调到 1.02 后带宽约 214px，前后走动在屏幕上明显得多。
  const Z_TO_Y = 1.02;
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

    // 吐酸虫：矮胖，带一张吐酸的嘴
    g.clear();
    g.fillStyle(0x2f2a44, 1); g.fillEllipse(24, 32, 46, 32);
    g.fillStyle(0x5a4d80, 1); g.fillEllipse(24, 28, 42, 28);
    g.fillStyle(0x9ad06a, 1); g.fillEllipse(24, 36, 15, 9);      // 酸囊
    g.fillStyle(0x1a1626, 1); g.fillCircle(16, 24, 3.6); g.fillCircle(32, 24, 3.6);
    g.fillStyle(0xd6a6ff, 1); g.fillCircle(16, 23, 1.4); g.fillCircle(32, 23, 1.4);
    g.generateTexture('spitter', 48, 48);

    // 酸弹
    g.clear();
    g.fillStyle(0x9ad06a, 0.35); g.fillCircle(9, 9, 9);
    g.fillStyle(0xbfe88a, 0.9); g.fillCircle(9, 9, 5.5);
    g.fillStyle(0xf0ffd8, 1); g.fillCircle(8, 8, 2.4);
    g.generateTexture('acid', 18, 18);

    // 影子
    g.clear();
    g.fillStyle(0x000000, 1); g.fillEllipse(24, 8, 48, 16);
    g.generateTexture('shadow', 48, 16);

    // ---- 树木 A：三层针叶，带明暗，看起来有体积 ----
    g.clear();
    g.fillStyle(0x141d17, 1); g.fillRect(27, 62, 7, 36);
    g.fillStyle(0x18241b, 1); g.fillTriangle(30, 4, 12, 44, 48, 44);
    g.fillStyle(0x1e2e22, 1); g.fillTriangle(30, 20, 8, 64, 52, 64);
    g.fillStyle(0x263a2a, 1); g.fillTriangle(30, 38, 4, 86, 56, 86);
    g.fillStyle(0x2f4633, 1); g.fillTriangle(30, 10, 20, 36, 40, 36);
    g.generateTexture('treeA', 60, 98);

    // ---- 树木 B：枯树，配"熔野"的调子 ----
    g.clear();
    g.fillStyle(0x211a16, 1); g.fillRect(28, 10, 5, 86);
    g.fillStyle(0x2b211a, 1);
    g.fillTriangle(30, 30, 6, 16, 14, 32);
    g.fillTriangle(32, 46, 58, 28, 50, 48);
    g.fillTriangle(30, 20, 16, 4, 24, 22);
    g.generateTexture('treeB', 64, 98);

    // ---- 围栏木桩 ----
    g.clear();
    g.fillStyle(0x3a2c20, 1); g.fillRect(0, 6, 7, 26);
    g.fillStyle(0x4d3a29, 1); g.fillRect(1, 6, 4, 26);
    g.generateTexture('post', 7, 32);

    // ---- 光晕（用同心圆近似径向渐变）----
    g.clear();
    for (let i = 12; i >= 1; i--) {
      g.fillStyle(0xffc06a, 0.035 * (13 - i) / 12 + 0.012);
      g.fillCircle(48, 48, i * 4);
    }
    g.generateTexture('glow', 96, 96);

    // ---- 前景灌木（压住画面下缘，避免下方空荡）----
    g.clear();
    g.fillStyle(0x0e1512, 1);
    g.fillCircle(26, 34, 24); g.fillCircle(52, 30, 20); g.fillCircle(8, 38, 16);
    g.fillCircle(40, 20, 15);
    g.generateTexture('bush', 76, 58);

    // ---- 火星粒子 ----
    g.clear();
    g.fillStyle(0xffd9a0, 1); g.fillCircle(3, 3, 2.2);
    g.fillStyle(0xfff4e0, 1); g.fillCircle(3, 3, 1.1);
    g.generateTexture('spark', 6, 6);

    // ---- 火把 ----
    g.clear();
    g.fillStyle(0x3a2c20, 1); g.fillRect(4, 10, 5, 22);
    g.fillStyle(0xff8a4c, 1); g.fillCircle(6, 9, 5);
    g.fillStyle(0xffd9a0, 1); g.fillCircle(6, 8, 2.8);
    g.generateTexture('torch', 13, 34);

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
    const isHub = mode === 'hub';
    const g = scene.add.graphics().setDepth(-1000);

    // ---- 天空：四段渐变，比两段有明显更深的纵深 ----
    const skyTop = isHub ? [16, 24, 33] : [26, 16, 20];
    const skyBot = isHub ? [58, 74, 82] : [92, 52, 40];
    for (let i = 0; i < 64; i++) {
      const t = i / 63;
      const r = Math.round(skyTop[0] + (skyBot[0] - skyTop[0]) * t);
      const gg = Math.round(skyTop[1] + (skyBot[1] - skyTop[1]) * t);
      const b = Math.round(skyTop[2] + (skyBot[2] - skyTop[2]) * t);
      g.fillStyle(Phaser.Display.Color.GetColor(r, gg, b), 1);
      g.fillRect(0, (t * GROUND_Y) - 1, W, GROUND_Y / 63 + 2);
    }

    // ---- 三层远景山脊：越远越淡，制造空气透视 ----
    const zFar = GROUND_Y - C.FIELD_D * Z_TO_Y;
    const ridges = [
      { base: 250, amp: 34, col: isHub ? 0x1b2b32 : 0x2a1e22, alpha: 0.85 },
      { base: 286, amp: 26, col: isHub ? 0x22343a : 0x33241f, alpha: 0.9 },
      { base: 318, amp: 18, col: isHub ? 0x2a3d3c : 0x3d2b22, alpha: 1 },
    ];
    ridges.forEach((rg, li) => {
      g.fillStyle(rg.col, rg.alpha);
      g.beginPath();
      g.moveTo(0, GROUND_Y);
      for (let x = 0; x <= W; x += 24) {
        const y = rg.base + Math.sin((x + li * 130) * 0.011) * rg.amp
                  + Math.sin((x + li * 60) * 0.027) * rg.amp * 0.45;
        g.lineTo(x, y);
      }
      g.lineTo(W, GROUND_Y);
      g.closePath();
      g.fillPath();
    });

    // ---- 树木：两种交替，远近不同缩放与透明度 ----
    for (let i = 0; i < 16; i++) {
      const key = i % 3 === 1 ? 'treeB' : 'treeA';
      const depthT = (i % 4) / 3;                     // 0..1
      const sc = 0.62 + depthT * 0.5;
      const y = zFar + 6 + depthT * 26;
      scene.add.image(30 + i * 62 + (i % 3) * 9, y, key)
        .setOrigin(0.5, 1).setScale(sc).setAlpha(0.32 + depthT * 0.42)
        .setDepth(-900 + i);
    }

    // ---- 地面：景深带 + 横向分道，让"能前后走"看得见 ----
    g.fillStyle(isHub ? 0x2b3a2c : 0x2a2320, 1);
    g.fillRect(0, zFar, W, HGT - zFar);
    g.fillStyle(isHub ? 0x33452f : 0x352a24, 1);
    g.fillRect(0, zFar + 22, W, HGT - zFar - 22);

    // 分道：越近越宽，暗示透视
    for (let i = 1; i <= 5; i++) {
      const y = zFar + (GROUND_Y - zFar) * (i / 6);
      g.fillStyle(0x000000, 0.10 + i * 0.012);
      g.fillRect(0, y, W, 1.5 + i * 0.6);
    }
    g.lineStyle(2, 0xffffff, 0.14);
    g.beginPath(); g.moveTo(0, zFar); g.lineTo(W, zFar); g.strokePath();

    // ---- 土路：横贯场景，给玩家一条视觉动线 ----
    g.fillStyle(isHub ? 0x4a4030 : 0x4a3a2c, 0.38);
    const roadY = GROUND_Y - 46;
    for (let x = 0; x < W; x += 60) {
      g.fillRoundedRect(x, roadY + Math.sin(x * 0.02) * 3, 62, 26, 8);
    }

    // ---- 围栏：沿景深带后缘一排木桩 ----
    for (let x = 8; x < W; x += 26) {
      scene.add.image(x, zFar + 4, 'post').setOrigin(0.5, 1)
        .setScale(0.9).setAlpha(0.55).setDepth(-700);
    }

    // ---- 前景剪影：贴在画布下缘，让画面有"近处"这一层 ----
    for (let i = 0; i < 7; i++) {
      const bx = -20 + i * 165 + (i % 2) * 40;
      scene.add.image(bx, HGT + 6, 'bush')
        .setOrigin(0.5, 1).setScale(1.5 + (i % 3) * 0.45)
        .setAlpha(0.9).setDepth(4800 + i);
    }

    // ---- 底部柔化（不是黑色板子，是渐变）----
    const fg = scene.add.graphics().setDepth(5000);
    for (let i = 0; i < 14; i++) {
      fg.fillStyle(0x000000, 0.014 * (i + 1));
      fg.fillRect(0, GROUND_Y + 30 + i * 7, W, 7);
    }

    // ---- 空中火星：价格极低、对"质感"的提升却最大 ----
    if (scene.add.particles) {
      const em = scene.add.particles(0, 0, 'spark', {
        x: { min: 0, max: W },
        y: { min: zFar - 20, max: GROUND_Y + 40 },
        lifespan: { min: 2600, max: 5200 },
        speedY: { min: -22, max: -6 },
        speedX: { min: -10, max: 16 },
        scale: { start: 0.85, end: 0 },
        alpha: { start: 0.55, end: 0 },
        frequency: 130,
        blendMode: 'ADD',
      });
      em.setDepth(4000);
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

      // 区域美术：每个设施加一圈地面灯光，把视线聚过去；细节各自补足
      this.zoneArt = {};
      H.ZONES.forEach((z) => {
        const y = GROUND_Y - (H.HUB_D / 2) * Z_TO_Y;

        // 地面光池（ADD 混合，成本极低但质感提升明显）
        const pool = this.add.image(z.x, y + 8, 'glow')
          .setScale(z.art === 'field' ? 3.4 : 2.4)
          .setAlpha(0.42)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(2);

        let img;
        if (z.art === 'field') {
          // 田地：一排栅栏 + 两排翻好的土
          img = this.add.container(z.x, y);
          for (let i = 0; i < 5; i++) {
            img.add(this.add.image(-58 + i * 29, -30, 'post').setOrigin(0.5, 1).setScale(0.8));
          }
          for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 2; j++) {
              img.add(this.add.image(-46 + i * 46, -j * 24, 'soil')
                .setScale(0.96).setOrigin(0.5, 1));
            }
          }
        } else if (z.art === 'anvil') {
          img = this.add.container(z.x, y);
          // 石砌基座 + 铁砧 + 火星
          img.add(this.add.rectangle(0, -2, 54, 10, 0x2a2f36).setOrigin(0.5, 1));
          img.add(this.add.rectangle(0, -10, 44, 9, 0x353b44).setOrigin(0.5, 1));
          img.add(this.add.image(0, -18, 'anvil').setOrigin(0.5, 1).setScale(1.15));
        } else if (z.art === 'altar') {
          img = this.add.container(z.x, y);
          img.add(this.add.image(0, 0, 'altar').setOrigin(0.5, 1).setScale(1.2));
          // 环绕符文的两个光圈
          const r1 = this.add.ellipse(0, -16, 62, 20).setStrokeStyle(1.5, 0xc9a6ff, 0.55);
          const r2 = this.add.ellipse(0, -16, 84, 26).setStrokeStyle(1, 0xc9a6ff, 0.28);
          img.add(r1); img.add(r2);
          this.tweens.add({ targets: [r1, r2], scaleX: 1.1, scaleY: 1.1,
            duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
        } else {
          img = this.add.container(z.x, y);
          img.add(this.add.image(0, 0, 'gate').setOrigin(0.5, 1).setScale(1.18));
          img.add(this.add.image(-34, -30, 'torch').setOrigin(0.5, 1).setScale(1.1));
          img.add(this.add.image(34, -30, 'torch').setOrigin(0.5, 1).setScale(1.1));
          // 门内的火光脉动
          const inner = this.add.ellipse(0, -46, 44, 62, 0xff8a4c, 0.28)
            .setBlendMode(Phaser.BlendModes.ADD);
          img.add(inner);
          this.tweens.add({ targets: inner, scaleX: 1.12, scaleY: 1.06, alpha: 0.44,
            duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
        }
        img.setDepth(10);
        this.zoneArt[z.id] = img;

        // 标签做成胶囊，比裸文字清楚
        const label = this.add.text(z.x, y + 14, z.name, {
          fontSize: '12px', color: '#e6eef6', fontFamily: 'sans-serif',
          backgroundColor: '#0b1117cc', padding: { x: 9, y: 4 },
        }).setOrigin(0.5, 0).setDepth(20).setAlpha(0.92);
        label.setStroke('#00000088', 2);
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

      this.projPool = [];
      this.dmgPool = [];
      this.lastEnemyHp = {};
      this.lastShake = 0;

      this.events.on('wake', () => { this.state = CURRENT_STATE; });
      global.EmberfieldUI.showHud(true, this.state);
      global.EmberfieldApp.__scene = this;
      global.EmberfieldApp.__state = this.state;
    }

    getEnemySprite(i, kind) {
      if (!this.enemyPool[i]) {
        const sh = this.add.image(0, 0, 'shadow').setScale(0.62);
        const img = this.add.image(0, 0, kind);
        this.enemyPool[i] = { img: img, shadow: sh, kind: kind };
      }
      const sp = this.enemyPool[i];
      // 池是按索引复用的。如果这个槽位上一帧是爬虫、这一帧是吐酸虫，
      // 纹理不会自动换 —— 结果吐酸虫会画成爬虫的样子（实际踩到过）。
      if (sp.kind !== kind) {
        sp.img.setTexture(kind);
        sp.kind = kind;
      }
      return sp;
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

      // 挥击：画成月牙刀光，而不是一个糊住的椭圆。
      // 旧版是一个米黄色 fillEllipse，既不像刀光，也和真实判定框对不上，
      // 玩家看不出"到底打哪里"。
      this.heroSwing.clear();
      if (p.attackTimer > 0) {
        const t = 1 - p.attackTimer / C.ATTACK_DURATION;   // 0 → 1 推进
        const cx = ps.sx, cy = ps.sy - 26 * ps.sc;
        const face = p.facing;
        // 由实际判定框反推：水平 ATTACK_RANGE，深度 ±ATTACK_DEPTH（屏幕上按 Z_TO_Y 压缩）
        const rOutX = C.ATTACK_RANGE * 1.08 * ps.sc;
        const rOutY = C.ATTACK_DEPTH * Z_TO_Y * 0.92 * ps.sc;
        const rInX = rOutX * 0.42, rInY = rOutY * 0.42;
        const a0 = -0.95 + t * 0.55, a1 = 0.95 + t * 0.55;  // 挥动扫过

        const arcPts = (rx, ry) => {
          const pts = [];
          for (let i = 0; i <= 14; i++) {
            const a = a0 + (a1 - a0) * (i / 14);
            pts.push([cx + Math.cos(a) * rx * face, cy + Math.sin(a) * ry]);
          }
          return pts;
        };
        const outer = arcPts(rOutX, rOutY);
        const inner = arcPts(rInX, rInY).reverse();
        const poly = outer.concat(inner);

        // 主体：淡金色半透明
        this.heroSwing.fillStyle(0xfffdf2, 0.30 * (1 - t * 0.5));
        this.heroSwing.beginPath();
        this.heroSwing.moveTo(poly[0][0], poly[0][1]);
        for (let i = 1; i < poly.length; i++) this.heroSwing.lineTo(poly[i][0], poly[i][1]);
        this.heroSwing.closePath();
        this.heroSwing.fillPath();

        // 外缘亮线：让刀光有"边"，不是一团糊
        this.heroSwing.lineStyle(2.5 * ps.sc, 0xffe9a8, 0.95 * (1 - t * 0.55));
        this.heroSwing.beginPath();
        this.heroSwing.moveTo(outer[0][0], outer[0][1]);
        for (let i = 1; i < outer.length; i++) this.heroSwing.lineTo(outer[i][0], outer[i][1]);
        this.heroSwing.strokePath();
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
        // 血条：贴在头顶一点，带深色描边，避免看起来像杂散色块
        if (e.hp < e.maxHp) {
          const frac = Math.max(0, e.hp / e.maxHp);
          const bw = 30 * es.sc, bh = 3.5;
          const bx = es.sx - bw / 2, by = es.sy - 34 * es.sc;
          this.effectGfx.fillStyle(0x000000, 0.62);
          this.effectGfx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
          this.effectGfx.fillStyle(0xe8574a, 1);
          this.effectGfx.fillRect(bx, by, bw * frac, bh);
        }
      });
      for (let i = run.enemies.length; i < this.enemyPool.length; i++) {
        this.enemyPool[i].img.setVisible(false);
        this.enemyPool[i].shadow.setVisible(false);
      }
      // 死亡的敌人短暂保留：淡出并缩小，比"瞬间消失"有交代
      run.enemies.forEach((e) => {
        if (e.state !== 'dead') return;
        const idx = run.enemies.indexOf(e);
        const sp = this.enemyPool[idx];
        if (!sp) return;
        sp.img.setAlpha(Math.min(1, e.hitFlash / 0.12));
        sp.img.setScale(sp.img.scaleX * 0.985);
        sp.shadow.setAlpha(0.18);
      });

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

      // ---- 弹道 ----
      run.projectiles.forEach((pr, i) => {
        let sp = this.projPool[i];
        if (!sp) { sp = this.add.image(0, 0, 'acid'); this.projPool[i] = sp; }
        const pss = toScreen(pr.x, pr.z, pr.h);
        sp.setVisible(true).setPosition(pss.sx, pss.sy)
          .setScale(pss.sc * (0.9 + Math.sin(pr.spin) * 0.12))
          .setDepth(1000 - pr.z + 5);
      });
      for (let i = run.projectiles.length; i < this.projPool.length; i++) {
        this.projPool[i].setVisible(false);
      }

      // ---- 伤害数字：靠每帧比对血量差值得出，不需要逻辑层配合 ----
      run.enemies.forEach((e) => {
        const prev = this.lastEnemyHp[e.id];
        if (prev !== undefined && e.hp < prev) {
          const dmg = Math.round(prev - e.hp);
          const es = toScreen(e.x, e.z, e.h);
          let tb = this.dmgPool.pop();
          if (!tb) tb = this.add.text(0, 0, '', {
            fontSize: '15px', fontFamily: 'sans-serif', color: '#fff2c0',
          }).setOrigin(0.5, 1).setDepth(3000);
          tb.setText(String(dmg)).setVisible(true).setPosition(es.sx, es.sy - 30 * es.sc)
            .setAlpha(1).setScale(1);
          tb.setStroke('#3a1d10', 3);
          this.tweens.add({
            targets: tb, y: tb.y - 34, alpha: 0, scale: 1.25,
            duration: 620, ease: 'Cubic.out',
            onComplete: () => { tb.setVisible(false); this.dmgPool.push(tb); },
          });
        }
        this.lastEnemyHp[e.id] = e.hp;
      });
      // 清理已消失敌人的记录，避免 Map 无限增长
      const aliveIds = {};
      run.enemies.forEach((e) => { aliveIds[e.id] = 1; });
      Object.keys(this.lastEnemyHp).forEach((id) => {
        if (!aliveIds[id]) delete this.lastEnemyHp[id];
      });

      // ---- 震屏：震地与大招各一次，强度不同 ----
      const cast = p.casting;
      if (cast && cast.key !== this.lastShake && cast.timer > 0) {
        if (cast.key === 'slam') this.cameras.main.shake(160, 0.010);
        if (cast.key === 'nova') this.cameras.main.shake(280, 0.016);
        if (cast.key === 'whirl') this.cameras.main.shake(90, 0.004);
        this.lastShake = cast.key;
      }
      if (!cast) this.lastShake = null;

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
