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
    if (!state.hub) state.hub = { x: 400, z: HUB_D / 2, facing: 1 };
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
  function moveHub(state, input, dt) {
    const hub = ensureHub(state);
    const speed = 250;
    const depthSpeed = 150;
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
      const empty = [];
      state.farm.plots.forEach((p, i) => { if (p.state === 'empty') empty.push(i); });
      out.push({
        kind: 'plant', id: 'plant-empty',
        label: empty.length ? '播种下一块空田（' + empty.length + ' 块空着）' : '没有空田了',
        sub: '消耗 ' + C.FARM.seedCost + ' 颗种子 · 2 局成熟后每局 +' + C.FARM.yieldPerPlot,
        cost: 0, enabled: empty.length > 0 && state.meta.seeds >= C.FARM.seedCost,
        disabledReason: empty.length ? (state.meta.seeds < C.FARM.seedCost ? '种子不够' : '') : '没有空田',
        payload: { plotIndex: empty.length ? empty[0] : -1 },
      });
      out.push({
        kind: 'plant-all', id: 'plant-all',
        label: '全部空田一次种满',
        sub: '按现有种子尽可能播种',
        cost: 0,
        enabled: empty.length > 0 && state.meta.seeds >= C.FARM.seedCost,
        disabledReason: empty.length ? (state.meta.seeds < C.FARM.seedCost ? '种子不够' : '') : '没有空田',
        payload: {},
      });
    } else if (zoneId === 'anvil') {
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
        out.push({
          kind: 'skill', id: 'sk-' + key, label: '[' + def.key + '] ' + def.name,
          sub: 'Lv.' + lvl + '/' + def.maxLevel +
               (next ? ' · 伤害 ' + st.damage + '→' + next.damage +
                       ' · 冷却 ' + st.cooldown.toFixed(1) + '→' + next.cooldown.toFixed(1) + 's'
                     : ' · 已满级'),
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

  const API = { HUB_W, HUB_D, ZONES, ensureHub, zoneAt, zoneById, moveHub, zoneActions, perform };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.GameHub = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
