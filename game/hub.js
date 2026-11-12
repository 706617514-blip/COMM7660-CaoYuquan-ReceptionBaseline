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

  /*
   * 强化项 → 铁匠铺分类（设计 §5.7）。
   *
   * 这里只给 id（attack / defense / move），中文标签与页签顺序在 index.html 的
   * PANEL_TABS 里 —— 数据层不该知道"攻击"这两个字怎么写，UI 层也不该知道
   * 哪个强化项算生存。两边只共享这一组 id。
   */
  const UPGRADE_CAT = { damage: 'attack', maxHp: 'defense', speed: 'move' };
  const UPGRADE_CATS = Object.keys(UPGRADE_CAT).map(function (k) { return UPGRADE_CAT[k]; });

  /**
   * 区域沿 x 轴排布（从左到右就是玩家的动线）：
   *   田地 → 铁匠 → 兵器架 → 药水铺 → 技能祭坛 → 远征之门
   *
   * reach 是横向触发半径：玩家 x 落在 [x-reach, x+reach] 内才可能交互。
   * z 是这一排设施自己的纵深（上下错落用）：绘制端据此算屏幕 y，
   *   判定端据此算"站得够不够近"——两处读的是同一个数，不能各写一份。
   * reachZ 是纵深容差（= 60）：玩家 z 与设施 z 的差超过它就不算站到跟前。
   *
   * 错落节奏：field / forgewear / altar 在 z=88（画面上更靠前、更低），
   * anvil / shop 在 z=122（更靠后、更高），门留在中线 105 —— 门是整张图的
   * 出口，摆在两排之间才不会让人以为"出门要斜着走"。
   */
  const REACH_Z = 60;
  const ZONES = [
    { id: 'field', name: '田地', hint: '播种 · 成熟后自动产出',
      x: 100, z: 88, reach: 66, reachZ: REACH_Z, art: 'field' },
    { id: 'anvil', name: '铁匠铺', hint: '强化攻击、生命、移速',
      x: 265, z: 122, reach: 58, reachZ: REACH_Z, art: 'anvil' },
    { id: 'forgewear', name: '兵器架', hint: '购买 · 装备 · 升级装备',
      x: 415, z: 88, reach: 58, reachZ: REACH_Z, art: 'rack' },
    { id: 'shop', name: '药水铺', hint: '补给消耗品 · 每局都要重新买',
      x: 565, z: 122, reach: 58, reachZ: REACH_Z, art: 'shop' },
    { id: 'altar', name: '技能祭坛', hint: '提升技能等级',
      x: 720, z: 88, reach: 58, reachZ: REACH_Z, art: 'altar' },
    { id: 'gate', name: '远征之门', hint: '选择难度并出发',
      x: 880, z: 105, reach: 60, reachZ: REACH_Z, art: 'gate' },
  ];

  function ensureHub(state) {
    // 起点放在设施之间（不在任何区域内），避免一进基地就正好压在铁砧上
    if (!state.hub) state.hub = { x: 285, z: HUB_D / 2, facing: 1 };
    return state.hub;
  }

  /**
   * 玩家当前站在哪个区域里；不在任何区域返回 null。
   *
   * 判定必须是二维的：设施上下错落之后，只比 x 会出现"站在两个点位中间、
   * 却同时命中上下两个设施"的情况，按 J 进哪个就成了随机。所以 x 与 z
   * 都要落在各自容差内。
   */
  function zoneAt(state) {
    const hub = ensureHub(state);
    for (let i = 0; i < ZONES.length; i++) {
      const z = ZONES[i];
      // 正面写法而不是两道 continue：hub.z 万一是 NaN（比如旧存档），
      // NaN <= reachZ 是 false，会自然地判成"没站到跟前"；
      // 而 NaN > reachZ 同样是 false，用 continue 反而会误判成命中。
      if (Math.abs(hub.x - z.x) <= z.reach && Math.abs(hub.z - z.z) <= z.reachZ) {
        return z;
      }
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
  /**
   * 背包里该 id 等级最高的那一条的下标（并列时取靠前的），没有返回 -1。
   *
   * 兵器架按 id 出一行，可背包里可能有重复件（掉落会带重复品）。
   * 这一行显示的 Lv. 和点下去真正穿上的那一件必须是同一条 —— 所以先选出
   * "玩家手里最好的那件"，再把它自己的 level 与 uid 一起写进动作。
   * 只写 id 不写 uid 时，logic 层只能退回"第一件同 id"：
   * 面板上写着 Lv.3，点下去穿的却是 Lv.1，而玩家完全看不出来。
   */
  function bestBagIndex(state, id) {
    const bag = state.meta.bag || [];
    let best = -1;
    for (let i = 0; i < bag.length; i++) {
      if (bag[i].id !== id) continue;
      if (best < 0 || (bag[i].level || 1) > (bag[best].level || 1)) best = i;
    }
    return best;
  }

  function zoneActions(state, zoneId, filter) {
    let out = [];
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
          // cat 供页签过滤、icon 供行首贴图：UI 不再自己按 key 猜这两件事
          // （猜错的表现是"分类点了没反应"、"图贴到别人身上"，都不报错）。
          cat: UPGRADE_CAT[key],
          icon: 'ic-' + key,
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
    } else if (zoneId === 'shop') {
      // 药水铺：三种消耗品，价格固定、每局都要重新买。
      // 全部列出（包括买不起/已带满的），因为这里同时承担"展示效果"的功能 ——
      // 玩家要先看到"护盾药水能减伤"才知道下局该带什么。
      C.POTION_ORDER.forEach(function (id) {
        const def = C.POTIONS[id];
        const held = (state.meta.potions && state.meta.potions[id]) || 0;
        const full = held >= def.carry;
        const poor = state.meta.coins < def.price;
        out.push({
          kind: 'potion', id: 'po-' + id, label: def.name,
          sub: def.desc + ' · 携带 ' + held + '/' + def.carry,
          cost: def.price,
          enabled: !full && !poor,
          disabledReason: full ? '已带满 ' + def.carry + ' 瓶' : (poor ? '铜币不够' : ''),
          payload: { id: id },
        });
      });

      // 背包扩容也摆在这里卖（需求：「在药水铺卖一个『背包页数+1』的道具」）。
      // 放在三瓶药水之后，永远占一行 —— 背包面板里的「+扩容」按钮继续存在，
      // 两条入口并存是预期，不是重复。
      //
      // 页数与价格都从逻辑层取，不在这儿重算：normBagPages 负责把存档里
      // 越界/脏的 bagPages 规整回 1..maxPages，价格表 pagePrices 也归 BAG 配置。
      // 在 hub 里另抄一份规整逻辑或价格表，迟早和 buyBagPage 漂开。
      const pages = L.normBagPages(state.meta.bagPages);
      const maxPages = C.BAG.maxPages;
      const perPage = C.BAG.cellsPerPage;
      const fullPages = pages >= maxPages;
      const pageCost = fullPages ? null : C.BAG.pagePrices[pages];
      const pagePoor = !fullPages && state.meta.coins < pageCost;
      out.push({
        kind: 'bag-page', id: 'bag-page', label: '背包页数+1',
        sub: fullPages
          ? '已解锁全部 ' + maxPages + ' 页 · 共 ' + (maxPages * perPage) + ' 格'
          : '当前 ' + pages + '/' + maxPages + ' 页 · 解锁后 ' + ((pages + 1) * perPage) + ' 格',
        cost: pageCost,
        // verb 决定按钮文案：面板的 panelButtonText 见到 verb 就渲染成
        // 「购买 · 价格」（与兵器架一致）；不给的话按钮会退化成裸数字。
        verb: '购买',
        enabled: !fullPages && !pagePoor,
        disabledReason: fullPages ? '已解锁全部 ' + maxPages + ' 页' : (pagePoor ? '铜币不够' : ''),
      });
    } else if (zoneId === 'forgewear') {
      // 兵器架：列出**全部 35 件**，包括买不起的和已拥有的。
      // 全列出来是有意的 —— 这里是玩家唯一能看到"还有什么装备、
      // 特效是什么"的地方，只列可买的会让构筑无从规划。
      // 排序：先按部位（头/身/背/武器/脚），再按档位/价格。
      //
      // 每一行给的是一条**动作**，不是"一个按钮的位置"：
      //   label = 物品名（让玩家认出是哪件），
      //   verb  = 动作本身（让按钮写得出来：购买 / 穿戴 / 升级 / 卸掉），
      //   cost  = 这条动作要花的铜币（0 = 不花钱）。
      // 早先这三件事挤在 label 与 cost 里，UI 只能靠硬编码阶梯去猜按钮写什么，
      // 于是"穿上"被写成"执行"、满级条目也是"执行"。
      // 另加 icon（Task 17）：四种动作说的是同一件东西，统一指向
      // 'eq-<部位>-<id>' —— 也就是它穿在英雄身上的那张贴图。按动作类型
      // 分别配色/换图会让玩家以为"升级"和"卸掉"是两件不同的装备。
      C.EQUIP_SLOTS.forEach(function (slot) {
        const ids = Object.keys(C.ALL_EQUIPMENT).filter(function (id) {
          return C.equipDef(id).slot === slot;
        }).sort(function (a, b) {
          return C.equipDef(a).price - C.equipDef(b).price;
        });
        ids.forEach(function (id) {
          const def = C.equipDef(id);
          const owned = L.equipOwned(state, id);
          const slotName = C.EQUIP_SLOT_NAMES[slot] || slot;
          const maxLv = C.equipMaxLevel(id);
          const ult = def.kind === 'special';
          if (owned === 'equipped') {
            // 穿在身上：升级 + 卸掉，两条都要在。
            // 只留"卸掉"会让升级失去入口（现在升级本来就靠这个按钮）；
            // 只留"升级"则玩家没法把身上这件换下来。
            const lv = (state.meta.equipment[slot] || {}).level || 1;
            const up = L.equipUpgradeCost(state, id);
            const poor = up !== null && state.meta.coins < up;
            out.push({
              kind: up === null ? 'equip-owned' : 'equip-upgrade',
              id: 'eq-' + id,
              label: def.name,
              // 满级时按钮不写"升级"（点了也不会涨级），写"已满级"并禁用。
              verb: up === null ? '已满级' : '升级',
              sub: slotName + ' · Lv.' + lv + '/' + maxLv + ' · ' + def.desc,
              cost: up === null ? 0 : up,
              enabled: up !== null && !poor,
              disabledReason: up === null ? '已满级 Lv.' + lv : (poor ? '铜币不够' : ''),
              ultimate: ult,
              icon: 'eq-' + slot + '-' + id,
              payload: { id: id, slot: slot },
            });
            out.push({
              kind: 'equip-unequip',
              id: 'eq-' + id + '-off',
              label: def.name,
              verb: '卸掉',
              sub: slotName + ' · 放回背包，等级保留 · ' + def.desc,
              cost: 0,
              enabled: true,
              disabledReason: '',
              ultimate: ult,
              icon: 'eq-' + slot + '-' + id,
              payload: { id: id, slot: slot },
            });
          } else if (owned === 'owned') {
            // 在背包里：穿戴，并把**那一条**的 uid 一起带出去。
            const bi = bestBagIndex(state, id);
            const entry = bi >= 0 ? state.meta.bag[bi] : null;
            const lv = (entry && entry.level) || 1;
            out.push({
              kind: 'equip-wear',
              id: 'eq-' + id,
              label: def.name,
              verb: '穿戴',
              sub: slotName + ' · Lv.' + lv + ' · ' + def.desc,
              cost: 0,
              enabled: true,
              disabledReason: '',
              ultimate: ult,
              icon: 'eq-' + slot + '-' + id,
              payload: { id: id, slot: slot, uid: entry ? entry.uid : undefined },
            });
          } else {
            // 还没有：购买。买了自然进背包，下一屏就会变成"穿戴"。
            const poor = state.meta.coins < def.price;
            out.push({
              kind: 'equip-buy',
              id: 'eq-' + id,
              label: def.name,
              verb: '购买',
              sub: slotName + ' · ' + def.desc,
              cost: def.price,
              enabled: !poor,
              disabledReason: poor ? '铜币不够' : '',
              ultimate: ult,
              icon: 'eq-' + slot + '-' + id,
              payload: { id: id, slot: slot },
            });
          }
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
      // Boss 挑战：三档难度对应不同的装备门槛（PM 定的验收标准）。
      // 单独入口而不是混进普通波次 —— 玩家需要能选择何时挑战。
      Object.keys(C.BOSS.tiers).forEach((t) => {
        const tier = C.BOSS.tiers[t];
        out.push({
          kind: 'boss', id: 'boss-' + t,
          label: '★ ' + tier.label + ' · 藤蔓巨像',
          sub: tier.hint + ' · 5 个技能 · 全屏技需卡无敌帧',
          cost: 0, enabled: true, disabledReason: '',
          payload: { bossTier: t },
        });
      });
    }
    // 兵器架页签：全部 / 未拥有 / 已拥有 / 已穿戴 / 特殊。
    // 过滤放在动作生成**之后**：三态（购买 / 穿戴 / 升级+卸掉）由装备状态决定，
    // 页签只决定"这一屏显示哪一类"，两者互不影响 ——
    // 反过来做就会让"未拥有"页签里的件丢掉购买动作。
    if (zoneId === 'forgewear' && filter && filter !== 'all') {
      out = out.filter(function (a) {
        const def = a.payload && C.equipDef(a.payload.id);
        if (!def) return false;
        if (filter === 'special') return def.kind === 'special';
        const held = L.equipOwned(state, a.payload.id);
        if (filter === 'unowned') return !held;
        if (filter === 'owned') return !!held;
        if (filter === 'worn') return held === 'equipped';
        return true;   // 未知页签退化为不过滤：宁可多显示，也别给一片空白
      });
    }
    // 铁匠铺页签：全部 / 攻击 / 生存 / 机动（Task 17）。
    // 和兵器架同一套口径：filter 缺省或 'all' 不过滤、未知分类退化为不过滤。
    // 只是这一屏只有三行，"多显示几条"的代价远小于"配错 id 就整页空白"。
    if (zoneId === 'anvil' && filter && filter !== 'all'
        && UPGRADE_CATS.indexOf(filter) >= 0) {
      out = out.filter(function (a) { return a.cat === filter; });
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
    if (action.kind === 'potion') return L.buyPotion(state, action.payload.id, 1);
    // 扩容不在这儿算钱也不在这儿改页数：价格表、上限、扣款都在
    // buyBagPage 一处，面板只是把那一行摆出来。这里再抄一遍就成了两套真相。
    if (action.kind === 'bag-page') return L.buyBagPage(state);
    if (action.kind === 'equip-buy') return L.buyEquipment(state, action.payload.id);
    // uid 必须一路透传：同 id 的重复件各是各的，掉了 uid 就只能退回
    // "第一件同 id"，于是面板写的等级和实际穿/升的那件对不上。
    if (action.kind === 'equip-wear') {
      return L.equipItem(state, action.payload.id, action.payload.uid);
    }
    if (action.kind === 'equip-upgrade') {
      return L.upgradeEquipment(state, action.payload.id, action.payload.uid);
    }
    // 卸掉不需要 uid：身上某个部位只有一件。
    if (action.kind === 'equip-unequip') return L.unequipSlot(state, action.payload.slot);
    if (action.kind === 'equip-owned') return L.equipItem(state, action.payload.id);
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
