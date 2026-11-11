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

  // ================================================================ 主角装备分层
  /**
   * 主角渲染成一个 Container：底层是身体贴图，上面叠五层装备。
   *
   * 每一层都是**预烘好的静态贴图**，换装时只改 texture key，不重画。
   * 这样 Container 自带的 setAlpha（无敌帧闪烁）、setFlipX（左右镜像，
   * 用户明确要求主角也要有左右视图）、setScale（景深）都会自动作用到
   * 所有层上，不必每层各设一遍 —— 这正是用 Container 而不是每帧
   * Graphics.clear() 重画的原因。
   *
   * 层序（从下到上）：背部披风 → 躯干 → 脚 → 头 → 武器。
   * 身体贴图本身在 container 里位于所有层之下。
   */
  const EQUIP_LAYER_ORDER = ['back', 'torso', 'feet', 'head', 'weapon'];

  function makeHero(scene, depth) {
    const c = scene.add.container(0, 0);
    c.body_ = scene.add.image(0, 0, 'hero').setOrigin(0.5, 1);
    c.add(c.body_);
    c.layers_ = {};
    EQUIP_LAYER_ORDER.forEach((slot) => {
      const img = scene.add.image(0, 0, 'hero').setOrigin(0.5, 1).setVisible(false);
      c.layers_[slot] = img;
      c.add(img);
    });

    /*
     * Container **没有** setFlipX —— 那是 Image/Sprite 的方法。
     * 场景里仍在调 this.hero.setFlipX(...)，直接换成 container 会抛
     * "setFlipX is not a function"，整个 update 中断（表现为页面白屏、
     * 十几个看起来毫不相关的断言同时变红，正是这次踩到的形态）。
     *
     * 这里补一个同名方法：逐个子对象镜像。左右视图就是靠它实现的，
     * 所以每一层都必须跟着翻，不能只翻身体 —— 只翻身体会出现
     * "人朝左、剑还朝右"的穿帮。
     */
    c.flipped_ = false;
    c.setFlipX = function (flip) {
      const f = !!flip;
      if (c.flipped_ === f) return c;
      c.flipped_ = f;
      c.each(function (child) {
        if (child && typeof child.setFlipX === 'function') child.setFlipX(f);
      });
      return c;
    };
    return c.setDepth(depth);
  }

  /**
   * 头顶键帽：26x26 灰底圆角方块 + 一个黑色 J，贴在角色右上方。
   *
   * 为什么不是继续在地面写字：长文案（「按 J · 名字（提示）」）正好压在角色
   * 与设施的脚边，走到跟前就被自己挡住；而且名字越长那行字越宽，六处点位
   * 各写一行，画面上到处是黄字。键帽是一个固定的、离角色最近的提示符号。
   *
   * 尺寸写死 26x26、不随景深缩放：键帽是 UI，缩到 23px 反而糊。
   * 透明度从 0 开始（create 之后由 update 根据需要淡入），配合 setVisible
   * 让"没靠近"时它连绘制都省掉。
   */
  function makeKeycap(scene) {
    const c = scene.add.container(0, 0);
    const g = scene.add.graphics();
    g.fillStyle(0x5b616b, 1);                        // 键帽本体（灰）
    g.fillRoundedRect(-13, -13, 26, 26, 7);
    g.fillStyle(0x767e8b, 1);                        // 顶面高光：上半截更亮
    g.fillRoundedRect(-11, -11, 22, 12, 5);
    g.lineStyle(1.5, 0x22262c, 1);                   // 压边：从草地里拎出来
    g.strokeRoundedRect(-13, -13, 26, 26, 7);
    c.add(g);
    c.add(scene.add.text(0, 1, 'J', {
      fontFamily: 'monospace', fontSize: '15px', fontStyle: 'bold',
      color: '#11131a',
    }).setOrigin(0.5, 0.5));
    // 容器自己不带尺寸，getBounds() 只量得到里面那个 J 字（10x17），
    // 量不出键帽本体 —— 显式声明 26x26，测试与后续布局才有一个可读的尺寸。
    c.setSize(26, 26);
    // 角色 depth 是 1000 - hub.z（≈895），键帽必须高于它，否则被自己脑袋挡住
    return c.setDepth(1500).setVisible(false).setAlpha(0);
  }

  /**
   * 按当前 meta.equipment 刷新五层贴图。
   * 幂等：key 没变就不动贴图引用，换装时才真正切一次。
   */
  function refreshHeroEquip(hero, state) {
    if (!hero || !hero.layers_ || !state || !state.meta) return;
    const eq = state.meta.equipment || {};
    EQUIP_LAYER_ORDER.forEach((slot) => {
      const img = hero.layers_[slot];
      if (!img) return;
      const it = eq[slot];
      const key = it && it.id ? 'eq-' + slot + '-' + it.id : null;
      if (!key) {
        if (img.visible) img.setVisible(false);
        img.__key = null;
        return;
      }
      if (img.__key === key) return;
      img.setTexture(key).setVisible(true);
      // 新换上的层要立刻继承当前朝向。不设的话，在朝左时换装，
      // 新显示的那一层会是未镜像的右视图（"人朝左、装备朝右"）。
      if (hero.flipped_ !== undefined && typeof img.setFlipX === 'function') {
        img.setFlipX(hero.flipped_);
      }
      img.__key = key;
    });
  }

  /**
   * 画灼烧区与冰霜区。
   *
   * 都是 2.5D 的贴地椭圆，套用与角色相同的投影（越靠后越小越高），
   * 这样"站在圈里"看起来和角色处在同一片地面上，而不是浮在半空。
   * 半径按剩余时间收缩，玩家能看出它快灭了、该重新踩一次。
   */
  function drawZones(g, run) {
    const drawOne = (zn, inner, edge, pulse) => {
      const left = Math.max(zn.timer, 0);
      const k = zn.maxTimer > 0 ? left / zn.maxTimer : 1;
      const s = toScreen(zn.x, zn.z, 0);
      // 贴地椭圆：横向是真实半径，纵向压到 0.34 做出俯视角。
      const rx = zn.radius * s.sc * (0.72 + 0.28 * k);
      const ry = rx * 0.34;
      g.fillStyle(inner, 0.30 + 0.22 * pulse * k);
      g.fillEllipse(s.sx, s.sy, rx * 2, ry * 2);
      g.lineStyle(2.2 * s.sc, edge, 0.55 + 0.35 * pulse * k);
      g.strokeEllipse(s.sx, s.sy, rx * 2, ry * 2);
      // 内圈再补一层亮芯，让"危险区"在深色地面上也能读出来。
      g.fillStyle(edge, 0.16 + 0.16 * pulse * k);
      g.fillEllipse(s.sx, s.sy, rx * 1.1, ry * 1.1);
    };

    const pulse = 0.5 + 0.5 * Math.sin((run.elapsed || 0) * 6.0);
    (run.burnZones || []).forEach((zn) => drawOne(zn, 0xff7a3c, 0xffc266, pulse));
    (run.frostZones || []).forEach((fz) => {
      const left = Math.max(fz.timer, 0);
      const k = fz.maxTimer > 0 ? left / fz.maxTimer : 1;
      const s = toScreen(fz.x, fz.z, 0);
      const rx = fz.radius * s.sc * (0.72 + 0.28 * k);
      const ry = rx * 0.34;
      g.fillStyle(0x9ad7ff, 0.26 + 0.20 * pulse * k);
      g.fillEllipse(s.sx, s.sy, rx * 2, ry * 2);
      g.lineStyle(2.2 * s.sc, 0xdff2ff, 0.55 + 0.35 * pulse * k);
      g.strokeEllipse(s.sx, s.sy, rx * 2, ry * 2);
      // 冰面撒几道短裂纹，和火区分开（只靠颜色区分对色弱玩家不友好）
      g.lineStyle(1.6 * s.sc, 0xffffff, 0.42);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + fz.x * 0.01;
        const r0 = rx * 0.30, r1 = rx * 0.78;
        g.beginPath();
        g.moveTo(s.sx + Math.cos(a) * r0, s.sy + Math.sin(a) * r0 * 0.34);
        g.lineTo(s.sx + Math.cos(a) * r1, s.sy + Math.sin(a) * r1 * 0.34);
        g.strokePath();
      }
    });
  }

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

    /*
     * ---- 装备分层贴图 ----
     *
     * 每件装备都**预先烘成一张静态贴图**，运行时只切换 image 的 texture key。
     * 不用"每帧 Graphics.clear()+重画"是因为：60fps 下每帧重画五层矢量
     * 会稳定掉帧，而且会和无敌帧的 setAlpha 闪烁、左右镜像的 setFlipX
     * 打架（clear 之后这些状态需要重设，很容易漏）。
     *
     * 坐标系与 hero 一致：40×60，底边是脚（origin 0.5,1），y 越小越靠上。
     * 贴图只画**右视图**，左视图靠 setFlipX 镜像 ——
     * 这正是"主角也要做左右视图"的做法。
     */
    const equipLayer = (key, draw) => {
      g.clear();
      draw(g);
      g.generateTexture(key, 40, 60);
    };

    // 头部：头盔 / 兜帽，套在头上（头顶约 y=10~26）
    equipLayer('eq-head-leatherHelm', (d) => {
      d.fillStyle(0x7a5230, 1); d.fillRoundedRect(10, 12, 20, 13, 5);
      d.fillStyle(0x8f6238, 1); d.fillRoundedRect(11, 12, 18, 5, 3);
    });
    equipLayer('eq-head-ironHelm', (d) => {
      d.fillStyle(0x8b949e, 1); d.fillRoundedRect(9, 11, 22, 14, 5);
      d.fillStyle(0xa8b1bb, 1); d.fillRoundedRect(10, 11, 20, 5, 3);
      d.fillStyle(0x5d666f, 1); d.fillRect(19, 12, 2.5, 13);
    });
    equipLayer('eq-head-guardHelm', (d) => {
      d.fillStyle(0x77808a, 1); d.fillRoundedRect(9, 11, 22, 14, 5);
      d.fillStyle(0x99a2ac, 1); d.fillRoundedRect(10, 11, 20, 5, 3);
      d.fillStyle(0xc9d2dc, 1); d.fillTriangle(30, 16, 36, 20, 30, 25);   // 护鼻
    });
    equipLayer('eq-head-hornHelm', (d) => {
      d.fillStyle(0x6e7782, 1); d.fillRoundedRect(9, 11, 22, 14, 5);
      d.fillStyle(0x8d96a1, 1); d.fillRoundedRect(10, 11, 20, 5, 3);
      d.fillStyle(0xe6e0cc, 1);                                        // 双角
      d.fillTriangle(11, 12, 4, 4, 12, 8);
      d.fillTriangle(29, 12, 36, 4, 28, 8);
    });
    equipLayer('eq-head-thunderHelm', (d) => {
      d.fillStyle(0x6e7782, 1); d.fillRoundedRect(9, 11, 22, 14, 5);
      d.fillStyle(0x8d96a1, 1); d.fillRoundedRect(10, 11, 20, 5, 3);
      d.fillStyle(0xffe066, 1); d.fillTriangle(20, 4, 16, 14, 24, 14);   // 电冠
    });

    // 躯干：胸甲 / 外衣（身体约 y=26~44）
    equipLayer('eq-torso-leatherVest', (d) => {
      d.fillStyle(0x8a5f34, 1); d.fillRoundedRect(11, 26, 19, 17, 4);
      d.fillStyle(0xa07042, 1); d.fillRect(20, 26, 2, 17);
    });
    equipLayer('eq-torso-chestPlate', (d) => {
      d.fillStyle(0x9aa3ad, 1); d.fillRoundedRect(10, 25, 21, 18, 5);
      d.fillStyle(0xc2cbd5, 1); d.fillRoundedRect(11, 25, 19, 5, 3);
      d.fillStyle(0x6d757e, 1); d.fillRect(20, 26, 2, 17);
    });
    equipLayer('eq-torso-pauldron', (d) => {
      d.fillStyle(0x8b949e, 1); d.fillRoundedRect(10, 25, 21, 18, 5);
      d.fillStyle(0xb4bdc7, 1); d.fillCircle(9, 28, 6); d.fillCircle(31, 28, 6);
    });
    equipLayer('eq-torso-fullPlate', (d) => {
      d.fillStyle(0xa9b2bc, 1); d.fillRoundedRect(9, 24, 23, 20, 6);
      d.fillStyle(0xd2dbe5, 1); d.fillRoundedRect(10, 24, 21, 6, 3);
      d.fillStyle(0x7c848d, 1); d.fillRect(20, 25, 2, 19);
      d.fillStyle(0xd2dbe5, 1); d.fillCircle(8, 27, 6); d.fillCircle(32, 27, 6);
    });
    equipLayer('eq-torso-thornMail', (d) => {
      d.fillStyle(0x4a4038, 1); d.fillRoundedRect(10, 25, 21, 18, 5);
      d.fillStyle(0xb06a52, 1);                                       // 尖刺
      for (let i = 0; i < 5; i++) d.fillTriangle(11 + i * 4.5, 26, 9 + i * 4.5, 19, 13 + i * 4.5, 19);
    });
    equipLayer('eq-torso-frostArmor', (d) => {
      d.fillStyle(0x4a6a86, 1); d.fillRoundedRect(10, 25, 21, 18, 5);
      d.fillStyle(0x9ad7ff, 0.9); d.fillRoundedRect(11, 25, 19, 5, 3);  // 霜层
      d.fillStyle(0xd8f0ff, 1);
      d.fillTriangle(14, 26, 11, 34, 17, 34);                           // 冰棱
      d.fillTriangle(26, 26, 23, 36, 29, 36);
    });
    equipLayer('eq-torso-aegisPlate', (d) => {
      d.fillStyle(0x9aa3ad, 1); d.fillRoundedRect(10, 25, 21, 18, 5);
      d.fillStyle(0x9ad7ff, 0.85); d.fillCircle(20.5, 34, 5.5);        // 蓝核
      d.fillStyle(0xd8f0ff, 0.9); d.fillCircle(20.5, 34, 2.4);
    });

    // 背部：披风 / 斗篷（画在身体后面，y=24~48）
    equipLayer('eq-back-shortCape', (d) => {
      d.fillStyle(0x5d6b46, 1); d.fillRoundedRect(8, 27, 24, 13, 4);
    });
    equipLayer('eq-back-longCloak', (d) => {
      d.fillStyle(0x3f4a58, 1); d.fillRoundedRect(7, 26, 26, 22, 5);
      d.fillStyle(0x536072, 1); d.fillRect(19, 26, 3, 22);
    });
    equipLayer('eq-back-runeCloak', (d) => {
      d.fillStyle(0x404a72, 1); d.fillRoundedRect(7, 26, 26, 22, 5);
      d.fillStyle(0x9ad7ff, 0.9); d.fillCircle(20, 36, 4);             // 符文核
      d.fillStyle(0xd8f0ff, 0.9); d.fillCircle(20, 36, 1.6);
    });
    equipLayer('eq-back-wingCape', (d) => {
      d.fillStyle(0x6b4f7a, 1); d.fillRoundedRect(7, 26, 26, 22, 5);
      d.fillStyle(0xc9a6ff, 0.85);                                     // 翼形
      d.fillTriangle(8, 27, 0, 30, 9, 36);
      d.fillTriangle(32, 27, 40, 30, 31, 36);
    });
    equipLayer('eq-back-bloodCharm', (d) => {
      d.fillStyle(0x5a2a2a, 1); d.fillRoundedRect(9, 28, 22, 16, 5);
      d.fillStyle(0xc23a3a, 1); d.fillCircle(20, 36, 5.5);             // 血滴
      d.fillStyle(0xff8a8a, 0.95); d.fillCircle(18, 34, 2);
    });
    equipLayer('eq-back-cinderCloak', (d) => {
      d.fillStyle(0x5a3b30, 1); d.fillRoundedRect(7, 26, 26, 22, 5);
      d.fillStyle(0xff9a6c, 1);                                        // 余烬
      for (let i = 0; i < 4; i++) d.fillCircle(10 + i * 6.5, 40 - (i % 2) * 5, 2.2);
    });
    equipLayer('eq-head-stormRing', (d) => {
      // 暴风指环实际是**头部**装备（配置里 slot:'head'）。
      // 首版按"指环"直觉画在背部，贴图 key 与 slot 对不上，
      // 结果这件装备穿上后什么都不显示。
      d.fillStyle(0x3a4a5e, 1); d.fillRoundedRect(9, 13, 22, 6, 3);     // 头箍
      d.fillStyle(0x9ad7ff, 1); d.fillCircle(20, 11, 4.5);              // 顶上雷珠
      d.fillStyle(0xd8f0ff, 0.95); d.fillCircle(20, 11, 1.8);
      d.fillStyle(0xffe066, 1);
      d.fillTriangle(26, 13, 33, 9, 27, 17);                            // 小雷弧
    });

    // 武器：画在右手侧
    equipLayer('eq-weapon-rustySword', (d) => {
      d.fillStyle(0x8a7355, 1); d.fillRect(31, 22, 3.5, 26);
      d.fillStyle(0xa08a68, 1); d.fillRect(31, 22, 1.4, 26);
    });
    equipLayer('eq-weapon-shortSword', (d) => {
      d.fillStyle(0xc2cbd5, 1); d.fillRect(31, 20, 3.5, 28);
      d.fillStyle(0xe8f2fa, 1); d.fillRect(31, 20, 1.4, 28);
      d.fillStyle(0x2b2016, 1); d.fillRect(29, 47, 8, 4);
    });
    equipLayer('eq-weapon-broadSword', (d) => {
      d.fillStyle(0xcdd6e0, 1); d.fillRect(30, 16, 6, 32);
      d.fillStyle(0xeff6fc, 1); d.fillRect(30, 16, 2, 32);
      d.fillStyle(0x2b2016, 1); d.fillRect(28, 47, 10, 4.5);
    });
    equipLayer('eq-weapon-twinBlades', (d) => {
      d.fillStyle(0xd2dbe5, 1);
      d.fillRect(29, 22, 3, 25); d.fillRect(35, 24, 3, 23);            // 双刀
      d.fillStyle(0x2b2016, 1); d.fillRect(28, 46, 5, 3.5); d.fillRect(34, 46, 5, 3.5);
    });
    equipLayer('eq-weapon-crystalStaff', (d) => {
      d.fillStyle(0x6b5439, 1); d.fillRect(31, 20, 3.5, 29);
      d.fillStyle(0xc9a6ff, 1); d.fillCircle(32.5, 17, 5);             // 棱晶
      d.fillStyle(0xe8dcff, 0.9); d.fillCircle(31.5, 16, 2);
    });
    equipLayer('eq-weapon-battleAxe', (d) => {
      d.fillStyle(0x6b5439, 1); d.fillRect(31, 20, 3.5, 29);
      d.fillStyle(0xb9c2cc, 1); d.fillTriangle(35, 20, 46, 26, 35, 34);
      d.fillStyle(0xd8e0e8, 1); d.fillTriangle(35, 21, 43, 26, 35, 31);
    });
    equipLayer('eq-weapon-voidBlade', (d) => {
      d.fillStyle(0x4a3566, 1); d.fillRect(30, 16, 5, 32);
      d.fillStyle(0xc9a6ff, 1); d.fillRect(30, 16, 1.8, 32);
      d.fillStyle(0x2b1f3a, 1); d.fillRect(28, 47, 9, 4.5);
    });
    equipLayer('eq-weapon-trident', (d) => {
      d.fillStyle(0x6b5439, 1); d.fillRect(31, 26, 3.5, 23);
      d.fillStyle(0xd2dbe5, 1);
      d.fillRect(29, 14, 2.5, 14); d.fillRect(32.5, 12, 2.5, 16); d.fillRect(36, 14, 2.5, 14);
      d.fillRect(27, 26, 13, 2.5);
    });
    equipLayer('eq-weapon-oathkeeper', (d) => {
      d.fillStyle(0xe0d6a8, 1); d.fillRect(30, 16, 5, 32);             // 圣剑
      d.fillStyle(0xfff6cc, 1); d.fillRect(30, 16, 2, 32);
      d.fillStyle(0x9a8a4c, 1); d.fillRect(27, 46, 11, 5);
      d.fillStyle(0xffe066, 1); d.fillCircle(32.5, 14, 3.6);
    });
    equipLayer('eq-weapon-arcaneTome', (d) => {
      d.fillStyle(0x3f5a7a, 1); d.fillRoundedRect(29, 30, 11, 13, 2);  // 书
      d.fillStyle(0x8fb8e0, 1); d.fillRoundedRect(30, 31, 9, 11, 2);
      d.fillStyle(0xc9a6ff, 1); d.fillCircle(34.5, 36.5, 2.6);
    });

    // 脚部：靴子（y=48~60）
    equipLayer('eq-feet-strawShoes', (d) => {
      d.fillStyle(0xb99a5e, 1); d.fillRoundedRect(11, 50, 19, 8, 3);
    });
    equipLayer('eq-feet-windBoots', (d) => {
      d.fillStyle(0x5f7a52, 1); d.fillRoundedRect(10, 49, 21, 9, 3);
      d.fillStyle(0x7fa06c, 1); d.fillRect(10, 49, 21, 3);
    });
    equipLayer('eq-feet-greaves', (d) => {
      d.fillStyle(0x8b949e, 1); d.fillRoundedRect(10, 48, 21, 10, 3);
      d.fillStyle(0xb4bdc7, 1); d.fillRect(10, 48, 21, 3.5);
    });
    equipLayer('eq-feet-stoneBoots', (d) => {
      d.fillStyle(0x6e7782, 1); d.fillRoundedRect(9, 47, 23, 11, 4);
      d.fillStyle(0x939ca7, 1); d.fillRoundedRect(10, 47, 21, 4, 2);
    });
    equipLayer('eq-feet-emberBoots', (d) => {
      d.fillStyle(0x7a4636, 1); d.fillRoundedRect(10, 49, 21, 9, 3);
      d.fillStyle(0xff9a6c, 1); d.fillCircle(13, 52, 2.4); d.fillCircle(28, 52, 2.4);
    });
    equipLayer('eq-feet-phaseBoots', (d) => {
      d.fillStyle(0x4a4a72, 1); d.fillRoundedRect(10, 49, 21, 9, 3);
      d.fillStyle(0xc9a6ff, 1); d.fillRoundedRect(10, 49, 21, 3, 2);
    });


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

    /**
     * 药水铺：摊位 + 条纹雨棚 + 三个药瓶。
     *
     * 轮廓上必须和铁匠铺（矮、方、石头）完全不同 ——
     * 玩家是靠剪影找建筑的，颜色接近的两堆方块在景深压缩后会糊成一团。
     * 这里用"高窄的帐篷顶 + 三个圆润瓶子"制造辨识度：
     * 圆瓶是全身唯一的圆形元素，眼睛会自动抓过去。
     */
    g.clear();
    // 木柜台
    g.fillStyle(0x4a3726, 1); g.fillRoundedRect(6, 40, 68, 26, 4);
    g.fillStyle(0x5c452f, 1); g.fillRoundedRect(6, 40, 68, 7, 3);
    // 台面物件：三个瓶子（绿 / 橙 / 蓝，对应三种药水）
    g.fillStyle(0x2f5a38, 1); g.fillRoundedRect(15, 26, 12, 15, 4);
    g.fillStyle(0x7fe08a, 0.9); g.fillRoundedRect(17, 33, 8, 7, 3);
    g.fillStyle(0x5a3a22, 1); g.fillRoundedRect(33, 24, 12, 17, 4);
    g.fillStyle(0xff9a6c, 0.9); g.fillRoundedRect(35, 32, 8, 8, 3);
    g.fillStyle(0x24384f, 1); g.fillRoundedRect(51, 27, 12, 14, 4);
    g.fillStyle(0x9ad7ff, 0.9); g.fillRoundedRect(53, 33, 8, 7, 3);
    // 瓶塞
    g.fillStyle(0x8a7355, 1); g.fillRect(19, 23, 4, 4);
    g.fillRect(37, 21, 4, 4); g.fillRect(55, 24, 4, 4);
    // 雨棚：红白条纹，是最强的远距离识别特征
    g.fillStyle(0x7a2f28, 1); g.fillTriangle(0, 14, 80, 14, 40, 0);
    g.fillStyle(0xc4453a, 1);
    for (let i = 0; i < 4; i++) {
      const bx = 40 + (i - 1.5) * 20;
      g.fillTriangle(40, 0, bx - 5, 14, bx + 5, 14);
    }
    g.fillStyle(0xf0e6d2, 0.85);
    for (let i = 0; i < 3; i++) {
      const bx = 40 + (i - 1) * 20;
      g.fillTriangle(40, 0, bx - 4, 14, bx + 4, 14);
    }
    // 支柱
    g.fillStyle(0x3a2a1c, 1); g.fillRect(2, 14, 4, 28); g.fillRect(74, 14, 4, 28);
    g.generateTexture('shop', 80, 68);

    /*
     * 兵器架（装备商店）。
     * 剪影必须和铁匠铺（矮方石头）、药水铺（尖顶帐篷）都不同 ——
     * 这里用"横向长架上斜插的几把武器"，是全身唯一带**多根细长斜线**
     * 的建筑，远景压缩后靠这个轮廓区分，不靠颜色。
     */
    g.clear();
    // 石台
    g.fillStyle(0x2b313a, 1); g.fillRoundedRect(2, 52, 86, 16, 4);
    g.fillStyle(0x39404a, 1); g.fillRoundedRect(2, 52, 86, 6, 3);
    // 两根立柱 + 横梁
    g.fillStyle(0x5a4630, 1); g.fillRect(10, 18, 6, 36); g.fillRect(74, 18, 6, 36);
    g.fillStyle(0x6b5439, 1); g.fillRoundedRect(6, 14, 78, 7, 3);
    // 斜插的武器：剑 / 斧 / 杖，各自不同色，靠形状区分
    // 长剑
    g.fillStyle(0xd8dde4, 1); g.fillRect(26, 20, 4, 26);
    g.fillStyle(0x8a7355, 1); g.fillRect(23, 44, 10, 4);
    // 战斧
    g.fillStyle(0x9aa3ad, 1); g.fillRect(45, 22, 4, 26);
    g.fillStyle(0xb9c2cc, 1); g.fillTriangle(49, 22, 63, 29, 49, 36);
    // 法杖：顶端一颗宝石，模仿棱晶杖
    g.fillStyle(0x6b5439, 1); g.fillRect(66, 22, 4, 26);
    g.fillStyle(0xc9a6ff, 1); g.fillCircle(68, 18, 5);
    g.fillStyle(0xe8dcff, 0.8); g.fillCircle(67, 17, 2);
    // 挂着的头盔，进一步强化"这里是卖装备的"
    g.fillStyle(0x7a828c, 1); g.fillRoundedRect(14, 22, 14, 12, 4);
    g.fillStyle(0x9aa3ad, 1); g.fillRect(14, 31, 14, 3);
    g.generateTexture('rack', 90, 70);

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
  /**
   * 输入层。**不依赖 Phaser 的键盘插件**，直接监听 DOM 事件。
   *
   * 为什么不用 scene.input.keyboard.addKeys()：
   *   1. Shift 检测不到 —— Phaser 的 key 名 'SHIFT' 与实际按键
   *      'ShiftLeft' / 'ShiftRight' 对不上，导致冲刺完全无效（实测 0 px/s）。
   *   2. 长按会掉速 —— Phaser 的 isDown 在浏览器重复触发 keydown 时
   *      状态会被重置，长按 3 秒后速度从 250 掉到 57 px/s（实测）。
   *
   * 自己维护一个 keydown/keyup 集合，语义直白且可测。
   */
  function createInput(scene) {
    const down = Object.create(null);

    const CODES = {
      KeyW: 'up', ArrowUp: 'up',
      KeyS: 'down', ArrowDown: 'down',
      KeyA: 'left', ArrowLeft: 'left',
      KeyD: 'right', ArrowRight: 'right',
      Space: 'jump',
      KeyJ: 'attack', KeyJConfirm: 'confirm',
      ShiftLeft: 'sprint', ShiftRight: 'sprint',
      KeyU: 'whirl', KeyI: 'blink', KeyO: 'slam', KeyK: 'cry', KeyL: 'nova',
      // V：武器专属技能（誓约剑的格挡 / 秘法典的二段闪）。
      // 只有装了带 grantSkill 的武器才有这个技能，没装时按键无效。
      KeyV: 'special',
      Digit1: 'potion1', Digit2: 'potion2', Digit3: 'potion3',
      Numpad1: 'potion1', Numpad2: 'potion2', Numpad3: 'potion3',
      Escape: 'esc',
      // Tab：开/关背包（Task 9）。
      // 它**不能**像别的键那样只写进 down 表等 update() 去读：背包打开后
      // scene.pause() 会停掉该场景的 update()，第二次按 Tab 就再也没人处理，
      // 背包永远关不掉（自锁）。所以下面 onDown 里立刻调用 scene.toggleBag()。
      Tab: 'bag',
    };

    const onDown = (ev) => {
      const name = CODES[ev.code];
      if (!name) return;
      // 阻止空格滚动页面、Shift 触发浏览器快捷键；
      // Tab 必须一起拦：不拦的话浏览器会把焦点跳到 DOM 按钮上，
      // 之后的按键全被那个按钮吃掉，游戏像死了一样（实测）。
      if (ev.code === 'Space' || ev.code.startsWith('Shift') || ev.code === 'Tab') ev.preventDefault();
      if (name === 'bag') {
        // 边沿动作，当场执行，不进 down 表 —— 开启后本场景 update() 已停，
        // 读按键表的那条路径走不到。window 监听不受 scene.pause() 影响，
        // 所以"再按一次 Tab 关掉"始终有效。
        if (typeof scene.toggleBag === 'function') scene.toggleBag();
        return;
      }
      down[name] = true;
      down['confirm'] = down['confirm'] || name === 'attack';
    };
    const onUp = (ev) => {
      const name = CODES[ev.code];
      if (!name) return;
      down[name] = false;
      if (name === 'attack') down['confirm'] = false;
    };
    // 失焦时清空：否则切出去再回来会"卡键"，角色一直往一个方向跑
    const onBlur = () => { for (const k in down) down[k] = false; };

    window.addEventListener('keydown', onDown, { passive: false });
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);

    scene.events.once('shutdown', () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    });

    // 边沿检测：上一帧没按、这一帧按了。用于"按一下触发一次"的操作。
    const prev = Object.create(null);
    const pressed = Object.create(null);
    const justPressed = (name) => {
      const now = !!down[name];
      const was = !!prev[name];
      prev[name] = now;
      return now && !was;
    };

    // 药水是**边沿触发**：长按 1 不能把三瓶治疗一次喝光。
    // 这里在 read() 内部消费边沿，read() 每帧只调一次，语义与"按一下喝一瓶"一致。
    const potionEdge = (name) => {
      const now = !!down[name];
      const was = !!prevPotion[name];
      prevPotion[name] = now;
      return now && !was;
    };
    const prevPotion = Object.create(null);

    /*
     * 专属技能（V）同样走**边沿触发**。
     *
     * 上面五个技能用的是按住状态（!!down.whirl），因为它们冷却很短、
     * 按住连发是符合预期的。但 V 的冷却长达 9~12 秒：如果也用按住状态，
     * 玩家按一下不松手，冷却一归零就会立刻自动再放一次 —— 手感上像
     * "技能自己乱放"，而不是自己按出来的。
     */
    const specialEdge = () => {
      const now = !!down.special;
      const was = !!prevSpecial.special;
      prevSpecial.special = now;
      return now && !was;
    };
    const prevSpecial = Object.create(null);

    const read = () => ({
      up: !!down.up, down: !!down.down,
      left: !!down.left, right: !!down.right,
      jump: !!down.jump, attack: !!down.attack, sprint: !!down.sprint,
      whirl: !!down.whirl, blink: !!down.blink, slam: !!down.slam,
      cry: !!down.cry, nova: !!down.nova,
      special: specialEdge(),
      potion1: potionEdge('potion1'),
      potion2: potionEdge('potion2'),
      potion3: potionEdge('potion3'),
      confirm: !!down.attack, esc: !!down.esc,
    });

    return { read: read, isDown: (n) => !!down[n], justPressed: justPressed };
  }

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
  // ================================================================ 背景
  /**
   * 场景主题表。配色从硬编码的 isHub 三元表达式改成数据，
   * 于是加一种地图风格就是加一条记录，不用改绘制逻辑。
   *
   * Boss 三档各有自己的地貌：普通是荒野、困难是密林、地狱是熔岩。
   * 玩家一进场就该看出自己在打哪一档。
   */
  const THEMES = {
    hub: {
      skyTop: [16, 24, 33], skyBot: [58, 74, 82],
      ridge: [0x1b2b32, 0x22343a, 0x2a3d3c],
      groundA: 0x2b3a2c, groundB: 0x33452f,
      road: 0x4a4030, roadAlpha: 0.38,
      treeTint: [0x2a3a30, 0x3d5142],
      fence: true, trees: true, grass: true,
    },
    run: {
      skyTop: [26, 16, 20], skyBot: [92, 52, 40],
      ridge: [0x2a1e22, 0x33241f, 0x3d2b22],
      groundA: 0x2a2320, groundB: 0x352a24,
      road: 0x4a3a2c, roadAlpha: 0.38,
      treeTint: [0x2a3a30, 0x3d5142],
      fence: true, trees: true, grass: true,
    },
    farm: {
      skyTop: [26, 16, 20], skyBot: [92, 52, 40],
      ridge: [0x2a1e22, 0x33241f, 0x3d2b22],
      groundA: 0x2a2320, groundB: 0x352a24,
      road: 0, roadAlpha: 0,
      treeTint: [0x2a3a30, 0x3d5142],
      fence: false, trees: false, grass: false, soil: true,
    },
    // ---- Boss 地图：三档三风格 ----
    bossNormal: {
      // 普通：干裂荒野。灰褐枯木的地盘，天色昏暗。
      skyTop: [22, 22, 26], skyBot: [78, 70, 58],
      ridge: [0x2e2a24, 0x3a352c, 0x474034],
      groundA: 0x2e2a22, groundB: 0x3a3428,
      road: 0x4a4030, roadAlpha: 0.30,
      treeTint: [0x3a3428, 0x4a4234],
      fence: true, trees: true, grass: true, deadTrees: true,
    },
    bossHard: {
      // 困难：茂密密林。翠绿藤蔓的地盘，绿意过盛。
      skyTop: [14, 26, 20], skyBot: [58, 92, 62],
      ridge: [0x1c2e20, 0x24402a, 0x2e5236],
      groundA: 0x24301f, groundB: 0x2e4026,
      road: 0x3a4a2c, roadAlpha: 0.34,
      treeTint: [0x2e5236, 0x3d6b44],
      fence: true, trees: true, grass: true, lushTrees: true,
    },
    bossHell: {
      // 地狱：熔岩地貌 + 火山背景。暗红荆棘的地盘。
      skyTop: [26, 10, 10], skyBot: [120, 40, 20],
      ridge: [0x2e1410, 0x3e1a12, 0x4e2216],
      groundA: 0x241412, groundB: 0x301a14,
      road: 0x5a2a1a, roadAlpha: 0.42,
      treeTint: [0x2a1210, 0x3a1a14],
      fence: false, trees: false, grass: false,
      volcano: true, lava: true,
    },
  };

  function paintBackdrop(scene, mode) {
    const th = THEMES[mode] || THEMES.run;
    const isHub = mode === 'hub';
    const g = scene.add.graphics().setDepth(-1000);

    // ---- 天空：四段渐变，比两段有明显更深的纵深 ----
    const skyTop = th.skyTop;
    const skyBot = th.skyBot;
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
      { base: 250, amp: 34, col: th.ridge[0], alpha: 0.85 },
      { base: 286, amp: 26, col: th.ridge[1], alpha: 0.9 },
      { base: 318, amp: 18, col: th.ridge[2], alpha: 1 },
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
    for (let i = 0; th.trees && i < 16; i++) {
      const key = i % 3 === 1 ? 'treeB' : 'treeA';
      const depthT = (i % 4) / 3;                     // 0..1
      const sc = 0.62 + depthT * 0.5;
      const y = zFar + 6 + depthT * 26;
      const tree = scene.add.image(30 + i * 62 + (i % 3) * 9, y, key)
        .setOrigin(0.5, 1).setScale(sc).setAlpha(0.30 + depthT * 0.38)
        .setDepth(-900 + i);
      // 远树统一压暗，制造空气透视。色调按主题：
      // 普通档偏枯黄、困难档偏翠绿、地狱档不画树（画火山与熔岩）。
      tree.setTint(depthT < 0.5 ? th.treeTint[0] : th.treeTint[1]);
    }

    // ---- 地面：景深带 + 横向分道，让"能前后走"看得见 ----
    g.fillStyle(th.groundA, 1);
    g.fillRect(0, zFar, W, HGT - zFar);
    g.fillStyle(th.groundB, 1);
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
    if (th.road) {
    g.fillStyle(th.road, th.roadAlpha);
    const roadY = GROUND_Y - 46;
    for (let x = 0; x < W; x += 60) {
      g.fillRoundedRect(x, roadY + Math.sin(x * 0.02) * 3, 62, 26, 8);
    }
    }

    // ---- 围栏：沿景深带后缘一排木桩 ----
    for (let x = 8; th.fence && x < W; x += 26) {
      scene.add.image(x, zFar + 4, 'post').setOrigin(0.5, 1)
        .setScale(0.9).setAlpha(0.55).setDepth(-700);
    }

    // ---- 火山（地狱档）：远处一座活火山，带喷发与熔岩流 ----
    if (th.volcano) {
      const vx = W * 0.72, vbase = zFar + 8;
      // 山体：两层三角，外暗内亮
      g.fillStyle(0x1e0e0a, 1);
      g.beginPath();
      g.moveTo(vx - 200, vbase); g.lineTo(vx, vbase - 210); g.lineTo(vx + 200, vbase);
      g.closePath(); g.fillPath();
      g.fillStyle(0x2a1410, 1);
      g.beginPath();
      g.moveTo(vx - 150, vbase); g.lineTo(vx, vbase - 175); g.lineTo(vx + 150, vbase);
      g.closePath(); g.fillPath();
      // 火山口：炽热的橙红
      g.fillStyle(0xff5a2a, 0.85);
      g.beginPath();
      g.moveTo(vx - 26, vbase - 196); g.lineTo(vx, vbase - 210); g.lineTo(vx + 26, vbase - 196);
      g.lineTo(vx + 16, vbase - 184); g.lineTo(vx - 16, vbase - 184);
      g.closePath(); g.fillPath();
      g.fillStyle(0xffd08a, 0.7);
      g.fillEllipse(vx, vbase - 194, 30, 8);
      // 熔岩流：从火山口沿山体流下的三条
      [0.35, 0.5, 0.62].forEach((f, i) => {
        g.fillStyle(i === 1 ? 0xff7a3c : 0xe8532a, 0.75);
        g.beginPath();
        g.moveTo(vx - 8 + i * 12, vbase - 186);
        g.lineTo(vx - 20 + i * 26, vbase - 60);
        g.lineTo(vx - 12 + i * 26, vbase - 58);
        g.lineTo(vx + 2 + i * 12, vbase - 186);
        g.closePath(); g.fillPath();
      });
      // 上升的火山灰
      for (let i = 0; i < 22; i++) {
        const px = vx + Math.sin(i * 2.7) * 90;
        const py = vbase - 210 - ((i * 37) % 180);
        g.fillStyle(0x3a2018, 0.5 - ((i * 37) % 180) / 500);
        g.fillCircle(px, py, 3 + (i % 3) * 2);
      }
    }

    // ---- 熔岩（地狱档）：地面上流动的裂隙 ----
    if (th.lava) {
      const laneY = GROUND_Y - 30;
      for (let x = 0; x < W; x += 46) {
        const wob = Math.sin(x * 0.021) * 8;
        // 外层暗红
        g.fillStyle(0x6a1e0e, 0.55);
        g.fillEllipse(x + 23, laneY + wob, 54, 15);
        // 内层炽热
        g.fillStyle(0xff5a2a, 0.42);
        g.fillEllipse(x + 23, laneY + wob, 38, 9);
        // 核心亮黄
        g.fillStyle(0xffc46a, 0.30);
        g.fillEllipse(x + 23, laneY + wob, 20, 4);
      }
      // 地表的火星（静态点，动态的由 ember 粒子负责）
      for (let i = 0; i < 40; i++) {
        const px = (i * 137) % W;
        const py = GROUND_Y - ((i * 53) % 120);
        g.fillStyle(0xff9a5c, 0.35);
        g.fillCircle(px, py, 1.4 + (i % 3) * 0.8);
      }
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

    // 地狱档：火星更多更密，因为熔岩地貌本身就该飘着灰烬
    const emberFreq = th.lava ? 55 : 130;

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
        frequency: emberFreq,
        blendMode: 'ADD',
      });
      em.setDepth(4000);
    }

    // 地面上的草（会随风摆动）。放在背景之后种，所以天然在背景之上。
    if (th.grass) plantGrass(scene, mode);

    return g;
  }

  // ================================================================ 基地
  class HubScene extends Phaser.Scene {
    constructor() { super('Hub'); }

    create() {
      this.state = CURRENT_STATE;
      this.input2 = createInput(this);
      this.panelOpen = false;

      paintBackdrop(this, 'hub');

      // 区域美术：每个设施加一圈地面灯光，把视线聚过去；细节各自补足
      this.zoneArt = {};
      H.ZONES.forEach((z) => {
        /*
         * 每个设施自己站在哪一行，由它自己的纵深 z 决定（88 靠前 / 122 靠后）。
         * 以前这里写死 GROUND_Y - (HUB_D / 2) * Z_TO_Y，六个设施共用同一个 y，
         * 画面上就是一条直线；而 ZONES 里加了 z 之后，绘制端必须跟着数据走 ——
         * 只改数据不改这里，改的是"判定"而不是"画面"，两边会各说各话。
         * 缩放也取同一个 toScreen：靠后的设施略小一点，才像站在远处。
         */
        const seat = toScreen(z.x, z.z, 0);
        const y = seat.sy;

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
        } else if (z.art === 'shop') {
          img = this.add.container(z.x, y);
          img.add(this.add.rectangle(0, -2, 74, 9, 0x2f2418).setOrigin(0.5, 1));
          img.add(this.add.image(0, 0, 'shop').setOrigin(0.5, 1).setScale(1.12));
          // 三个瓶子的呼吸光：对应三种药水，让摊位"在营业"
          const glowA = this.add.ellipse(-25, -30, 12, 10, 0x7fe08a, 0.34)
            .setBlendMode(Phaser.BlendModes.ADD);
          const glowB = this.add.ellipse(-3, -32, 12, 10, 0xff9a6c, 0.34)
            .setBlendMode(Phaser.BlendModes.ADD);
          const glowC = this.add.ellipse(19, -30, 12, 10, 0x9ad7ff, 0.34)
            .setBlendMode(Phaser.BlendModes.ADD);
          img.add(glowA); img.add(glowB); img.add(glowC);
          // 相位错开：三个灯同时闪会像故障，错开才像"各烧各的"
          [glowA, glowB, glowC].forEach((gl, i) => {
            this.tweens.add({ targets: gl, alpha: 0.7, duration: 900 + i * 260,
              yoyo: true, repeat: -1, ease: 'Sine.inOut', delay: i * 200 });
          });
        } else if (z.art === 'rack') {
          // 兵器架：石台 + 武器架，外加一道冷色反光
          img = this.add.container(z.x, y);
          img.add(this.add.rectangle(0, -2, 84, 9, 0x2b313a).setOrigin(0.5, 1));
          img.add(this.add.image(0, 0, 'rack').setOrigin(0.5, 1).setScale(1.0));
          // 法杖宝石的呼吸光（对应棱晶杖），位置与贴图里的宝石对齐
          const gem = this.add.ellipse(6, -52, 14, 14, 0xc9a6ff, 0.3)
            .setBlendMode(Phaser.BlendModes.ADD);
          img.add(gem);
          this.tweens.add({ targets: gem, alpha: 0.62, duration: 1200,
            yoyo: true, repeat: -1, ease: 'Sine.inOut' });
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
        // 景深缩放：z 越大站得越远，整体略小一点（0.90 ~ 0.92，肉眼刚好能感觉到）
        img.setScale(seat.sc);
        this.zoneArt[z.id] = img;

        // 标签做成胶囊，比裸文字清楚。
        // 位置跟着这一行自己的 y 走：错落之后还写死一个 y，名字就会浮在设施上方
        // 或压进土里（上排和下排差 35px，足够看出来）。
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
      this.hero = makeHero(this, 100);

      /*
       * 把背包接到本场景（Task 8）。
       *
       * 为什么必须显式接：update() 的第一行是 if (this.panelOpen) return;
       * 背包一打开，整个 update 就早退，里面那句 refreshHeroEquip 再也执行不到 ——
       * 玩家在背包里换装，主角贴图会一直停在旧样子，要关掉面板才更新。
       * 所以背包每次改完装备都**回调**这里，而不是等下一帧顺手刷到。
       * （store 面板是同一个坑，它靠 showPanel 里就地刷一次解决了；背包是
       * 独立浮层，没有 showPanel 那个位置可挂，只能反向注册。）
       *
       * 开合也要通知：背包自己不暂停 canvas，只靠 panelOpen 冻结角色的
       * 移动与攻击输入；scene.pause() 统一留到 Task 9。
       */
      if (global.BagHud && typeof global.BagHud.setHost === 'function') {
        global.BagHud.setHost({
          onChange: () => refreshHeroEquip(this.hero, this.state),
          // 记下原本的开合状态：商店面板开着时再开背包，关背包不能顺手把商店也解冻
          onOpen: () => {
            this.bagPrevPanelOpen = this.panelOpen;
            this.panelOpen = true;
          },
          onClose: () => {
            this.panelOpen = !!this.bagPrevPanelOpen;
            this.bagPrevPanelOpen = false;
            // 与 toggleBag 里的 scene.pause() 成对恢复。三件事要一起说清：
            // 1) 必须在这里而不是只在 toggleBag 里：✕ 按钮（和 Esc 提示）直接调
            //    BagHud.close()，绕过 Tab；只写在 toggleBag 里游戏会一直冻住。
            // 2) 必须先问 isPaused()：场景可能已经被别的来源暂停（例如 ESC 菜单），
            //    无条件 resume() 会把别人的暂停吞掉。
            // 3) 重复 close() 不会再通知（baghud 只在真的"开 -> 关"那一跳回调），
            //    所以这里不会出现"关两次恢复两次"。
            if (this.scene && this.scene.isPaused()) this.scene.resume();
          },
        });
      }

      /*
       * 头顶键帽（取代原来的地面长提示）。
       *
       * 老做法是在角色脚下写一行「按 J · 名字（提示）」。问题有两个：
       *   1. 那行字压在角色与设施的脚边，走到跟前正好被自己挡住；
       *   2. 它是"按当前判定现写一行字"，名字一长就横穿整个画布。
       * 换成一个贴着头顶的 26x26 键帽：靠近才出现，扫一眼就知道按什么键。
       */
      this.keycap = makeKeycap(this);
      this.keycapNear = false;

      this.cameras.main.setBackgroundColor('#141a22');
      this.events.on('wake', () => { this.panelOpen = false; this.refreshPlots(); });
      // 调试钩子：无头探针需要能驱动场景（见 /tmp/probe.js）
      global.EmberfieldApp.__scene = this;
      global.EmberfieldApp.__state = this.state;
    }

    /*
     * Tab 开 / 关背包（Task 9）。
     *
     * 方向只问 BagHud.isOpen()，不另存一份开关状态 —— 两份状态一旦漂移，
     * 就会出现"按 Tab 关不掉"或者"面板关了场景还在暂停"。
     * 调用点只有一个：createInput 的 window keydown 监听（Tab 分支）。
     */
    toggleBag() {
      const hud = global.BagHud;
      if (!hud || typeof hud.open !== 'function') return;
      if (hud.isOpen()) { hud.close(); return; }   // 恢复在 onClose 里，成对
      // 先开面板再暂停：反过来的话一暂停就轮不到渲染，玩家会看到半张面板。
      const okOpen = hud.open(this.state, {
        onChange: () => refreshHeroEquip(this.hero, this.state),
      });
      // 面板建不出来（没有 DOM / 贴图缺失）就不要暂停，否则游戏冻住还没有出口
      if (!okOpen) return;
      this.scene.pause();
    }

    refreshPlots() {
      this.plotSprites.forEach((s) => s.destroy());
      this.plotSprites = [];
      const field = H.ZONES.find((z) => z.id === 'field');
      // 作物必须落在田地的土上：田地改到 z=88 之后，这里还按 HUB_D/2 算就会把
      // 苗画在土面以上 17px，看起来像悬空。
      const y = toScreen(field.x, field.z, 0).sy;
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
        // Boss 挑战：进入一场只有 Boss 的对局
        if (action.kind === 'boss') {
          global.EmberfieldUI.closePanel();
          this.panelOpen = false;
          this.startBossRun(action.payload.bossTier);
          return;
        }
        const r = H.perform(this.state, action);
        const isPlant = action.kind === 'plant' || action.kind === 'plant-all';
        /*
         * 换装必须"当场"看得见。
         *
         * Hub.update 的第一行是 if (this.panelOpen) return; —— 面板开着时
         * 整个 update 直接返回，里面的 refreshHeroEquip 根本执行不到。
         * 而买/穿/升级全都发生在面板开着的时候，于是玩家在兵器架前
         * 换上头盔，主角毫无变化，要关掉面板才更新 —— 换装这个动作
         * 等于没有反馈。所以这里在动作成功后就地刷一次。
         */
        if (r && r.ok) refreshHeroEquip(this.hero, this.state);
        global.EmberfieldUI.refreshPanel(zone, this.state);
        this.refreshPlots();
        global.EmberfieldUI.save(this.state);
        // toast 要说出"这次点了什么"。兵器架的动作自带 verb，直接沿用
        // （已购买 / 已穿戴 / 已升级 / 已卸掉）；没有 verb 的老动作退回"已购买"。
        const verb = action.verb;
        const okText = isPlant ? '已播种'
          : (verb ? (verb.charAt(0) === '已' ? verb : '已' + verb) : '已购买');
        global.EmberfieldUI.toast(r.ok ? okText : (r.reason || '无法执行'), r.ok);
      });
    }

    startRun(difficultyId) {
      L.startRun(this.state, difficultyId);
      global.EmberfieldUI.save(this.state);
      this.scene.start('Run');
    }

    /** Boss 挑战：清空普通波次，只放一只 Boss。 */
    startBossRun(tierId) {
      L.startRun(this.state, 'wood');
      const run = this.state.run;
      run.enemies.length = 0;
      run.spawnQueue.length = 0;
      run.waveState = 'break';
      run.breakTimer = 99999;                 // 不推进普通波次
      run.isBossRun = true;
      run.bossTier = tierId;
      L.spawnBoss(this.state, run, tierId);
      global.EmberfieldUI.save(this.state);
      this.scene.start('Run');
    }

    update(time, delta) {
      if (this.panelOpen) return;
      const dt = Math.min(delta / 1000, 0.05);
      const input = this.input2.read();
      // 基地里同样支持 Shift 冲刺
      H.moveHub(this.state, input, dt, input.sprint ? C.SPRINT_MULT : 1);

      updateGrass(this, dt);

      const hub = this.state.hub;
      const s = toScreen(hub.x, hub.z, 0);
      this.hero.setPosition(s.sx, s.sy).setDepth(1000 - hub.z);
      this.hero.setFlipX(hub.facing < 0);
      this.hero.setScale(s.sc * HERO_SCALE);
      // 基地里也要显示已穿的装备 —— 玩家在兵器架前换装，
      // 必须当场看到自己换了什么，否则"换装"这件事没有任何反馈。
      refreshHeroEquip(this.hero, this.state);
      this.shadow.setPosition(s.sx, s.sy + 2).setDepth(1000 - hub.z - 1);

      const zone = H.zoneAt(this.state);
      /*
       * 键帽：靠近才出现，150ms 淡入 / 淡出。
       *
       * 只在"状态翻转的那一帧"动 tween，不是每帧都加 —— 每帧重新 add 一个
       * tween 会把上一条掐死在半路，alpha 永远涨不上去（表现为一直闪在 0.1）。
       * 淡出结束后才 setVisible(false)：直接隐藏会缺最后那一下"缩回去"的过程。
       */
      const near = !!zone;
      if (near !== this.keycapNear) {
        this.keycapNear = near;
        this.tweens.killTweensOf(this.keycap);
        if (near) {
          this.keycap.setVisible(true);
          this.tweens.add({ targets: this.keycap, alpha: 1, duration: 150 });
        } else {
          this.tweens.add({
            targets: this.keycap, alpha: 0, duration: 150,
            onComplete: () => this.keycap.setVisible(false),
          });
        }
      }
      if (near) {
        // 头顶右上方：角色贴图 40x60、origin (0.5, 1)，容器缩放 = s.sc * HERO_SCALE，
        // 所以头顶在 sy - 71 * s.sc 附近；键帽中心再往上 7px、往右让 20px。
        this.keycap.setPosition(s.sx + 20 * s.sc, s.sy - 78 * s.sc);
        this.shadow.setScale(s.sc * 0.8);
      }

      if (this.input2.justPressed('attack') && zone) {
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
      this.input2 = createInput(this);
      this.enemyPool = [];

      // Boss 局用专属地图风格：普通=荒野、困难=密林、地狱=熔岩。
      // 玩家一进场就该知道自己打的是哪一档。
      const st = CURRENT_STATE;
      const isBossRun = st && st.run && st.run.isBossRun;
      const tier = st && st.run && st.run.bossTier;
      const themeMap = { normal: 'bossNormal', hard: 'bossHard', hell: 'bossHell' };
      paintBackdrop(this, isBossRun ? (themeMap[tier] || 'run') : 'run');

      this.effectGfx = this.add.graphics().setDepth(1050);
      // 蓄力光点单独一层：它必须盖在 Boss 上面，否则 Boss 身体一挡就看不见。
      // Boss 的 depth 是 1000 - z，z 在 0..210 之间，所以 1000 - z 在 790..1000。
      // 1400 高于所有 Boss 可能的深度，保证光点永远在最上层。
      this.bossGfx = this.add.graphics().setDepth(1400);

      this.shadow = this.add.image(0, 0, 'shadow').setDepth(1).setScale(0.8);
      this.hero = makeHero(this, 100);
      // 主角与小怪在 1000-z（z∈[0,210] → 790~1000），
      // 刀光若放在 101 会被画在角色和怪物背后，等于看不见
      this.heroSwing = this.add.graphics().setDepth(1100);

      this.projPool = [];
      this.dmgPool = [];
      this.lastEnemyHp = {};
      this.lastShake = 0;

      this.events.on('wake', () => { this.state = CURRENT_STATE; });

      /*
       * 背包在远征里也能开（Tab），打开时同样暂停本场景 —— 战斗中翻背包
       * 不能继续挨打。
       *
       * onChange 必须接：update() 一暂停，里面每帧那句 refreshHeroEquip
       * 就执行不到，玩家在背包里换了武器，场上的主角会一直是旧贴图。
       * 暂停 / 恢复本身由 toggleBag 与这里的 onClose 配对负责。
       */
      if (global.BagHud && typeof global.BagHud.setHost === 'function') {
        global.BagHud.setHost({
          onChange: () => refreshHeroEquip(this.hero, this.state),
          onClose: () => {
            // 同 Hub：只恢复自己暂停的那一次，别的来源（ESC 菜单）暂停的不碰。
            // 也不能只看 toggleBag —— ✕ 按钮直接调 BagHud.close()。
            if (this.scene && this.scene.isPaused()) this.scene.resume();
          },
        });
      }

      global.EmberfieldUI.showHud(true, this.state);
      global.EmberfieldApp.__scene = this;
      global.EmberfieldApp.__state = this.state;
    }

    // Tab 开 / 关背包（Task 9）。只动本场景的 this.scene，不影响 Hub。
    toggleBag() {
      const hud = global.BagHud;
      if (!hud || typeof hud.open !== 'function') return;
      if (hud.isOpen()) { hud.close(); return; }
      const okOpen = hud.open(this.state, {
        onChange: () => refreshHeroEquip(this.hero, this.state),
      });
      if (!okOpen) return;
      this.scene.pause();
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

      const input = this.input2.read();
      L.step(this.state, input, dt);

      updateGrass(this, dt);

      // 必须每帧清空：Phaser 的 Graphics 会累积绘制命令，
      // 不清的话前一帧的血条、特效、范围圈会全部叠加残留，
      // 屏幕上会出现莫名其妙的色块和长条（真实踩过这个坑）。
      this.effectGfx.clear();
      this.bossGfx.clear();

      /*
       * 灼烧 / 冰霜地面区。
       *
       * 这两个数组在 logic 里是持续存在的（熔火战靴踩出火,霜缚护甲冻出冰），
       * 和 effects 那种几百毫秒就消失的一次性特效不是一回事,所以要单独画:
       * 一个随剩余时间脉动的椭圆贴地 + 一圈亮边。不画的话,玩法上"站进
       * 火里会掉血、踏进冰上会减速"完全没有可见依据,玩家只会觉得血在乱掉。
       */
      drawZones(this.effectGfx, run);

      /*
       * 装备掉落提示。
       *
       * 掉落率只有 5%，一局往往一件都不掉，掉了也一闪而过很难注意到。
       * logic 会把每件掉落追加进 run.equipDrops，这里逐帧取走并弹提示
       * （取走即清空，所以不会每帧重复弹同一条）。重复件也已经进背包了，
       * 只是提示里标注一下——否则玩家分不清是新件还是重复件。
       */
      if (run.equipDrops && run.equipDrops.length) {
        run.equipDrops.forEach((d) => {
          const def = C.equipDef(d.id);
          const label = def ? def.name : d.id;
          if (d.bagFull && d.overwrote) {
            // 满包时新件顶掉了最后一格。这里**必须说出被顶掉的是哪一件** ——
            // 只说"已进背包"的话，玩家背包里凭空少一件却毫无提示，
            // 会以为是自己看错了或者游戏吞了装备。
            const gone = C.equipDef(d.overwrote.id);
            const goneLabel = gone ? gone.name : d.overwrote.id;
            global.EmberfieldUI.toast(
              '背包已满 · 「' + label + '」顶替了「' + goneLabel + '」',
              true);
            return;
          }
          global.EmberfieldUI.toast(
            d.duplicate
              ? ('拾得「' + label + '」（重复）· 已进背包')
              : ('掉落装备「' + label + '」· 已进背包'),
            true);
        });
        run.equipDrops.length = 0;
      }

      // 相机轻微跟随，让走位有纵深
      this.cameras.main.scrollX = (run.player.x - W / 2) * 0.04;

      const p = run.player;
      const ps = toScreen(p.x, p.z, p.h);
      this.hero.setPosition(ps.sx, ps.sy).setScale(ps.sc * HERO_SCALE);
      this.hero.setFlipX(p.facing < 0);
      refreshHeroEquip(this.hero, this.state);
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

      // Boss：用真实美术（三档难度各一对左右视图），按朝向切换
      run.enemies.forEach((e) => {
        if (!e.isBoss) return;
        if (!this.bossSprite) {
          this.bossSprite = this.add.image(0, 0, 'boss_normal_right').setOrigin(0.5, 1);
          this.bossSprite.setVisible(false);
          // Boss 的接地阴影。小怪一直有，Boss 之前没有 —— 于是看起来"悬空"。
          // 阴影要又大又淡，才像庞大物体投在地面上的柔和暗影。
          this.bossShadow = this.add.ellipse(0, 0, 150, 34, 0x000000, 0.30)
            .setVisible(false).setDepth(1);
        }
        const tier = e.bossTier || 'normal';
        const dir = e.facing >= 0 ? 'right' : 'left';
        const key = 'boss_' + tier + '_' + dir;
        if (this.textures.exists(key)) {
          this.bossSprite.setTexture(key);
        } else if (this.textures.exists('boss_normal_' + dir)) {
          this.bossSprite.setTexture('boss_normal_' + dir);
        }
        const bs = toScreen(e.x, e.z, e.h);
        // 缩放到游戏里的目标高度（约 220px 视觉高度）
        // 185 ≈ 玩家的 3 倍高。150 时像"大点的怪"没有压迫感，
        // 220 时占画面 1/3 且抠图细节糊掉。185 是两者之间。
        const targetH = 185;
        const texH = this.bossSprite.height || 400;
        const scale = (targetH / texH) * bs.sc;
        // 贴地：sy 已是 z 对应的地面位置，origin(0.5,1) 让图片底边落在这里
        const gy = toScreen(e.x, e.z, 0).sy;
        this.bossSprite.setVisible(true)
          .setPosition(bs.sx, gy)
          .setScale(scale)
          .setDepth(1000 - e.z)
          .setAlpha(e.hitFlash > 0 ? 0.75 : 1);

        // 接地阴影：让庞大的身体有"压在地上"的重量感
        this.bossShadow.setVisible(true)
          .setPosition(bs.sx, gy + 4)
          .setSize(150 * scale, 34 * scale)
          .setDepth(1000 - e.z - 1);

        // ================= Boss 动作动画 =================
        // 按 game-feel 技能的做法：**tween + squash & stretch**，而不是逐帧图。
        //
        // 为什么不用逐帧：一张立绘做 8 帧动画需要 8 张图，而 Boss 只有一张。
        // 形变驱动的好处是**随状态实时变化** —— 蓄力时抖动、受击时后仰、
        // 出手时前倾，这些都能从战斗状态直接算出来，不需要额外的美术。
        //
        // 每个动作遵循同一套规则：
        //   瞬间形变（快）→ 缓动回正（慢），且都带一点过冲。
        //   这就是 game-feel 里说的"juice is transient, not a new resting state"。

        // 用 time 驱动的正弦做"呼吸"，让静止时也不是死的
        const breathe = Math.sin(time / 620) * 0.014;
        let sx = 1 + breathe, sy = 1 - breathe;      // 体积守恒：一轴胀一轴缩
        let rot = 0;                                  // 倾斜（弧度）
        let dyOff = 0;                                // 垂直偏移
        let dxOff = 0;
        let tint = 0xffffff;

        if (e.casting) {
          // ---- 蓄力：粒子光芒汇聚 + 身体后仰抖动 ----
          const t = time / 1000;
          const charge = 1 - (e.casting.timer / e.casting.windup);   // 0 → 1
          // 蓄力越深，抖动越快越明显
          const shakeAmp = 1.5 + charge * 4.5;
          dxOff = Math.sin(t * (18 + charge * 26)) * shakeAmp;
          dyOff = Math.cos(t * (23 + charge * 30)) * shakeAmp * 0.5;
          // 身体被"压缩蓄势"：越接近释放越扁
          sy = 1 - charge * 0.10;
          sx = 1 + charge * 0.08;
          // 微微后仰
          rot = -0.045 * charge * (e.facing >= 0 ? 1 : -1);
          tint = charge > 0.6 ? 0xffd0c0 : 0xffffff;

          // 粒子光芒汇聚（第二版）。
          //
          // 第一版有 20 个点，分布在 230px 半径上 —— 密度太低，看起来永远是
          // "十几个散点"，读不出流动。第二版的三个改动：
          //   1. 点数提到 36，并按 3 条螺旋臂分布（不是均匀圆环）
          //   2. 每条臂上的点错开进度，形成连续的"流"而不是"一圈点"
          //   3. 核心从实心球改成多层柔光晕，避免像"贴了个球"
          const g2 = this.bossGfx;
          // 汇聚中心：Boss 的**视觉中心**。
          // 之前用 92*scale，但 scale 只有 0.41 时只上移 38px，
          // 而 Boss 视觉高 76px —— 中心落在了胸口上方，且半径 230 会铺到画布外。
          // 现在按实际视觉高度的一半来定中心，并把半径收进画布。
          const visualH = 185 * scale;
          const csx = bs.sx;
          const csy = gy - visualH * 0.52;
          // 半径自适应：不能超过到画布边缘的距离，否则光点跑到画面外
          const roomL = csx, roomR = W - csx, roomT = csy, roomB = HGT - csy;
          const room = Math.min(roomL, roomR, roomT, roomB);
          const maxDist = Math.max(90, Math.min(230, room * 0.95));
          const ARMS = 3, PER_ARM = 12;
          for (let arm = 0; arm < ARMS; arm++) {
            for (let k = 0; k < PER_ARM; k++) {
              // 进度：每条臂上的点依次错开，形成螺旋
              const seq = (k / PER_ARM) + arm / ARMS;
              const mp = ((t * 1.35 + seq) % 1);          // 0 远 → 1 抵达
              // 螺旋角：随进度旋转，越靠近核心转得越快
              const ang = seq * Math.PI * 2 + mp * 2.6 + t * 0.5;
              // 起始距离必须**大于 Boss 身体半径**（约 100px），否则光点一出现
              // 就在身体内部、被 Boss 挡住，看起来像"没有光点"。
              // 230 起、收拢到 105，保证整段行程都在身体之外。
              const baseDist = maxDist - charge * maxDist * 0.54;
              // 非线性收缩：远处快、近处慢，像被吸住
              const dist = baseDist * Math.pow(1 - mp, 1.9) + 8;
              const px = csx + Math.cos(ang) * dist;
              const py = csy + Math.sin(ang) * dist * 0.58;

              const alpha = (0.35 + mp * 0.65) * (0.55 + charge * 0.45);
              const r = 4.2 * (1 - mp * 0.45);

              // 指向中心的拖尾**线条**。
              // 关键领悟：静态截图里，一堆圆点读不出"被吸走"——因为没有方向。
              // 而一条从光点指向核心的短线，即使静止不动也明确表达了方向。
              // 线的长度随进度缩短（越近核心，剩下的路程越短）。
              const tailLen = Math.min(dist * 0.55, 46) * (0.4 + mp * 0.6);
              if (tailLen > 2) {
                const tx = csx + Math.cos(ang) * (dist + tailLen);
                const ty = csy + Math.sin(ang) * (dist + tailLen) * 0.58;
                g2.lineStyle(Math.max(1.2, r * 0.75), 0xffb070, alpha * 0.55);
                g2.beginPath();
                g2.moveTo(tx, ty);
                g2.lineTo(px, py);
                g2.strokePath();
              }

              g2.fillStyle(0xffe4b0, alpha);
              g2.fillCircle(px, py, r);
            }
          }
          // 核心：多层柔光晕（不是实心球）。
          // 实心球看起来像"身上贴了个橙球"，柔光晕才像"能量在聚集"。
          if (charge > 0.30) {
            const coreA = (charge - 0.30) / 0.70;
            for (let layer = 3; layer >= 1; layer--) {
              const rr = (14 + coreA * 40) * layer * 0.62;
              g2.fillStyle(0xffb060, (0.055 + coreA * 0.07) * (4 - layer));
              g2.fillCircle(csx, csy, rr);
            }
            // 中心一个很小的亮核
            g2.fillStyle(0xfff0cc, 0.5 + coreA * 0.5);
            g2.fillCircle(csx, csy, 2 + coreA * 6);
          }
        } else if (e.attackCd > (C.BOSS.attackCooldown / (C.BOSS.tiers[tier].speedMul || 1)) - 0.28) {
          // ---- 近身出手：前倾横扫（用 attackCd 刚被重置的窗口判断"刚出手"）----
          const t = time / 1000;
          const k = 1 - ((C.BOSS.attackCooldown / (C.BOSS.tiers[tier].speedMul || 1)) - (C.BOSS.attackCooldown / (C.BOSS.tiers[tier].speedMul || 1)) + (e.attackCd - ((C.BOSS.attackCooldown / (C.BOSS.tiers[tier].speedMul || 1)) - 0.28))) / 0.28;
          dxOff = e.facing * 16 * (1 - k);
          rot = e.facing * 0.10 * (1 - k);
          sx = 1 + 0.06 * (1 - k);
        }

        if (e.hitFlash > 0) {
          // ---- 受击僵直：向后弹一下并压扁 ----
          // 用 hitFlash（0.12s）作为窗口，短暂但明确
          const k = e.hitFlash / 0.12;
          dxOff -= e.facing * 10 * k;                // 被击退的方向
          sy = 1 - 0.06 * k;
          sx = 1 + 0.05 * k;
          rot = -e.facing * 0.05 * k;
          tint = 0xffc0b0;
        }

        if (e.stun > 0) {
          // ---- 僵直：低头、压扁、不动 ----
          sy *= 0.94;
          sx *= 1.04;
          rot += 0.06 * (e.facing >= 0 ? 1 : -1);
          tint = 0xd8d8d8;
        }

        // 走路：缓慢的上下起伏 + 轻微左右摇摆。
        // Boss 移速只有 26，所以摆动要慢而重，像庞然大物在挪动。
        if (!e.casting && e.stun <= 0 && e.hitFlash <= 0) {
          const walk = Math.sin(time / 480);
          dyOff += Math.abs(walk) * 3 * scale;
          rot += walk * 0.022 * (e.facing >= 0 ? 1 : -1);
        }

        this.bossSprite.setScale(scale * sx, scale * sy);
        this.bossSprite.setRotation(rot);
        this.bossSprite.setPosition(bs.sx + dxOff, gy + dyOff);
        this.bossSprite.setTint(tint);

        // ---- 光环与技能特效 ----
        // 作用有二：盖住抠图残留的灰边；强化"异界入侵"的压迫感。
        // 颜色按难度区分，与 Boss 主色呼应。
        const AURA = { normal: 0xb8a878, hard: 0x8fd45a, hell: 0xff5a3c };
        const auraCol = AURA[tier] || AURA.normal;
        const g = this.effectGfx;
        const groundY = toScreen(e.x, e.z, 0).sy;
        const t = time / 1000;
        const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);

        // (1) 地面法阵：细、暗、贴地。之前 210x62 的亮绿大环盖住了 Boss 本身。
        g.lineStyle(1.8, auraCol, 0.34 + pulse * 0.16);
        g.strokeEllipse(bs.sx, groundY + 2, 132 * bs.sc, 38 * bs.sc);
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2 + t * 0.6;
          const rx = 66 * Math.cos(a) * bs.sc, ry = 19 * Math.sin(a) * bs.sc;
          g.fillStyle(auraCol, 0.3 + 0.4 * Math.abs(Math.sin(t * 3 + k)));
          g.fillCircle(bs.sx + rx, groundY + 2 + ry, 1.8 * bs.sc);
        }

        // (2) 轮廓光：贴着身体外缘，用来盖抠图灰边。椭圆要匹配实际体型。
        const bodyH = 185 * bs.sc, bodyW = 88 * bs.sc;
        g.lineStyle(3.5 * bs.sc, auraCol, 0.30 + pulse * 0.14);
        g.strokeEllipse(bs.sx, groundY - bodyH * 0.5, bodyW * 1.55, bodyH * 0.94);

        // (3) 上升的孢子：少量、暗色
        for (let k = 0; k < 5; k++) {
          const ph = (t * 0.35 + k * 0.2) % 1;
          const px = bs.sx + Math.sin(t * 1.1 + k * 2.1) * 40 * bs.sc;
          const py = groundY - ph * 170 * bs.sc;
          g.fillStyle(auraCol, (1 - ph) * 0.45);
          g.fillCircle(px, py, (2.2 - ph * 1.1) * bs.sc);
        }

        // (5) 正在施法时：显示技能范围与前摇进度
        if (e.casting) {
          const def = C.BOSS.skills.find((k) => k.id === e.casting.id);
          if (def) {
            const prog = 1 - (e.casting.timer / e.casting.windup);   // 0 → 1
            const warn = 0.45 + 0.55 * Math.sin(t * 18);              // 急促闪烁
            if (def.range === 'full') {
              // 全屏技能预警：**从 Boss 向外扩散的淡红圈**，扩散到画面边缘时释放。
              // 这是 PM 指定的降难度措施 —— 玩家看到圈在扩散就知道还有多久，
              // 比"整屏闪烁"更容易判断剩余时间。
              const t0 = toScreen(e.castOriginX !== undefined ? e.castOriginX : e.x,
                                  e.castOriginZ !== undefined ? e.castOriginZ : e.z, 0);
              // 从 Boss 脚下扩到能覆盖整屏：对角线约 1100
              const maxR = 1180;
              const ringR = maxR * prog;
              g.fillStyle(0xc8322a, 0.055 + prog * 0.05);
              g.fillCircle(t0.sx, t0.sy, ringR);
              // 边缘：两道同心圈，一实一虚，制造"正在推进"的感觉
              g.lineStyle(7, 0xff4a3c, 0.34 + prog * 0.42);
              g.strokeCircle(t0.sx, t0.sy, ringR);
              g.lineStyle(2.5, 0xffb0a0, 0.5 + warn * 0.4);
              g.strokeCircle(t0.sx, t0.sy, Math.max(0, ringR - 22));
              // 爆发瞬间：整屏闪一下，确认"到达边缘"
              if (prog > 0.94) {
                g.fillStyle(0xff4a3c, 0.20 * ((prog - 0.94) / 0.06));
                g.fillRect(0, 0, W, HGT);
              }
              // Boss 处于无敌帧时的提示（PM 选定的躲避方式是卡无敌帧）
              if (p.invuln > 0) {
                g.lineStyle(3, 0xc9a6ff, 0.9);
                g.strokeCircle(ps.sx, ps.sy - 26 * ps.sc, 26 * ps.sc);
              }
            } else {
              // 范围技能：地面圆环 + 内圈填充，半径随进度收缩（提示"快来了"）
              // 半径按游戏单位换算到屏幕，不再乘 1.9（那会让 210 的半径看起来像 400）
              const r = def.radius * bs.sc * (1.10 - prog * 0.10);
              g.fillStyle(0xff5a3c, 0.10 + prog * 0.14);
              g.fillEllipse(bs.sx, groundY + 2, r, r * 0.34);
              g.lineStyle(3, 0xff9a6c, 0.55 + warn * 0.45);
              g.strokeEllipse(bs.sx, groundY + 2, r, r * 0.34);
            }
          }
        }
      });

      // 小怪
      run.enemies.forEach((e, i) => {
        if (e.isBoss) return;                 // Boss 单独渲染
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
        if (ef.kind === 'ring') {
          // 药水/瞬时效果：从脚下向外扩散的一圈光，外带一圈上浮的光点。
          // 默认那个椭圆环是平铺在地上的，看着像"地上的水渍"，
          // 喝药看不出效果作用在自己身上。
          const rr = ef.radius * (0.35 + prog * 0.9) * s2.sc;
          const ry = rr * 0.42;
          const cy = s2.sy - 6 * s2.sc;
          this.effectGfx.lineStyle(3.2 * s2.sc, ef.color, k * 0.85);
          this.effectGfx.strokeEllipse(s2.sx, cy, rr * 2, ry * 2);
          this.effectGfx.lineStyle(1.6 * s2.sc, 0xffffff, k * 0.5);
          this.effectGfx.strokeEllipse(s2.sx, cy, rr * 1.72, ry * 1.72);
          // 上浮光点：给"药效进入身体"一个方向感
          const n = 7;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + prog * 1.1;
            const px = s2.sx + Math.cos(a) * rr * 0.86;
            const py = cy + Math.sin(a) * ry * 0.86 - prog * 44 * s2.sc;
            const sz = Math.max(0.8, (2.6 - prog * 1.1) * s2.sc);
            this.effectGfx.fillStyle(ef.color, k * 0.8);
            this.effectGfx.fillCircle(px, py, sz);
          }
          return;
        }
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
      this.input2 = createInput(this);
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
      /*
       * 这里原本有一行 `const k = this.keyboardApi.keys;`。
       * keyboardApi 这个属性**从来没有被赋值过**，所以第一帧 update 就抛
       * TypeError，整个场景停在渐黑之后的黑屏上：按 J 进田地，画面黑下来
       * 之后什么都没有，ESC 也回不去。取到的 k 本身从没被用过 ——
       * 真正判断按键的是下一行的 this.input2，那行纯属死代码。
       * 删掉即可；键盘仍然走 createInput 自己维护的那套。
       */
      if (this.input2.justPressed('esc')) this.leave();
    }
  }

  // 引导场景：先在所有纹理就绪后再进基地，避免第一帧拿到不存在的纹理而黑屏
  class BootScene extends Phaser.Scene {
    constructor() { super('Boot'); }

    preload() {
      // Boss 美术来自课程指定的 AIMC 平台（人工生成），
      // 经 game/assets/ 处理：抠背景 → 降色数 → 加描边。
      // 三档难度各一对左右视图。文件缺失时不会崩，只是该档没有图。
      const TIERS = ['normal', 'hard', 'hell'];
      const DIRS = ['right', 'left'];
      TIERS.forEach((t) => {
        DIRS.forEach((d) => {
          const key = 'boss_' + t + '_' + d;
          this.load.image(key, 'assets/boss_' + t + '_' + d + '.png');
        });
      });
    }

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
