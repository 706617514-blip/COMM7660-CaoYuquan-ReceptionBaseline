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
    g.fillStyle(0x4f8f33, 1); g.fillRect(8.6, 10, 2, 12);
    g.fillStyle(0x6fbf4a, 1);
    g.fillEllipse(5.5, 8, 8, 5.2);
    g.fillEllipse(13.5, 6.5, 8, 5.2);
    g.fillStyle(0x8fd968, 1);
    g.fillEllipse(5.2, 7.2, 4.4, 2.6);
    g.generateTexture('sprout', 19, 23);

    // 麦穗：细茎 + 顶端谷粒串（之前是三角形，看起来像黄色箭头）
    g.clear();
    g.fillStyle(0x8a6b2f, 1); g.fillRect(9, 12, 2.2, 18);
    g.fillStyle(0xc9a227, 1);
    for (let i = 0; i < 4; i++) {
      g.fillEllipse(10, 4 + i * 3.2, 5.4 - i * 0.5, 3.4);
    }
    g.fillStyle(0xe8c14b, 1);
    for (let i = 0; i < 4; i++) {
      g.fillEllipse(9.4, 3.4 + i * 3.2, 2.6, 1.7);
    }
    g.fillStyle(0x8a6b2f, 1);
    g.fillTriangle(10, 12, 4, 18, 6, 20);
    g.fillTriangle(10, 14, 16, 19, 14, 21);
    g.generateTexture('crop', 20, 32);

    g.destroy();
  }

  // ================================================================ 输入
  function readKeys(scene) {
    const k = scene.input.keyboard.addKeys({
      up: 'W', down: 'S', left: 'A', right: 'D',
      jump: 'SPACE', attack: 'J', sprint: 'SHIFT',
      whirl: 'U', blink: 'I', slam: 'O', cry: 'K', nova: 'L',
      confirm: 'J', esc: 'ESC',
    });
    const read = () => ({
      up: !!k.up.isDown, down: !!k.down.isDown,
      left: !!k.left.isDown, right: !!k.right.isDown,
      jump: !!k.jump.isDown, attack: !!k.attack.isDown, sprint: !!k.sprint.isDown,
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
    // 农场模式跳过：耕地会盖住地平线，树画上去等于长在田中央
    for (let i = 0; mode !== 'farm' && i < 16; i++) {
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
    if (mode !== 'farm') {
    g.fillStyle(isHub ? 0x4a4030 : 0x4a3a2c, 0.38);
    const roadY = GROUND_Y - 46;
    for (let x = 0; x < W; x += 60) {
      g.fillRoundedRect(x, roadY + Math.sin(x * 0.02) * 3, 62, 26, 8);
    }
    }

    // ---- 围栏：沿景深带后缘一排木桩 ----
    for (let x = 8; mode !== 'farm' && x < W; x += 26) {
      scene.add.image(x, zFar + 4, 'post').setOrigin(0.5, 1)
        .setScale(0.9).setAlpha(0.55).setDepth(-700);
    }

    // ---- 农场模式：把中段整片铺成耕地，田直接坐在土上 ----
    if (mode === 'farm') {
      const soilTop = 206;
      for (let i = 0; i < 26; i++) {
        const t = i / 25;
        const r = Math.round(58 + t * 22);
        const gg = Math.round(44 + t * 16);
        const b = Math.round(30 + t * 12);
        g.fillStyle(Phaser.Display.Color.GetColor(r, gg, b), 1);
        g.fillRect(0, soilTop + t * (HGT - soilTop), W, (HGT - soilTop) / 25 + 2);
      }
      // 远处的地平线阴影，把耕地和树林分开
      g.fillStyle(0x000000, 0.35);
      g.fillRect(0, soilTop, W, 12);
    }

    // ---- 前景剪影：贴在画布下缘，让画面有"近处"这一层 ----
    // 农场模式不画：会挡住最靠前的一排田
    for (let i = 0; mode !== 'farm' && i < 7; i++) {
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
      // 基地里同样支持 Shift 冲刺
      H.moveHub(this.state, input, dt, input.sprint ? C.SPRINT_MULT : 1);

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
        if (zone.id === 'field') {
          // 农场是一个独立场景，不是弹出面板：
          // 渐黑 → 切换 → 渐亮，让"走进农田"有过渡感
          this.panelOpen = true;
          this.cameras.main.fadeOut(340, 0, 0, 0);
          this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Farm'));
        } else {
          this.showPanel(zone);
        }
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
        const k = ef.timer / ef.maxTimer;      // 1 → 0
        const prog = 1 - k;                    // 0 → 1 推进
        if (ef.kind === 'wave') {
          // 裂风斩：由一束横向速度线组成的刀风，朝前推进。
          // 早期画成一个填充椭圆，观感像个灰白气泡，完全不像"风刃"。
          const dx = ef.facing * ef.radius * prog;
          const cx = ef.x + dx;
          const sc = toScreen(cx, ef.z, 0);
          const halfH = ef.depth * Z_TO_Y * sc.sc;
          const bladeW = ef.radius * 0.34 * sc.sc * (1.15 - prog * 0.3);
          const cy = sc.sy - 26 * sc.sc;

          // 5 条横线，中间最长、两侧收窄 —— 整体成一竖条刀形
          for (let i = -2; i <= 2; i++) {
            const t = i / 2;                            // -1..1
            const w = bladeW * Math.cos(t * Math.PI * 0.42);
            const y = cy + t * halfH * 0.86;
            const a = (0.62 - Math.abs(t) * 0.30) * k;
            this.effectGfx.fillStyle(ef.color, a);
            this.effectGfx.fillRect(sc.sx - w / 2, y - 2.2 * sc.sc, w, 4.4 * sc.sc);
          }
          // 前缘亮线：刀风的"刃口"
          this.effectGfx.lineStyle(2.6 * sc.sc, 0xffffff, 0.9 * k);
          this.effectGfx.beginPath();
          this.effectGfx.moveTo(sc.sx + ef.facing * bladeW * 0.5, cy - halfH * 0.86);
          this.effectGfx.lineTo(sc.sx + ef.facing * bladeW * 0.5, cy + halfH * 0.86);
          this.effectGfx.strokePath();

          // 尾迹：起手位置的残风
          const backX = ef.x + ef.facing * ef.radius * prog * 0.35;
          const bs = toScreen(backX, ef.z, 0);
          this.effectGfx.fillStyle(ef.color, 0.16 * k);
          this.effectGfx.fillEllipse(bs.sx, bs.sy - 24 * bs.sc,
            bladeW * 1.25, halfH * 0.5);
          return;
        }
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

      // ---- 冲刺残影：三节逐渐变淡的拖影，让"加速"看得见 ----
      if (p.runTrail) {
        for (let i = 1; i <= 3; i++) {
          const back = -p.facing * i * 16;
          const ts = toScreen(p.x + back, p.z, p.h);
          this.effectGfx.fillStyle(0x6fb1e0, 0.16 / i);
          this.effectGfx.fillRect(ts.sx - 9 * ts.sc, ts.sy - 46 * ts.sc,
                                  18 * ts.sc, 44 * ts.sc);
        }
        // 脚下扬尘
        this.effectGfx.fillStyle(0xc9b48f, 0.10);
        this.effectGfx.fillEllipse(ps.sx - p.facing * 22 * ps.sc,
          toScreen(p.x, p.z, 0).sy + 8, 46 * ps.sc, 12 * ps.sc);
      }

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
  // ================================================================ 农场（独立场景）
  /**
   * 农场场景：从基地走到田地按 J 进入（渐黑 → 渐亮）。
   *
   * 为什么单独做一个场景而不是弹面板：
   * 面板只能"点按钮"，而农田是这游戏的经营核心，值得一块完整的画面。
   * 这里用透视排布的田垄 + 逐格作物，点击或按 J 播种，ESC 回基地。
   */
  class FarmScene extends Phaser.Scene {
    constructor() { super('Farm'); }

    create() {
      this.state = CURRENT_STATE;
      H.ensureHub(this.state);
      this.keyboardApi = readKeys(this);
      this.cursor = 0;
      this.busy = false;

      paintBackdrop(this, 'farm');
      this.cameras.main.fadeIn(420, 0, 0, 0);

      const CX = W / 2;
      // 近排在第 452，三排向上 96 一档 —— 整块田占住画面主体，
      // 之前放在 GROUND_Y+34 又被前景灌木盖住，几乎看不见
      const baseY = 452;

      this.plotGeo = [];
      const rows = 3, cols = 3;
      for (let r = 0; r < rows; r++) {
        const depth = r / (rows - 1);              // 0 近 → 1 远
        const cy = baseY - r * 96;
        const rowW = 470 - depth * 110;            // 远处更窄
        const rowH = 74 - depth * 18;
        for (let c = 0; c < cols; c++) {
          const cx = CX + (c - 1) * (rowW / 3);
          this.plotGeo.push({
            idx: r * cols + c, cx: cx, cy: cy,
            w: (rowW / 3) - 12, h: rowH, depth: depth,
          });
        }
      }

      // 田地边框（木栅栏，环绕整块田）
      const fence = this.add.graphics().setDepth(5);
      fence.lineStyle(3, 0x4d3a29, 0.9);
      const topY = baseY - 2 * 96 - 44;
      fence.beginPath();
      fence.moveTo(CX - 300, topY); fence.lineTo(CX + 300, topY);
      fence.strokePath();
      for (let x = -300; x <= 300; x += 30) {
        this.add.image(CX + x, topY, 'post').setOrigin(0.5, 1).setScale(0.95).setDepth(6);
      }
      // 前排栅栏压在画面下缘，不遮挡田块
      for (let x = -310; x <= 310; x += 28) {
        this.add.image(CX + x, HGT - 8, 'post').setOrigin(0.5, 1)
          .setScale(1.35).setDepth(700);
      }

      // ---- 土块与作物图层 ----
      this.soilGfx = this.add.graphics().setDepth(10);
      this.cropLayer = this.add.container(0, 0).setDepth(20);
      this.hintLayer = this.add.container(0, 0).setDepth(30);
      this.redrawField();

      // ---- 顶部信息 ----
      this.hudText = this.add.text(24, 22, '', {
        fontSize: '13px', color: '#e6eef6', fontFamily: 'sans-serif',
        backgroundColor: '#0b1117cc', padding: { x: 12, y: 8 }, lineSpacing: 5,
      }).setDepth(900);
      this.refreshHud();

      this.add.text(W - 24, 26, '点击田地播种　·　ESC 回基地', {
        fontSize: '12px', color: '#8fa3b8', fontFamily: 'sans-serif',
        backgroundColor: '#0b1117aa', padding: { x: 10, y: 6 },
      }).setOrigin(1, 0).setDepth(900);

      // ---- 点击播种 ----
      this.input.on('pointerdown', (pointer) => {
        if (this.busy) return;
        const idx = this.hitPlot(pointer.x, pointer.y);
        if (idx >= 0) this.tryPlant(idx);
      });

      // ---- ESC / J 返回 ----
      this.input.keyboard.on('keydown-ESC', () => this.leave());
    }

    hitPlot(px, py) {
      // 从近到远判定，近的优先（远行画在上面但实际更小）
      for (let i = this.plotGeo.length - 1; i >= 0; i--) {
        const g = this.plotGeo[i];
        if (Math.abs(px - g.cx) <= g.w / 2 + 6 && Math.abs(py - g.cy) <= g.h / 2 + 6) {
          return g.idx;
        }
      }
      return -1;
    }

    redrawField() {
      const g = this.soilGfx;
      g.clear();
      this.cropLayer.removeAll(true);
      this.hintLayer.removeAll(true);

      this.plotGeo.forEach((geo) => {
        const plot = this.state.farm.plots[geo.idx];
        const dark = 0.06 + geo.depth * 0.16;

        // 土块：深棕底，犁沟做明暗配对（暗沟 + 亮脊），才像翻耕过的地
        g.fillStyle(0x2a1f15, 1);
        g.fillRoundedRect(geo.cx - geo.w / 2, geo.cy - geo.h / 2, geo.w, geo.h, 5);
        g.fillStyle(0x3b2c1d, 1);
        g.fillRoundedRect(geo.cx - geo.w / 2 + 1.5, geo.cy - geo.h / 2 + 1.5,
                          geo.w - 3, geo.h - 3.5, 4);

        const furrows = 5;
        for (let f = 0; f < furrows; f++) {
          const fy = geo.cy - geo.h / 2 + 6 + f * (geo.h - 11) / (furrows - 1);
          g.fillStyle(0x1b140d, 0.72);
          g.fillRect(geo.cx - geo.w / 2 + 5, fy, geo.w - 10, 3.2);
          g.fillStyle(0x5a4530, 0.5);
          g.fillRect(geo.cx - geo.w / 2 + 5, fy + 3.2, geo.w - 10, 1.6);
        }
        // 土坷垃：固定位置的斑点，避免每帧随机跳动
        for (let d = 0; d < 9; d++) {
          const dx = ((geo.idx * 37 + d * 53) % 100) / 100;
          const dy = ((geo.idx * 61 + d * 29) % 100) / 100;
          g.fillStyle(d % 2 ? 0x2a1f15 : 0x4d3a27, 0.55);
          g.fillCircle(geo.cx - geo.w / 2 + 8 + dx * (geo.w - 16),
                       geo.cy - geo.h / 2 + 8 + dy * (geo.h - 16), 1.6 + (d % 3) * 0.7);
        }

        // 边缘加深，做出凹陷
        g.lineStyle(1.5, 0x241b12, 0.6 + dark);
        g.strokeRoundedRect(geo.cx - geo.w / 2, geo.cy - geo.h / 2, geo.w, geo.h, 6);

        // 作物
        if (plot.state === 'growing') {
          const n = 6;
          for (let k = 0; k < n; k++) {
            const px = geo.cx - geo.w * 0.36 + k * (geo.w * 0.144);
            const py = geo.cy + geo.h * 0.22;
            const sp = this.add.image(px, py, 'sprout')
              .setOrigin(0.5, 1);
            // 刚种下时很小，随生长局数变大
            const t = plot.growth / C.FARM.runsToMature;
            sp.setScale((0.75 + t * 0.7) * (0.95 + geo.depth * 0.15));
            this.cropLayer.add(sp);
          }
          const label = this.add.text(geo.cx, geo.cy - geo.h / 2 - 4,
            '再 ' + (C.FARM.runsToMature - plot.growth) + ' 局', {
              fontSize: '10px', color: '#b6d18f', fontFamily: 'sans-serif',
              backgroundColor: '#0b1117aa', padding: { x: 5, y: 2 },
            }).setOrigin(0.5, 1);
          this.hintLayer.add(label);
        } else if (plot.state === 'mature') {
          const n = 7;
          for (let k = 0; k < n; k++) {
            const px = geo.cx - geo.w * 0.36 + k * (geo.w * 0.12);
            const py = geo.cy + geo.h * 0.2;
            const cr = this.add.image(px, py, 'crop')
              .setOrigin(0.5, 1).setScale(1.25 + geo.depth * 0.25);
            this.tweens.add({ targets: cr, angle: { from: -3, to: 3 },
              duration: 1400 + k * 90, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
            this.cropLayer.add(cr);
          }
          // 成熟的光
          const glow = this.add.image(geo.cx, geo.cy, 'glow')
            .setScale(1.5).setAlpha(0.34).setBlendMode(Phaser.BlendModes.ADD);
          this.cropLayer.add(glow);
          const label = this.add.text(geo.cx, geo.cy - geo.h / 2 - 4,
            '+' + C.FARM.yieldPerPlot + '/局', {
              fontSize: '10px', color: '#e8b04b', fontFamily: 'sans-serif',
              backgroundColor: '#0b1117aa', padding: { x: 5, y: 2 },
            }).setOrigin(0.5, 1);
          this.hintLayer.add(label);
        } else {
          const label = this.add.text(geo.cx, geo.cy, '空', {
            fontSize: '11px', color: '#6b5a45', fontFamily: 'sans-serif',
          }).setOrigin(0.5);
          this.hintLayer.add(label);
        }
      });
    }

    tryPlant(idx) {
      const r = L.plant(this.state, idx);
      if (!r.ok) {
        this.flash(r.reason, false);
        return;
      }
      global.EmberfieldUI.save(this.state);
      this.redrawField();
      this.refreshHud();
      this.flash('已播种', true);
    }

    flash(msg, good) {
      if (this.toastText) this.toastText.destroy();
      this.toastText = this.add.text(W / 2, HGT - 74, msg, {
        fontSize: '13px', color: good ? '#bfe6a0' : '#ffc7c0',
        fontFamily: 'sans-serif',
        backgroundColor: '#0b1117e6', padding: { x: 14, y: 7 },
      }).setOrigin(0.5).setDepth(950);
      this.tweens.add({
        targets: this.toastText, alpha: 0, y: HGT - 62,
        duration: 1100, delay: 380, onComplete: () => {
          if (this.toastText) { this.toastText.destroy(); this.toastText = null; }
        },
      });
    }

    refreshHud() {
      const s = this.state;
      this.hudText.setText(
        '铜币  ' + s.meta.coins + '　　种子  ' + s.meta.seeds + '\n' +
        '成熟田  ' + L.maturePlots(s) + ' / 9　　每局被动  +' + L.passiveIncome(s) + '\n' +
        '作物需要 ' + C.FARM.runsToMature + ' 局成熟，输掉也算一局'
      );
    }

    leave() {
      if (this.busy) return;
      this.busy = true;
      global.EmberfieldUI.save(this.state);
      this.cameras.main.fadeOut(320, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Hub'));
    }

    update() {
      if (this.busy) return;
      const k = this.keyboardApi.keys;
      if (Phaser.Input.Keyboard.JustDown(k.esc)) this.leave();
      // J 也可以返回（与基地的操作键一致）
      if (Phaser.Input.Keyboard.JustDown(k.confirm)) this.leave();
    }
  }

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
      scene: [BootScene, HubScene, RunScene, FarmScene],
      audio: { noAudio: true },
    });
    return game;
  }

  global.EmberfieldApp = { boot, BootScene, HubScene, RunScene, FarmScene,
                          buildTextures, toScreen, W, HGT };
})(typeof globalThis !== 'undefined' ? globalThis : this);
