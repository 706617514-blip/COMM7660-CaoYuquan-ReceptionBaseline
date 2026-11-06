/**
 * hub.js — 基地（农庄）的可走动场景：布局、区域判定、可执行动作。
 *
 * 为什么要单独一层
 * --------------
 * 参照熔炉密林：基地不是菜单，而是一个能走的场景，走到某处按 J 触发。
 * 但"走到哪、能做什么"属于**规则**，必须能在 CI 里验证；
 * 画一个铁匠铺长什么样属于**表现**，交给引擎。
 * 所以这里只有坐标判定与动作清单，没有任何绘制代码。
 *
 * 纯模块：不碰 DOM、不碰引擎。
 */
(function (global) {
  'use strict';

  const C = (typeof module !== 'undefined' && module.exports)
    ? require('./config.js')
    : global.GameConfig;
  const L = (typeof module !== 'undefined' && module.exports)
    ? require('./logic.js')
    : global.GameLogic;

  // 基地世界宽度比战斗场地窄一点，走起来不至于太空
  const HUB_W = 960;
  const HUB_D = C.FIELD_D;

  /**
   * 区域沿 x 轴排布（从左到右就是玩家的动线）：
   *   田地 → 铁匠 → 技能祭坛 → 远征之门
   * reach 是触发半径：玩家 x 落在 [x-reach, x+reach] 内即可交互。
   */
  const ZONES = [
    { id: 'field', name: '田地', hint: '播种 / 查看作物',
      x: 150, reach: 95, art: 'field' },
    { id: 'anvil', name: '铁匠铺', hint: '强化攻击、生命、移速',
      x: 400, reach: 80, art: 'anvil' },
    { id: 'altar', name: '技能祭坛', hint: '提升技能等级',
      x: 620, reach: 80, art: 'altar' },
    { id: 'gate', name: '远征之门', hint: '选择难度并出发',
      x: 850, reach: 85, art: 'gate' },
  ];

  function ensureHub(state) {
    // 起点放在设施之间（不在任何区域内），避免一进基地就正好压在铁砧上
    if (!state.hub) state.hub = { x: 285, z: HUB_D / 2, facing: 1 };
    return state.hub;
  }

  /** 玩家当前站在哪个区域里；不在任何区域返回 null。 */
  function zoneAt(state) {
    const hub = ensureHub(state);
    for (let i = 0; i < ZONES.length; i++) {
      const z = ZONES[i];
      if (Math.abs(hub.x - z.x) <= z.reach) return z;
    }
    return null;
  }

  function zoneById(id) {
    return ZONES.find((z) => z.id === id) || null;
  }

  /** 基地里走动：只允许水平移动，深度轴同样保留（与战斗一致的手感）。 */
  function moveHub(state, input, dt, speedMul) {
    const hub = ensureHub(state);
    const mul = speedMul || 1;
    // 数值必须取自 config，并且把「轻步」升级也算进去 ——
    // 之前硬编码 250/150，导致攻速强化在基地里完全没效果。
    const up = state.meta.upgrades.speed || 0;
    const speed = C.PLAYER_SPEED * (1 + up * C.UPGRADES.speed.perLevel) * mul;
    const depthSpeed = C.PLAYER_DEPTH_SPEED * (1 + up * C.UPGRADES.speed.perLevel) * mul;
    if (input.left) { hub.x -= speed * dt; hub.facing = -1; }
    if (input.right) { hub.x += speed * dt; hub.facing = 1; }
    if (input.up) hub.z += depthSpeed * dt;
    if (input.down) hub.z -= depthSpeed * dt;
    hub.x = Math.max(40, Math.min(HUB_W - 40, hub.x));
    hub.z = Math.max(0, Math.min(HUB_D, hub.z));
    return hub;
  }

  /**
   * 某个区域当前能做什么。返回动作清单供 UI 渲染，
   * 每个动作自带 enabled 与原因，UI 不需要自己判断能不能买。
   */
  function zoneActions(state, zoneId) {
    const out = [];
    if (zoneId === 'field') {
      // 田地不再在这里出面板：HubScene 会让 J 直接进入农场场景，
      // 这里保留一个显式空清单，说明"这个区域没有可列的动作"。
      return out;
    }
    if (zoneId === 'anvil') {
      Object.keys(C.UPGRADES).forEach((key) => {
        const def = C.UPGRADES[key];
        const cost = L.upgradeCost(state, key);
        const lvl = state.meta.upgrades[key];
        out.push({
          kind: 'upgrade', id: 'up-' + key, label: def.name,
          sub: 'Lv.' + lvl + '/' + def.maxLevel + ' · ' + def.desc,
          cost: cost === null ? null : cost,
          enabled: cost !== null && state.meta.coins >= cost,
          disabledReason: cost === null ? '已满级' : (state.meta.coins < cost ? '铜币不够' : ''),
          payload: { key: key },
        });
      });
    } else if (zoneId === 'altar') {
      C.SKILL_ORDER.forEach((key) => {
        const def = C.SKILLS[key];
        const lvl = state.meta.skills[key] || 1;
        const cost = L.skillCost(state, key);
        const st = L.skillStats(key, lvl);
        const next = lvl < def.maxLevel ? L.skillStats(key, lvl + 1) : null;
        // 战吼没有伤害字段（它是治疗技能），旧写法会显示"伤害 0→0"，
        // 玩家花了铜币却看不到任何变化。按技能实际生效的字段来组织文案。
        let delta = ' · 已满级';
        if (next) {
          const parts = [];
          if (def.heal) parts.push('治疗 ' + st.heal + '→' + next.heal);
          if (def.damage) parts.push('伤害 ' + st.damage + '→' + next.damage);
          parts.push('冷却 ' + st.cooldown.toFixed(1) + '→' + next.cooldown.toFixed(1) + 's');
          delta = ' · ' + parts.join(' · ');
        }
        out.push({
          kind: 'skill', id: 'sk-' + key, label: '[' + def.key + '] ' + def.name,
          sub: 'Lv.' + lvl + '/' + def.maxLevel + delta,
          cost: cost,
          enabled: cost !== null && state.meta.coins >= cost,
          disabledReason: cost === null ? '已满级' : (state.meta.coins < cost ? '铜币不够' : ''),
          ultimate: !!def.ultimate,
          payload: { key: key },
        });
      });
    } else if (zoneId === 'gate') {
      C.DIFFICULTIES.forEach((d) => {
        out.push({
          kind: 'run', id: 'run-' + d.id, label: d.name + ' · 战利品 ×' + d.lootMul,
          sub: d.desc + ' · ' + d.waves + ' 波',
          cost: 0, enabled: true, disabledReason: '',
          payload: { difficultyId: d.id },
        });
      });
    }
    return out;
  }

  /** 执行一个动作。返回 {ok, reason, ...}，状态变更全部走 logic 层以保证规则唯一。 */
  function perform(state, action) {
    if (!action || !action.enabled) {
      return { ok: false, reason: (action && action.disabledReason) || '现在不能这么做' };
    }
    if (action.kind === 'plant') {
      return L.plant(state, action.payload.plotIndex);
    }
    if (action.kind === 'plant-all') {
      let n = 0;
      state.farm.plots.forEach((plot, i) => {
        if (plot.state === 'empty' && state.meta.seeds >= C.FARM.seedCost) {
          if (L.plant(state, i).ok) n += 1;
        }
      });
      return { ok: n > 0, reason: n ? '' : '种子不够', planted: n };
    }
    if (action.kind === 'upgrade') return L.buyUpgrade(state, action.payload.key);
    if (action.kind === 'skill') return L.buySkill(state, action.payload.key);
    return { ok: false, reason: '未知动作' };
  }

  // ---------------------------------------------------------------- 农场田块
  /**
   * 农场田块的几何布局。抽到这一层是为了可测：
   * 成品里玩家点击播种走的是 FarmScene → hitPlot，而这段几何原先只存在于
   * 渲染代码里，Node 测试完全覆盖不到 —— 点错田都测不出来。
   *
   * @param {number} width  画布宽
   * @param {number} baseY  最靠前一行田的中心 y
   */
  function farmLayout(width, baseY) {
    const CX = width / 2;
    const rows = 3, cols = 3;
    const geo = [];
    for (let r = 0; r < rows; r++) {
      const depth = r / (rows - 1);          // 0 近 → 1 远
      const cy = baseY - r * 96;
      const rowW = 470 - depth * 110;
      const rowH = 74 - depth * 18;
      for (let c = 0; c < cols; c++) {
        geo.push({
          idx: r * cols + c, cx: CX + (c - 1) * (rowW / 3), cy: cy,
          w: (rowW / 3) - 12, h: rowH, depth: depth,
        });
      }
    }
    return geo;
  }

  /** 点击落点命中的田块索引；不命中返回 -1。近排优先。 */
  function farmHitPlot(geo, px, py) {
    for (let i = geo.length - 1; i >= 0; i--) {
      const g = geo[i];
      if (Math.abs(px - g.cx) <= g.w / 2 + 6 && Math.abs(py - g.cy) <= g.h / 2 + 6) {
        return g.idx;
      }
    }
    return -1;
  }

  const API = { HUB_W, HUB_D, ZONES, ensureHub, zoneAt, zoneById, moveHub, zoneActions, perform,
                farmLayout, farmHitPlot };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.GameHub = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
