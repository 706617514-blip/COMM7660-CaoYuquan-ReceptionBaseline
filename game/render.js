/**
 * render.js — 只负责画。读 state，绝不修改 state。
 *
 * 2.5D 的表达方式（参照熔炉密林的景深带）
 * -------------------------------------
 * 逻辑层用的是 (x, z, h) 三个量，渲染要把它映射到屏幕：
 *   - z 越大 = 离镜头越远 → 屏幕 y 越小，同时整体略微缩小
 *   - h 是离地高度 → 直接减去
 *   - 绘制顺序按 z 从大到小（远的先画），保证近处的挡住远处的
 *
 * 如果偷懒只按 x 画（纯横版），W/S 深度轴就变成纯装饰；这里必须体现出来。
 */
(function (global) {
  'use strict';

  const C = global.GameConfig;

  const Z_TO_Y = 0.60;        // 每单位 z 对应的屏幕竖直偏移
  const Z_SCALE = 0.18;       // 最远处缩小 18%

  function toScreen(x, z, h) {
    const sy = C.GROUND_Y - z * Z_TO_Y - h;
    const scale = 1 - (z / C.FIELD_D) * Z_SCALE;
    return { sx: x, sy: sy, scale: scale };
  }

  // ---------------------------------------------------------------- 背景
  function drawWorld(ctx, t) {
    // 天空/远景
    const sky = ctx.createLinearGradient(0, 0, 0, C.GROUND_Y);
    sky.addColorStop(0, '#1b2432');
    sky.addColorStop(0.55, '#2b3a4d');
    sky.addColorStop(1, '#3a4b5e');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, C.FIELD_W, C.GROUND_Y);

    // 远景树影（视差靠固定形状，不做滚动，避免额外状态）
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    for (let i = 0; i < 12; i++) {
      const bx = 40 + i * 82;
      const bh = 120 + (i % 3) * 40;
      ctx.beginPath();
      ctx.moveTo(bx, C.GROUND_Y - 60);
      ctx.lineTo(bx + 34, C.GROUND_Y - 60 - bh);
      ctx.lineTo(bx + 68, C.GROUND_Y - 60);
      ctx.closePath();
      ctx.fill();
    }

    // 可走动的景深带：上下两条边界线要画出来，玩家才知道 W/S 能走到哪
    const zFar = C.GROUND_Y - C.FIELD_D * Z_TO_Y;
    const bandGrad = ctx.createLinearGradient(0, zFar, 0, C.GROUND_Y);
    bandGrad.addColorStop(0, '#37474f');
    bandGrad.addColorStop(1, '#4b5c43');
    ctx.fillStyle = bandGrad;
    ctx.fillRect(0, zFar, C.FIELD_W, C.GROUND_Y - zFar + 90);

    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, zFar); ctx.lineTo(C.FIELD_W, zFar); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    for (let i = 1; i <= 4; i++) {
      const y = zFar + (C.GROUND_Y - zFar) * (i / 5);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(C.FIELD_W, y); ctx.stroke();
    }
  }

  // ---------------------------------------------------------------- 影子
  function shadow(ctx, x, z, rx) {
    const p = toScreen(x, z, 0);
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(p.sx, p.sy + 2, rx * p.scale, rx * 0.34 * p.scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ---------------------------------------------------------------- 玩家
  function drawPlayer(ctx, p, t) {
    shadow(ctx, p.x, p.z, 18);
    const s = toScreen(p.x, p.z, p.h);
    const sc = s.scale;
    const face = p.facing;

    // 受击闪白
    const hurt = p.invuln > 0 && Math.floor(t * 20) % 2 === 0;

    ctx.save();
    ctx.translate(s.sx, s.sy);
    ctx.scale(sc * face, sc);       // 水平翻转表示朝向

    // 身体
    ctx.fillStyle = hurt ? '#ffd9d9' : '#6fb1e0';
    roundRect(ctx, -11, -44, 22, 34, 5);
    ctx.fill();
    // 头
    ctx.fillStyle = hurt ? '#ffeaea' : '#f0d3b0';
    ctx.beginPath(); ctx.arc(0, -50, 11, 0, Math.PI * 2); ctx.fill();
    // 腿
    ctx.fillStyle = '#2f4a63';
    const stride = Math.sin(t * 14) * (Math.abs(p.vx || 0) > 1 ? 4 : 0);
    ctx.fillRect(-8, -10 + stride * 0.3, 6, 12);
    ctx.fillRect(2, -10 - stride * 0.3, 6, 12);

    // 武器：攻击时朝前挥出
    const swing = p.attackTimer > 0 ? Math.sin((p.attackTimer / C.ATTACK_DURATION) * Math.PI) : 0;
    ctx.save();
    ctx.translate(9, -26);
    ctx.rotate(-0.5 + swing * 1.7);
    ctx.fillStyle = swing > 0 ? '#ffe07a' : '#c9d3dc';
    ctx.fillRect(0, -2.5, 30, 5);
    ctx.fillStyle = '#8a6b2f';
    ctx.fillRect(-6, -3.5, 8, 7);
    ctx.restore();

    ctx.restore();

    // 攻击判定范围的可视化（只画在最近的一层，帮助玩家理解 z 容差）
    if (p.attackTimer > 0) {
      const gp = toScreen(p.x, p.z, 0);
      ctx.save();
      ctx.globalAlpha = 0.16 + swing * 0.12;
      ctx.fillStyle = '#ffe07a';
      ctx.beginPath();
      ctx.ellipse(gp.sx + p.facing * 34 * gp.scale, gp.sy - 22 * gp.scale,
        40 * gp.scale, 20 * gp.scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- 小怪
  function drawEnemy(ctx, e, t) {
    shadow(ctx, e.x, e.z, e.radius);
    const s = toScreen(e.x, e.z, e.h);
    const sc = s.scale;
    const flash = e.hitFlash > 0;

    ctx.save();
    ctx.translate(s.sx, s.sy);
    ctx.scale(sc, sc);

    if (e.kind === 'runner') {
      // 冲刺虫：三角，蓄力时变红并轻微抖动
      const wind = e.state === 'windup';
      const jit = wind ? Math.sin(t * 40) * 2 : 0;
      ctx.translate(jit, 0);
      ctx.fillStyle = flash ? '#fff' : (wind ? '#e2603f' : '#b8543a');
      ctx.beginPath();
      ctx.moveTo(0, -34);
      ctx.lineTo(e.radius, 0);
      ctx.lineTo(-e.radius, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#221512';
      ctx.beginPath(); ctx.arc(-4, -14, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(4, -14, 2.6, 0, Math.PI * 2); ctx.fill();
    } else {
      // 爬虫：圆胖的团子
      const bob = Math.sin(t * 6 + e.id) * 2;
      ctx.fillStyle = flash ? '#fff' : '#7ba05b';
      ctx.beginPath();
      ctx.ellipse(0, -14 + bob, e.radius, e.radius * 0.88, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#20301c';
      ctx.beginPath(); ctx.arc(-5, -18 + bob, 2.8, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(5, -18 + bob, 2.8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // 血条：只在掉血后显示，避免满屏血条
    if (e.hp < e.maxHp) {
      const bw = 34 * sc, bh = 4;
      const bx = s.sx - bw / 2, by = s.sy - 48 * sc;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = '#e8574a';
      ctx.fillRect(bx, by, bw * Math.max(0, e.hp / e.maxHp), bh);
    }
  }

  // ---------------------------------------------------------------- 主绘制
  function drawScene(ctx, state, t) {
    drawWorld(ctx, t);
    const run = state.run;
    if (!run) return;

    // 按 z 从大到小排序：远的先画，近的覆盖上去（这是 2.5D 的关键）
    const items = [];
    run.enemies.forEach(function (e) { items.push({ z: e.z, kind: 'enemy', ref: e }); });
    items.push({ z: run.player.z, kind: 'player', ref: run.player });
    items.sort(function (a, b) { return b.z - a.z; });

    items.forEach(function (it) {
      if (it.kind === 'player') drawPlayer(ctx, it.ref, t);
      else drawEnemy(ctx, it.ref, t);
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  global.GameRender = {
    toScreen: toScreen, drawScene: drawScene,
    drawPlayer: drawPlayer, drawEnemy: drawEnemy, drawWorld: drawWorld,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
