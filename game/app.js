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
 *   1. 测试（规则 108 项 + 界面 40 项 + 档案/基地 57 项）验证的是玩家实际跑的那套规则，
 *      不会出现"测的和玩的是两套"。注意：渲染层不在 Node 测试覆盖内，
 *      它的正确性靠无头 Electron 截图核对（见 docs/screenshots）。
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
    // 安全网：每次 generateTexture 前重置描边与填充路径。
    // Phaser 的 Graphics 会保留当前路径与描边设置，任何一次忘记重置都会让
    // 残留的 path 进入下一个纹理 —— 表现为场景里出现无来源的方框。
    const _gen = g.generateTexture.bind(g);
    g.generateTexture = function (key, w, h) {
      g.lineStyle(0, 0x000000, 0);
      _gen(key, w, h);
    };

    // ================= 主角与敌人（重做：加轮廓光、四肢、材质）=================
    // 之前是纯色圆角矩形叠圆，没有轮廓也没有四肢，像色块拼图。
    // 现在每个都加：深色描边（把角色从背景里拉出来）、受光面、细分部件。

    // ---- 主角：兜帽 + 披风 + 四肢 + 剑 ----
    g.clear();
    // 披风（后层，带褶皱）
    g.fillStyle(0x1e2f42, 1);
    g.fillTriangle(18, 20, 4, 54, 34, 54);
    g.fillStyle(0x27415c, 1);
    g.fillTriangle(19, 22, 9, 52, 31, 52);
    // 腿
    g.fillStyle(0x22303f, 1);
    g.fillRoundedRect(13, 42, 6, 14, 2.5);
    g.fillRoundedRect(21, 42, 6, 14, 2.5);
    // 靴
    g.fillStyle(0x3a2c20, 1);
    g.fillRoundedRect(12, 53, 8, 5, 2);
    g.fillRoundedRect(20, 53, 8, 5, 2);
    // 躯干
    g.fillStyle(0x2f4a63, 1);
    g.fillRoundedRect(10, 20, 20, 25, 5);
    // 胸甲（受光 + 背光）
    g.fillStyle(0x6fb1e0, 1);
    g.fillRoundedRect(12, 22, 16, 16, 4);
    g.fillStyle(0x9ad0f0, 1);
    g.fillRoundedRect(13, 23, 6, 10, 3);
    // 腰带
    g.fillStyle(0x8a6b2f, 1);
    g.fillRect(10, 39, 20, 3.5);
    // 头
    g.fillStyle(0xf0d3b0, 1);
    g.fillCircle(20, 13, 9);
    g.fillStyle(0xffe6c8, 1);
    g.fillCircle(17.5, 11, 4);                   // 受光面
    // 兜帽（罩住头顶与后脑）
    g.fillStyle(0x1b2635, 1);
    g.beginPath(); g.moveTo(20, 2); g.lineTo(31, 16); g.lineTo(9, 16); g.closePath();
    g.fillPath();
    g.fillStyle(0x27384c, 1);
    g.beginPath(); g.moveTo(19, 4); g.lineTo(28, 15); g.lineTo(11, 15); g.closePath();
    g.fillPath();
    // 眼睛
    g.fillStyle(0x1b1310, 1);
    g.fillCircle(17, 14, 1.5); g.fillCircle(22.5, 14, 1.5);
    // 剑（斜挎）
    g.fillStyle(0xb8c6d4, 1); g.fillRect(30, 14, 3.5, 28);
    g.fillStyle(0xe8f2fa, 1); g.fillRect(30, 14, 1.4, 28);      // 剑脊高光
    g.fillStyle(0x2b2016, 1); g.fillRect(28, 40, 8, 4.5);       // 护手
    g.fillStyle(0x6b5138, 1); g.fillRect(30.5, 43, 3, 7);       // 剑柄
    g.generateTexture('hero', 40, 60);

    // ---- 爬虫：六足 + 甲壳分层 ----
    g.clear();
    // 腿（先画，压在身体下）
    g.lineStyle(2.6, 0x22341a, 1);
    [[14, 30], [22, 33], [30, 30]].forEach((pt) => {
      g.beginPath(); g.moveTo(pt[0], pt[1]); g.lineTo(pt[0] - 5, pt[1] + 9); g.strokePath();
      g.beginPath(); g.moveTo(pt[0], pt[1]); g.lineTo(pt[0] + 5, pt[1] + 9); g.strokePath();
    });
    g.lineStyle(0, 0x000000, 0);   // 重置描边，避免残留路径被下一个纹理带走
    // 甲壳：背光层 → 主体 → 受光层
    g.fillStyle(0x2a3f1c, 1); g.fillEllipse(23, 29, 46, 34);
    g.fillStyle(0x6d9450, 1); g.fillEllipse(22, 26, 40, 29);
    g.fillStyle(0x93b870, 1); g.fillEllipse(18, 21, 20, 13);
    // 甲片分节
    g.fillStyle(0x3d5a2a, 0.6);
    g.fillRect(12, 28, 22, 1.6);
    g.fillRect(14, 33, 18, 1.6);
    // 眼（带高光）
    g.fillStyle(0x18220f, 1);
    g.fillCircle(15, 21, 3.6); g.fillCircle(29, 21, 3.6);
    g.fillStyle(0xf0ffd8, 0.9);
    g.fillCircle(14, 20, 1.3); g.fillCircle(28, 20, 1.3);
    g.generateTexture('crawler', 46, 46);

    // ---- 冲刺虫：尖角 + 蓄势的后腿 ----
    g.clear();
    g.fillStyle(0x5a2515, 1); g.fillTriangle(23, 1, 46, 41, 0, 41);
    g.fillStyle(0xb8543a, 1); g.fillTriangle(23, 7, 41, 39, 5, 39);
    g.fillStyle(0xd97a5c, 1); g.fillTriangle(22, 9, 33, 35, 11, 35);   // 受光面
    // 背刺
    g.fillStyle(0x3d1a0e, 1);
    g.fillTriangle(23, 2, 27, 14, 19, 14);
    // 眼（发光）
    g.fillStyle(0xffd9a0, 1);
    g.fillCircle(17, 27, 3.2); g.fillCircle(29, 27, 3.2);
    g.fillStyle(0xfff4e0, 1);
    g.fillCircle(17, 26, 1.4); g.fillCircle(29, 26, 1.4);
    g.generateTexture('runner', 46, 43);

    // ---- 吐酸虫：鼓胀的酸囊 + 皱褶 ----
    g.clear();
    g.fillStyle(0x241f33, 1); g.fillEllipse(25, 33, 48, 33);
    g.fillStyle(0x5a4d80, 1); g.fillEllipse(24, 29, 43, 29);
    g.fillStyle(0x7a68a8, 1); g.fillEllipse(19, 23, 21, 13);           // 受光面
    // 酸囊（带高光）
    g.fillStyle(0x7ab84a, 1); g.fillEllipse(25, 38, 17, 10);
    g.fillStyle(0xbfe88a, 1); g.fillEllipse(22, 37, 8, 5);
    // 皱褶
    g.fillStyle(0x3b3358, 0.7);
    g.fillRect(12, 30, 26, 1.4);
    g.fillRect(15, 34, 20, 1.4);
    // 眼
    g.fillStyle(0x140f1e, 1);
    g.fillCircle(16, 24, 3.7); g.fillCircle(33, 24, 3.7);
    g.fillStyle(0xd6a6ff, 1);
    g.fillCircle(16, 23, 1.5); g.fillCircle(33, 23, 1.5);
    g.generateTexture('spitter', 50, 50);

    // 影子
    g.clear();
    g.fillStyle(0x000000, 1); g.fillEllipse(24, 8, 48, 16);
    g.generateTexture('shadow', 48, 16);

    // ---- 光晕：地面光池与成熟作物用 ----
    // 注意：这个纹理在重做植被时曾被误删，而场景仍在引用它，
    // Phaser 于是渲染默认的 missing-texture —— 画面上表现为绿色方框。
    g.clear();
    for (let i = 26; i >= 1; i--) {
      const t = i / 26;
      g.fillStyle(0xffc06a, 0.020 + t * 0.030);
      g.fillCircle(56, 56, i * 2.1);
    }
    g.generateTexture('glow', 112, 112);

    // ---- 酸弹 ----
    g.clear();
    g.fillStyle(0x9ad06a, 0.32); g.fillCircle(9, 9, 9);
    g.fillStyle(0xbfe88a, 0.92); g.fillCircle(9, 9, 5.5);
    g.fillStyle(0xf0ffd8, 1); g.fillCircle(7.6, 7.6, 2.4);
    g.generateTexture('acid', 18, 18);

    // ================= 植被（重做：多层明暗 + 枝干细节 + 轮廓变化）=================
    // 之前是无细节的三角/圆形堆，远看就是深绿团块。现在加：
    //   树干分叉、枝叶分层（每层有受光面与背光面）、随机缺口、地衣斑点。

    // 针叶树（近，细节多）
    (function () {
      const seed = 3.1;
      const rnd = (i) => { const x = Math.sin(seed + i * 78.233) * 43758.5453; return x - Math.floor(x); };
      const h = 104;
      g.clear();
      const cx = 34;
      g.fillStyle(0x2b2016, 1); g.fillRect(cx - 3, h * 0.58, 6, h * 0.42);
      g.fillStyle(0x1a130d, 1); g.fillRect(cx + 1, h * 0.58, 2, h * 0.42);
      for (let L = 0; L < 5; L++) {
        const t = L / 4;
        const yBase = h * (0.66 - t * 0.50);
        const w = 27 * (1 - t * 0.60);
        const yTop = yBase - h * 0.26;
        g.fillStyle(0x162218, 1);
        g.fillTriangle(cx + 2.5, yTop + 3, cx - w, yBase + 4, cx + w + 3, yBase + 4);
        g.fillStyle(0x2c4432, 1);
        g.fillTriangle(cx, yTop, cx - w + 2, yBase, cx + w - 1, yBase);
        g.fillStyle(0x415f3e, 0.5);
        g.fillTriangle(cx - 1, yTop + 4, cx - w + 3, yBase - 1, cx - w * 0.3, yBase - 1);
      }
      for (let k = 0; k < 6; k++) {
        g.fillStyle(0x162218, 0.85);
        g.fillCircle(cx + (rnd(k) - 0.5) * 40, h * (0.16 + rnd(k + 8) * 0.44), 1.5 + rnd(k + 5) * 2);
      }
      g.generateTexture('treeA', 68, h);
    })();

    // 阔叶树（另一种轮廓，避免整片同款）
    (function () {
      const seed = 9.4;
      const rnd = (i) => { const x = Math.sin(seed + i * 51.77) * 43758.5453; return x - Math.floor(x); };
      const w = 84, h = 100;
      g.clear();
      const cx = w / 2;
      // 树干 + 两根分叉
      g.fillStyle(0x3a2c20, 1);
      g.fillRect(cx - 4, h * 0.52, 8, h * 0.48);
      g.fillRect(cx - 13, h * 0.56, 13, 5);
      g.fillRect(cx + 1, h * 0.62, 12, 5);
      g.fillStyle(0x241a12, 1);
      g.fillRect(cx + 2, h * 0.52, 2.5, h * 0.48);
      // 树冠：一圈重叠的椭圆，每个带受光面
      const blobs = [
        [cx - 16, 30, 22, 15], [cx + 15, 26, 20, 14], [cx, 16, 24, 16],
        [cx - 5, 38, 26, 14], [cx + 12, 44, 18, 11], [cx - 20, 44, 17, 10],
      ];
      blobs.forEach((b0, i) => {
        g.fillStyle(0x1b2a1d, 1);
        g.fillEllipse(b0[0] + 2, b0[1] + 3, b0[2] * 2, b0[3] * 2);
      });
      blobs.forEach((b0, i) => {
        const lit = i % 3 === 0 ? 0x4a6b40 : 0x36512f;
        g.fillStyle(lit, 1);
        g.fillEllipse(b0[0], b0[1], b0[2] * 2 - 3, b0[3] * 2 - 3);
      });
      blobs.forEach((b0, i) => {
        if (i % 2) return;
        g.fillStyle(0x5c8148, 0.42);
        g.fillEllipse(b0[0] - b0[2] * 0.3, b0[1] - b0[3] * 0.4, b0[2] * 0.9, b0[3] * 0.7);
      });
      g.generateTexture('treeB', w, h);
    })();

    // 灌木：现在带受光面、枝条和浆果，不再是黑团
    (function () {
      const seed = 5.5;
      const rnd = (i) => { const x = Math.sin(seed + i * 39.31) * 43758.5453; return x - Math.floor(x); };
      const w = 92, h = 66;
      g.clear();
      // 枝条先画，从底部散开
      for (let k = 0; k < 5; k++) {
        const bx = 18 + k * 14;
        g.lineStyle(2.2, 0x2a2016, 1);
        g.beginPath();
        g.moveTo(bx, h - 6);
        g.lineTo(bx + (rnd(k) - 0.5) * 22, h * 0.42);
        g.strokePath();
      }
      // 画完枝条必须重置：残留路径会被下一次 generateTexture 一起渲染，
      // 在场景里表现为莫名其妙的方框（实测出现过绿色描边框）。
      g.lineStyle(0, 0x000000, 0);
      const lumps = [
        [22, 40, 20, 15], [46, 32, 23, 17], [70, 42, 18, 13],
        [34, 24, 17, 12], [58, 20, 16, 11], [12, 46, 13, 10],
      ];
      lumps.forEach((b0) => {
        g.fillStyle(0x141f16, 1);
        g.fillEllipse(b0[0] + 2, b0[1] + 3, b0[2] * 2, b0[3] * 2);
      });
      lumps.forEach((b0, i) => {
        g.fillStyle(i % 2 ? 0x2e4529 : 0x38542f, 1);
        g.fillEllipse(b0[0], b0[1], b0[2] * 2 - 3, b0[3] * 2 - 3);
      });
      lumps.forEach((b0, i) => {
        if (i % 2) return;
        g.fillStyle(0x51733f, 0.5);
        g.fillEllipse(b0[0] - b0[2] * 0.35, b0[1] - b0[3] * 0.45, b0[2] * 0.95, b0[3] * 0.7);
      });
      // 浆果
      for (let k = 0; k < 5; k++) {
        g.fillStyle(0x8a3a3a, 1);
        g.fillCircle(16 + rnd(k + 30) * 60, 22 + rnd(k + 40) * 22, 2.1);
      }
      g.generateTexture('bush', w, h);
    })();

    // 木桩：加木纹与顶面，不再是一根扁矩形
    g.clear();
    g.fillStyle(0x2e2318, 1); g.fillRect(0, 4, 8, 28);
    g.fillStyle(0x4d3a29, 1); g.fillRect(1, 4, 5.5, 28);
    g.fillStyle(0x6b5138, 1); g.fillRect(1.5, 4, 2, 28);          // 受光木纹
    g.fillStyle(0x8a6b46, 1); g.fillEllipse(4, 4, 7, 3.2);        // 顶面
    g.fillStyle(0x2e2318, 1); g.fillRect(2, 12, 4, 1.2);          // 纹理
    g.fillRect(2, 20, 4, 1.2);
    g.generateTexture('post', 8, 34);

    // ---- 土粒（播种溅射用）----
    g.clear();
    g.fillStyle(0x3b2c1d, 1); g.fillRect(0, 2, 4, 4);
    g.fillStyle(0x5a4530, 1); g.fillRect(1, 3, 2, 2);
    g.generateTexture('clod', 4, 8);

    // ---- 种子（带实体感的椭圆 + 高光）----
    g.clear();
    g.fillStyle(0x8a6b2f, 1); g.fillEllipse(6, 5, 12, 9);
    g.fillStyle(0xc9a227, 1); g.fillEllipse(6, 4.4, 11, 8);
    g.fillStyle(0xf0dfa0, 1); g.fillEllipse(4, 3, 4, 2.4);
    g.generateTexture('seed', 13, 11);

    // ---- 草叶纹理：三种形态，随机选，避免整片草地重复感 ----
    // 关键：纹理底部必须落在 y=H，这样 origin(0.5,1) 贴地时根部正好在地面线上，
    // 旋转/缩放时根部不动、叶片摆动。
    const bladeG = (h, lean, thick, colTop, colBot) => {
      g.clear();
      // 用两个三角拼一条有弧度的叶：底部厚、顶部收尖
      g.fillStyle(colBot, 1);
      g.fillTriangle(10 - thick / 2, h, 10 + thick / 2, h, 10 + lean * 0.45, h * 0.42);
      g.fillStyle(colTop, 1);
      g.fillTriangle(10 - thick / 2 * 0.8, h * 0.5,
                     10 + thick / 2 * 0.8, h * 0.5,
                     10 + lean, 0);
      return 20;
    };
    bladeG(34, 5, 5, 0x6f9a4a, 0x3d5a2c);
    g.generateTexture('bladeA', 20, 34);

    bladeG(46, -7, 6, 0x7fa956, 0x44632f);
    g.generateTexture('bladeB', 20, 46);

    // 丛生：三片叶子从同一点散开
    g.clear();
    g.fillStyle(0x3d5a2c, 1);
    g.fillTriangle(9, 40, 13, 40, 2, 10);
    g.fillTriangle(9, 40, 13, 40, 17, 6);
    g.fillTriangle(9, 40, 13, 40, 24, 14);
    g.fillStyle(0x6f9a4a, 1);
    g.fillTriangle(9, 40, 12, 40, 4, 12);
    g.fillTriangle(10, 40, 13, 40, 16, 8);
    g.fillStyle(0x8fbf63, 1);
    g.fillTriangle(10, 40, 12, 40, 20, 16);
    g.generateTexture('bladeC', 26, 40);

    // 带穗的草：草叶 + 顶端小花穗（近处用，增加细节）
    g.clear();
    g.fillStyle(0x3d5a2c, 1); g.fillTriangle(8, 52, 12, 52, 10, 14);
    g.fillStyle(0x6f9a4a, 1); g.fillTriangle(8, 52, 11, 52, 9, 16);
    g.fillStyle(0xc9b06a, 1);
    for (let i = 0; i < 4; i++) g.fillEllipse(10, 8 + i * 3.2, 4.5 - i * 0.4, 2.8);
    g.generateTexture('bladeS', 20, 52);

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

  // ================================================================ 草（会动）
  /**
   * 地面上的草。三个设计要点：
   *
   * 1. **按 z 排序**：草的 depth 用 1000 - z，与角色/敌人同一套排序，
   *    所以靠前的草会盖住靠后的角色，走近草丛时有"拨草"的层次感。
   * 2. **两道相位不同的风**：一道低频的大风（整片一起倒），一道高频的小风
   *    （叶尖各自抖）。只有一道正弦会像整体平移，很假。
   * 3. **每株草自带相位与频率偏移**：同相位会让整片草像一块板子在晃。
   */
  const grassFields = new WeakMap();

  function plantGrass(scene, mode) {
    if (mode === 'farm') return null;      // 农场是耕地，不长草
    const isHub = mode === 'hub';
    const blades = [];
    const rng = (i) => {
      // 确定性伪随机：同一株草每帧相位一致，不会跳。
      const x = Math.sin(i * 127.1) * 43758.5453;
      return x - Math.floor(x);
    };

    // 密度是关键。第一版只种了 120 根铺满 960px（平均 8px 一根），
    // 看起来像一根根麦子插在地上，不像草地。
    // 现在按 z 分带，近处密、远处疏，总量约 5 倍。
    const BANDS = 7;
    const perBand = isHub ? 62 : 52;
    let idx = 0;
    for (let band = 0; band < BANDS; band++) {
      const zLo = (band / BANDS) * C.FIELD_D;
      const zHi = ((band + 1) / BANDS) * C.FIELD_D;
      // 越近的带种得越多（近处密度 ≈ 2.4 倍于远处）
      const n = Math.round(perBand * (0.45 + (band / (BANDS - 1)) * 1.15));
      for (let k = 0; k < n; k++) {
        idx += 1;
        const r1 = rng(idx * 5 + 1), r2 = rng(idx * 5 + 2), r3 = rng(idx * 5 + 3);
        const z = zLo + r1 * (zHi - zLo);
        const x = r2 * W;
        const near = z / C.FIELD_D;
        // 形状分布：多数是单叶，少数是丛与穗，避免整片同款
        let key = 'bladeA';
        if (r3 > 0.90) key = 'bladeS';
        else if (r3 > 0.68) key = 'bladeC';
        else if (r3 > 0.34) key = 'bladeB';
        const img = scene.add.image(x, 0, key).setOrigin(0.5, 1);
        // 尺寸：0.30~0.72，草大致到角色小腿到膝盖。
        // 叠加 ±18% 的随机高度，否则整片草像一排等高篱笆。
        const jitter = 0.82 + r3 * 0.36;
        const scale = (0.30 + near * 0.42) * jitter;
        img.setScale(scale);
        // 草是背景，不该抢角色的注意力。
        // 第一版 alpha 0.42~0.87 且用亮绿，结果整片草比主角还显眼。
        img.setAlpha(0.20 + near * 0.34);
        img.setDepth(1000 - z);
        // 略压暗色调，并让远处的草更淡（空气透视）
        img.setTint(near < 0.35 ? 0x6d8a58 : 0x8fae6e);
        blades.push({
          img: img, x: x, z: z,
          baseScale: scale,
          phase: r1 * 6.283,
          freq: 0.85 + r2 * 0.7,
          amp: (0.05 + r3 * 0.07) * (0.5 + near),
          depthT: near,
        });
      }
    }

    // 前景草：贴画面下缘的一层，比可走区域更靠前。
    // 它不参与游戏逻辑，只负责把画面下缘"封住"，避免草地上方悬空。
    for (let k = 0; k < 26; k++) {
      const r1 = rng(9000 + k * 3), r2 = rng(9001 + k * 3), r3 = rng(9002 + k * 3);
      const img = scene.add.image(r2 * W, HGT + 10, r3 > 0.5 ? 'bladeC' : 'bladeS')
        .setOrigin(0.5, 1);
      const scale = 1.35 + r1 * 0.75;
      img.setScale(scale).setAlpha(0.72).setDepth(4700);   // 在角色之前，盖住下缘
      img.setTint(0x4f6b42);
      blades.push({
        img: img, x: r2 * W, z: -30,
        baseScale: scale, phase: r1 * 6.283,
        freq: 1.1 + r2 * 0.5, amp: 0.10, depthT: 1.4, foreground: true,
      });
    }

    const state = { blades: blades, t: 0 };
    grassFields.set(scene, state);
    return state;
  }

  /** 每帧更新草。风用两道正弦，坡的相位差由 x 决定，于是风会"扫过"草地。 */
  function updateGrass(scene, dt) {
    const st = grassFields.get(scene);
    if (!st) return;
    st.t += dt;
    const t = st.t;
    for (let i = 0; i < st.blades.length; i++) {
      const b = st.blades[i];
      // 低频大风：波沿 x 推进，所以草是依次倒下的
      const gust = Math.sin(b.x * 0.0065 - t * 1.15 + b.depthT * 1.6);
      // 高频小抖：叶尖细节
      const flutter = Math.sin(t * 3.7 * b.freq + b.phase);
      const angle = gust * b.amp * 1.6 + flutter * b.amp * 0.55;
      b.img.setRotation(angle);
      // 风大时略微压扁，模拟被压弯
      const squash = 1 - Math.abs(angle) * 0.35;
      b.img.setScale(b.baseScale, b.baseScale * squash);
      // 前景草固定贴在画布下缘；其余随 z 贴地
      if (b.foreground) {
        b.img.setY(HGT + 10);
      } else {
        b.img.setY(GROUND_Y - b.z * Z_TO_Y + 4);
      }
    }
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
      const tree = scene.add.image(30 + i * 62 + (i % 3) * 9, y, key)
        .setOrigin(0.5, 1).setScale(sc).setAlpha(0.30 + depthT * 0.38)
        .setDepth(-900 + i);
      // 远树统一压暗并偏冷，制造空气透视；否则新加的细节会显得离得很近
      tree.setTint(depthT < 0.5 ? 0x2a3a30 : 0x3d5142);
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
    // 前景剪影：新灌木纹理有受光面和浆果，直接用会显得"飘"在草地上，
    // 而且 1.5~2.4 倍缩放会堵住整个下缘。剪影层应当更暗、更小、更靠下。
    for (let i = 0; mode !== 'farm' && i < 6; i++) {
      const bx = -10 + i * 180 + (i % 2) * 46;
      const img = scene.add.image(bx, HGT + 26, 'bush')
        .setOrigin(0.5, 1).setScale(1.15 + (i % 3) * 0.3)
        .setDepth(4800 + i);
      // 压成暗剪影：保持轮廓、去掉落差，才不会和明亮的草地抢注意力
      img.setTint(0x2a3a26);
      img.setAlpha(0.85);
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

    // 地面上的草（会随风摆动）。放在背景之后种，所以天然在背景之上。
    plantGrass(scene, mode);

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
        // 光池：给设施一个暖色地面反光。缩放与透明度都要克制，
        // 第一版 2.4~3.4 倍 + alpha 0.42 看起来像四个探照灯。
        const pool = this.add.image(z.x, y + 8, 'glow')
          .setScale(z.art === 'field' ? 1.5 : 1.15)
          .setAlpha(0.22)
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

      updateGrass(this, dt);

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

      this.effectGfx = this.add.graphics().setDepth(1050);

      this.shadow = this.add.image(0, 0, 'shadow').setDepth(1).setScale(0.8);
      this.hero = this.add.image(0, 0, 'hero').setDepth(100);
      // 主角与小怪在 1000-z（z∈[0,210] → 790~1000），
      // 刀光若放在 101 会被画在角色和怪物背后，等于看不见
      this.heroSwing = this.add.graphics().setDepth(1100);

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

      updateGrass(this, dt);

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
        const t = 1 - p.attackTimer / C.ATTACK_DURATION;
        // 三段用不同弧线、配色与厚度，让"打到第几段"一眼可辨：
        //   1 段 上挑（窄、白）　2 段 横扫（宽、青）　3 段 重劈（大、金 + 拖尾）
        const seg = p.comboSwingStep || 1;
        const main = seg === 1 ? 0xfffdf2 : (seg === 2 ? 0xc8ecff : 0xffd166);
        const edge = seg === 1 ? 0xffe9a8 : (seg === 2 ? 0x9ad7ff : 0xfff2c0);
        const cx = ps.sx, cy = ps.sy - 26 * ps.sc;
        const face = p.facing;
        const reach = p.comboRange || C.ATTACK_RANGE;
        const rOutX = reach * 1.08 * ps.sc;
        const rOutY = C.ATTACK_DEPTH * Z_TO_Y * (seg === 3 ? 1.06 : 0.92) * ps.sc;
        const rInX = rOutX * (seg === 3 ? 0.34 : 0.42);
        const rInY = rOutY * (seg === 3 ? 0.34 : 0.42);
        const sweep = seg === 1 ? 0.55 : (seg === 2 ? 1.15 : 1.45);
        const a0 = -sweep + t * sweep * 0.7, a1 = sweep + t * sweep * 0.7;

        const arcPts = (rx, ry) => {
          const out = [];
          for (let k = 0; k <= 14; k++) {
            const a = a0 + (a1 - a0) * (k / 14);
            out.push([cx + Math.cos(a) * rx * face, cy + Math.sin(a) * ry]);
          }
          return out;
        };
        const outer = arcPts(rOutX, rOutY);
        const inner = arcPts(rInX, rInY).reverse();
        const poly = outer.concat(inner);

        this.heroSwing.fillStyle(main, (seg === 3 ? 0.46 : 0.34) * (1 - t * 0.5));
        this.heroSwing.beginPath();
        this.heroSwing.moveTo(poly[0][0], poly[0][1]);
        for (let k = 1; k < poly.length; k++) this.heroSwing.lineTo(poly[k][0], poly[k][1]);
        this.heroSwing.closePath();
        this.heroSwing.fillPath();

        this.heroSwing.lineStyle((seg === 3 ? 4 : 2.5) * ps.sc, edge, 0.95 * (1 - t * 0.55));
        this.heroSwing.beginPath();
        this.heroSwing.moveTo(outer[0][0], outer[0][1]);
        for (let k = 1; k < outer.length; k++) this.heroSwing.lineTo(outer[k][0], outer[k][1]);
        this.heroSwing.strokePath();

        // 第三段额外拖尾：收招更重，视觉上要有分量
        if (seg === 3) {
          // 拖尾只画**已扫过的那一段**，且偏移很小。
          // 早期让拖尾覆盖整条弧并偏移 0.16 弧度，结果和主体连成一个"碗"。
          for (let d = 1; d <= 2; d++) {
            this.heroSwing.lineStyle((4.5 - d * 1.5) * ps.sc, edge, (0.12 / d) * (1 - t));
            this.heroSwing.beginPath();
            const from = 0.35;                       // 从弧的中段开始
            for (let k = 0; k <= 14; k++) {
              const f = from + (1 - from) * (k / 14);
              const a = a0 + (a1 - a0) * f - d * 0.055;
              const px = cx + Math.cos(a) * rOutX * (1 + d * 0.035) * face;
              const py = cy + Math.sin(a) * rOutY * (1 + d * 0.035);
              if (k === 0) this.heroSwing.moveTo(px, py);
              else this.heroSwing.lineTo(px, py);
            }
            this.heroSwing.strokePath();
          }
        }
      }

      // 小怪
      run.enemies.forEach((e, i) => {
        const sp = this.getEnemySprite(i, e.kind);
        const es = toScreen(e.x, e.z, e.h);
        sp.img.setVisible(true).setPosition(es.sx, es.sy).setScale(es.sc * ENEMY_SCALE);
        sp.img.setDepth(1000 - e.z);
        sp.img.setTint(e.hitFlash > 0 ? 0xffd0d0 : 0xffffff);
        // 精灵池按索引复用，而死亡循环会把槽位 alpha 压到接近 0。
        // 尸体被移除后，后面的敌人会顶进这个槽位并"继承"透明 ——
        // 结果是只有血条、看不见怪。必须在活体循环里每帧复位。
        sp.img.setAlpha(1);
        sp.shadow.setVisible(true).setPosition(es.sx, toScreen(e.x, e.z, 0).sy + 2)
          .setDepth(1000 - e.z - 1).setScale(es.sc * 0.62)
          .setAlpha(1);
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

      // ---- 掉落物：金币与种子要看得见，否则"走过去捡"这个机制等于不存在 ----
      if (!this.pickupPool) this.pickupPool = [];
      run.pickups.forEach((it, i) => {
        let sp = this.pickupPool[i];
        if (!sp) {
          sp = this.add.container(0, 0);
          sp.coinG = this.add.graphics();
          sp.seedImg = this.add.image(0, 0, 'sprout').setOrigin(0.5, 1).setScale(0.7);
          sp.add([sp.coinG, sp.seedImg]);
          this.pickupPool[i] = sp;
        }
        // 用 h 做真实的抛物线高度：东西是"抛出来"的，不是原地出现的
        const ps2 = toScreen(it.x, it.z, it.h || 0);
        const bob = it.grounded ? Math.sin(it.bob) * 2 : 0;
        sp.setVisible(true).setPosition(ps2.sx, ps2.sy + bob).setDepth(1000 - it.z + 3);
        sp.setAlpha(it.life < 3 ? (Math.floor(it.life * 8) % 2 ? 0.35 : 1) : 1);
        // 未落地时带一点旋转，落地后停正
        sp.setRotation(it.grounded ? 0 : (it.bob + (it.h || 0) * 0.05));
        sp.coinG.clear();
        sp.seedImg.setVisible(it.kind === 'seed');
        if (it.kind === 'coin') {
          const sq = it.grounded ? 1 : 0.55 + Math.min(1, (it.h || 0) / 26) * 0.45;
          sp.coinG.fillStyle(0xe8b04b, 1);
          sp.coinG.fillEllipse(0, -7, 15, 7 * sq);
          sp.coinG.fillStyle(0xffe08a, 1);
          sp.coinG.fillEllipse(0, -8.5, 15, 6.5 * sq);
          sp.coinG.fillStyle(0xf7ecc0, 1);
          sp.coinG.fillEllipse(-3, -10, 4, 2);
        } else {
          sp.seedImg.setY(-6 - (it.grounded ? 0 : Math.min(6, (it.h || 0) * 0.2)));
          sp.seedImg.setScale(0.9);
        }
      });
      for (let i = run.pickups.length; i < this.pickupPool.length; i++) {
        this.pickupPool[i].setVisible(false);
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
        const finishedDiff = run.diff.id;
        // restart：用同一难度重开一局。原文把 restart 列为游戏形态的必需项。
        global.EmberfieldUI.setAgainHandler(() => {
          L.returnToFarm(this.state);
          L.startRun(this.state, finishedDiff);
          global.EmberfieldUI.save(this.state);
          this.scene.restart();
        });
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

      // 与 Hub/Run 一致的调试钩子（无头探针与排障要用）
      global.EmberfieldApp.__scene = this;
      global.EmberfieldApp.__state = this.state;

      const CX = W / 2;
      // 近排在第 452，三排向上 96 一档 —— 整块田占住画面主体，
      // 之前放在 GROUND_Y+34 又被前景灌木盖住，几乎看不见
      const baseY = 452;

      // 几何来自 hub.farmLayout —— 同一份代码既用于绘制也用于命中判定，
      // 且能被 Node 测试覆盖（见 tests/test_game_meta.js）
      this.plotGeo = H.farmLayout(W, baseY);

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

      this.add.text(W - 24, 26, '点击空田播种　·　成熟后每局自动产出，无需收取　·　ESC 回基地', {
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
      return H.farmHitPlot(this.plotGeo, px, py);
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
          // 标签写清是"自动"，并加一个金币小图标暗示入账
          const label = this.add.text(geo.cx, geo.cy - geo.h / 2 - 4,
            '✓ 每局自动 +' + C.FARM.yieldPerPlot, {
              fontSize: '10px', color: '#e8b04b', fontFamily: 'sans-serif',
              backgroundColor: '#0b1117aa', padding: { x: 5, y: 2 },
            }).setOrigin(0.5, 1);
          this.hintLayer.add(label);

          // 飘起的金币数字：成熟田"正在产出"的持续提示
          const coin = this.add.text(geo.cx, geo.cy + geo.h * 0.1,
            '+' + C.FARM.yieldPerPlot, {
              fontSize: '11px', color: '#ffd166', fontFamily: 'sans-serif',
            }).setOrigin(0.5).setAlpha(0.9);
          this.cropLayer.add(coin);
          this.tweens.add({
            targets: coin, y: coin.y - 16, alpha: 0.25,
            duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.inOut',
          });
        } else {
          const label = this.add.text(geo.cx, geo.cy, '空', {
            fontSize: '11px', color: '#6b5a45', fontFamily: 'sans-serif',
          }).setOrigin(0.5);
          this.hintLayer.add(label);
        }
      });
    }

    tryPlant(idx) {
      const plot = this.state.farm.plots[idx];

      // 成熟田不需要"收取"：它在每局结束时自动按块数产出。
      // 之前点它会走 plant() 并弹出"这块田不是空的" —— 玩家由此以为
      // 有个"收取"动作被漏掉了。现在按状态给出正确的说明。
      if (plot && plot.state === 'mature') {
        this.flash('已成熟，每局结算自动产出 ' + C.FARM.yieldPerPlot +
                   ' 铜币，不需要收取', true);
        this.pulsePlot(idx);
        return;
      }
      if (plot && plot.state === 'growing') {
        const left = C.FARM.runsToMature - plot.growth;
        this.flash('生长中，再下地 ' + left + ' 局成熟', false);
        this.pulsePlot(idx);
        return;
      }

      const r = L.plant(this.state, idx);
      if (!r.ok) {
        this.flash(r.reason, false);
        return;
      }
      this.splashSoil(idx);          // 土块溅射：播种要有"翻土"的反馈
      global.EmberfieldUI.save(this.state);
      this.redrawField();
      this.refreshHud();
      this.flash('已播种', true);
    }

    /** 点田时的轻微反馈，让"点到了"看得见。 */
    pulsePlot(idx) {
      const geo = this.plotGeo[idx];
      if (!geo) return;
      const mark = this.add.ellipse(geo.cx, geo.cy, geo.w, geo.h)
        .setStrokeStyle(2.5, 0xffe07a, 0.9).setDepth(26);
      this.tweens.add({
        targets: mark, scaleX: 1.12, scaleY: 1.12, alpha: 0,
        duration: 420, onComplete: () => mark.destroy(),
      });
    }

    /**
     * 播种时的土粒溅射。用一次性 Graphics + 补间，不引入粒子系统，
     * 因为农场场景只需要几粒土，粒子系统在这里是过度的。
     */
    splashSoil(idx) {
      const geo = this.plotGeo[idx];
      if (!geo) return;
      const g = this.add.graphics().setDepth(25);
      const clods = [];
      for (let k = 0; k < 14; k++) {
        clods.push({
          x: geo.cx + (Math.random() - 0.5) * geo.w * 0.7,
          y: geo.cy + geo.h * 0.2,
          vx: (Math.random() - 0.5) * 130,
          vy: -70 - Math.random() * 110,
          size: 2 + Math.random() * 3,
          col: Math.random() < 0.5 ? 0x3b2c1d : 0x5a4530,
        });
      }
      let life = 0;
      const total = 0.55;
      const timer = this.time.addEvent({
        delay: 16, loop: true,
        callback: () => {
          life += 0.016;
          const dt2 = 0.016;
          g.clear();
          let alive = 0;
          clods.forEach((c) => {
            c.vy += 700 * dt2;
            c.x += c.vx * dt2;
            c.y += c.vy * dt2;
            if (c.y < geo.cy + geo.h * 0.55) {
              alive += 1;
              g.fillStyle(c.col, Math.max(0, 1 - life / total));
              g.fillRect(c.x, c.y, c.size, c.size);
            }
          });
          if (alive === 0 || life >= total) { timer.remove(); g.destroy(); }
        },
      });
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
        '作物需要 ' + C.FARM.runsToMature + ' 局成熟（输掉也算）\n' +
        '成熟后每局结算自动产出，不需要手动收取'
      );
    }

    leave() {
      if (this.busy) return;
      this.busy = true;
      global.EmberfieldUI.save(this.state);
      this.cameras.main.fadeOut(320, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Hub'));
    }

    update(time, delta) {
      updateGrass(this, Math.min((delta || 16) / 1000, 0.05));
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
                          buildTextures, toScreen, W, HGT,
                          plantGrass: plantGrass, updateGrass: updateGrass };
})(typeof globalThis !== 'undefined' ? globalThis : this);
