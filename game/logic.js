/**
 * logic.js — 纯模拟层。不引用 DOM、Canvas、window、localStorage。
 *
 * 这一层的存在就是为了可测：CI 里能用 Node 直接跑完整局，
 * 用固定随机种子断言波次推进、命中判定、战利品结算、作物成熟、存档往返。
 * 渲染只读 state，从不改 state。
 *
 * 与浏览器/Node 双端兼容：浏览器挂到 globalThis.GameLogic，Node 走 module.exports。
 */
(function (global) {
  'use strict';

  const C = (typeof module !== 'undefined' && module.exports)
    ? require('./config.js')
    : global.GameConfig;

  const STATE_VERSION = 6;

  // ---------------------------------------------------------------- 随机数
  // 用可序列化的 mulberry32：种子存在 state 里，
  // 于是「读档后继续跑」和「同种子重跑」结果完全一致，测试才能断言。
  function nextRandom(state) {
    let t = (state.rngState = (state.rngState + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function randRange(state, lo, hi) {
    return lo + nextRandom(state) * (hi - lo);
  }

  // ---------------------------------------------------------------- 建档 / 派生
  function createState(seed) {
    const s = {
      version: STATE_VERSION,
      seed: seed >>> 0 || 1,
      rngState: seed >>> 0 || 1,
      phase: 'farm',
      meta: {
        coins: 0,
        seeds: 3,                       // 开局给 3 颗种子，让第一局就有经营决策
        upgrades: { damage: 0, maxHp: 0, speed: 0 },
        // 技能全部从 1 级起步：可用，但升级要靠铜币。
        skills: { whirl: 1, blink: 1, slam: 1, cry: 1, nova: 1 },
        runsCompleted: 0,
        runsWon: 0,
        bestWave: 0,
        potions: { heal: 0, strength: 0, wall: 0 },
        // 五个装备位（设计文档 §4.8）。空位是 null，不是 undefined ——
        // 后者在 JSON 往返后会消失，导致"装备了但读不到"。
        equipment: { head: null, torso: null, back: null, weapon: null, feet: null },
        // 背包条目数组（v6 起）。旧版是「id 列表 + 按 id 的等级表」，
        // 同一 id 只能记一件，装不下重复掉落 —— 所以改成每件一条记录。
        bag: [],
        bagPages: 1,                     // 已解锁页数，容量 = 页数 × 每页格数
        // 条目的 uid 计数器。必须存档（放在 meta 里），否则读档后
        // 新条目会从 1 重新计数，和旧条目的 uid 撞车。
        uidSeq: 0,
        // 音效与静音（Task 12 读写这里）。老档没有这个字段，迁移负责补。
        settings: { volume: 0.30, muted: false },
      },
      farm: {
        plots: new Array(C.FARM.cols * C.FARM.rows).fill(null).map(function () {
          return { state: 'empty', growth: 0 };
        }),
      },
      run: null,
      lastResult: null,
    };
    return s;
  }

  /**
   * 把五件已装备物品的加成汇总成一个加数/乘数包。
   *
   * 汇总集中在这里，而不是散落在 playerStats 里逐件查 ——
   * 特效装备（护盾、反弹、专属技能）也需要"我现在穿了什么"这个视图，
   * 让它们各自重算一遍必然会出现两处口径不一致。
   *
   * 等级只缩放**强度参数**（equipEffectMul）。扣血类乘数是"越小越强"，
   * 倍率作用方向相反，所以用 1-(1-v)*mul 缩放缺口，
   * 否则升级后减伤反而变成放大伤害（0.94 → 0.94×1.08 = 1.015）。
   */
  function equipBonus(state) {
    const out = {
      maxHp: 0, damage: 0, speedMul: 1, hurtMul: 1,
      fx: [],                       // 生效中的特效列表（含等级倍率）
      ids: {},                      // slot -> id，便于特效查询
    };
    const eq = (state.meta && state.meta.equipment) || null;
    if (!eq) return out;

    C.EQUIP_SLOTS.forEach(function (slot) {
      const item = eq[slot];
      if (!item || !item.id) return;
      const def = C.equipDef(item.id);
      if (!def) return;
      const lv = Math.max(1, item.level || 1);
      const mul = C.equipEffectMul(lv);
      out.ids[slot] = item.id;

      const m = def.mods;
      if (m) {
        if (m.maxHp) out.maxHp += Math.round(m.maxHp * mul);
        if (m.damage) out.damage += Math.round(m.damage * mul);
        if (m.speedMul) out.speedMul *= 1 + (m.speedMul - 1) * mul;
        if (m.hurtMul) out.hurtMul *= 1 - (1 - m.hurtMul) * mul;
      }
      if (def.fx) out.fx.push(Object.assign({ level: lv, mul: mul }, def.fx));
    });
    return out;
  }

  /** 某个特效是否生效（按机制 id 查）。特效装备的机制判断都走这里。 */
  function hasFx(state, fxId) {
    const eq = (state.meta && state.meta.equipment) || null;
    if (!eq) return null;
    let found = null;
    C.EQUIP_SLOTS.forEach(function (slot) {
      const item = eq[slot];
      if (!item || !item.id) return;
      const def = C.equipDef(item.id);
      if (def && def.fx && def.fx.id === fxId) {
        const lv = Math.max(1, item.level || 1);
        const mul = C.equipEffectMul(lv);
        const fx = def.fx;
        // 强度参数必须**已经乘好等级倍率**，不能只把 mul 挂上去让调用点自己乘。
        // 之前 thorns 读 th3.reflect 拿到的是 1 级原始值（0.30 → 0.30），
        // 而 equipBonus 走的是另一条路已经乘过 —— 两处口径不一致，
        // 结果是"升级荆棘甲完全不加强"这种静默失效。
        found = Object.assign({ level: lv, mul: mul }, fx);
        Object.keys(fx).forEach(function (k) {
          if (typeof fx[k] === 'number' && k !== 'level') {
            found[k] = fx[k] * mul;
          }
        });
      }
    });
    return found;
  }

  function playerStats(state) {
    const up = state.meta.upgrades;
    const eb = equipBonus(state);
    return {
      maxHp: C.BASE_HP + up.maxHp * C.UPGRADES.maxHp.perLevel + eb.maxHp,
      damage: C.BASE_DAMAGE + up.damage * C.UPGRADES.damage.perLevel + eb.damage,
      speed: C.PLAYER_SPEED * (1 + up.speed * C.UPGRADES.speed.perLevel) * eb.speedMul,
      hurtMul: eb.hurtMul,
    };
  }

  function maturePlots(state) {
    return state.farm.plots.filter(function (p) { return p.state === 'mature'; }).length;
  }
  /**
   * 统一的受伤入口。
   *
   * 之前六处伤害各自写 `p.hp -= x`，加"减伤"就必须改六遍，
   * 漏一处就会出现"坚壁药有时管用有时不管用"这种极难复现的 bug。
   * 集中到一个函数后，减伤只在这里生效一次。
   *
   * 需要 state 是因为装备减伤、低血护盾、相位战靴都写在 meta 里；
   * 只传 p 的话这些机制只能各调用点自己实现，等于又退回六处各写一遍。
   */
  function hurtPlayer(state, run, p, amount) {
    // 荆棘甲：近身受击时反弹一部分伤害给攻击者。
    // 攻击者从"贴身的敌人"里现找，而不是让每个调用点自己传 ——
    // 六处调用点各传一遍 attacker 必然会漏，而漏掉的表现是
    // "荆棘甲有时不反伤"，玩家只会以为是随机数。
    const thorns = hasFx(state, 'thorns');
    if (thorns && run && Array.isArray(run.enemies)) {
      const reflect = thorns.reflect * thorns.mul;
      const src = run.enemies.filter(function (e) {
        return e.state !== 'dead' && !e.isBoss
          && Math.abs(e.x - p.x) < e.radius + C.PLAYER_W / 2 + 12
          && Math.abs(e.z - p.z) < C.ATTACK_DEPTH + 12;
      })[0];
      if (src) {
        src.hp -= Math.max(1, Math.round(amount * reflect));
        src.hitFlash = 0.12;
        if (src.hp <= 0) killEnemy(state, run, src);
      }
    }

    let mul = (p.potionBuff && p.potionBuff.hurtMul) || 1;
    mul *= playerStats(state).hurtMul;

    // 格挡（守誓者专属技能）：期间大幅减伤
    if (p.blockTimer > 0) {
      const blk = C.SPECIAL_SKILLS.block;
      mul *= blk.hurtMul;
    }

    // 庇护胸铠：血量低于阈值时额外减伤，且只在阈值下生效
    const shield = hasFx(state, 'lowHpShield');
    if (shield && p.hp / p.maxHp < shield.threshold) {
      const fxMul = 1 - (1 - shield.hurtMul) * shield.mul;
      mul *= fxMul;
    }

    // 向上取整，避免 0.5 倍后出现小数血量（血条会显示成 12.5）
    const dealt = Math.max(1, Math.ceil(amount * mul));

    // 烬灰斗篷：受击时向周身炸出一圈火，逼退贴身的小怪。
    // 结算放在扣血**之后**并加冷却，否则被围殴时每帧触发一次，
    // 等于给了一件"越被打越强"的无限 AOE。
    const ash = hasFx(state, 'ashBurst');
    if (ash && (p.ashCd || 0) <= 0) {
      p.ashCd = 0.6;
      const ashDmg = Math.max(1, Math.round(ash.damage * ash.mul));
      run.enemies.forEach(function (o) {
        if (o.state === 'dead' || o.isBoss) return;
        if (Math.hypot(o.x - p.x, o.z - p.z) > ash.radius) return;
        o.hp -= ashDmg;
        o.hitFlash = 0.12;
        const dx = o.x - p.x, dz = o.z - p.z;
        const d = Math.hypot(dx, dz) || 1;
        o.vx = (dx / d) * 260;
        o.vz = (dz / d) * 260;
        if (o.hp <= 0) killEnemy(state, run, o);
      });
      pushEffect(run, 'ring', p.x, p.z, ash.radius, 0.35, 0xff9a6c);
    }

    // 相位战靴：致命伤免疫一次并回血，每局只有一次。
    // 必须在扣血**之前**判断，否则玩家会先死再被"救回来"，
    // 血条闪一下归零，看起来像 bug。
    if (p.hp - dealt <= 0) {
      const ward = hasFx(state, 'deathWard');
      if (ward && !p.deathWardUsed) {
        p.deathWardUsed = true;
        p.hp = Math.min(p.maxHp, Math.max(1, Math.round(ward.heal * ward.mul)));
        p.invuln = C.INVULN_AFTER_HIT * 2;
        if (run) pushEffect(run, 'ring', p.x, p.z, 130, 0.6, 0xc9a6ff);
        return p.hp;
      }
    }

    p.hp -= dealt;
    p.invuln = C.INVULN_AFTER_HIT;
    return p.hp;
  }
  function passiveIncome(state) {
    return maturePlots(state) * C.FARM.yieldPerPlot;
  }

  function skillCost(state, key) {
    const def = C.SKILLS[key];
    if (!def) return null;
    const lvl = state.meta.skills[key];
    if (lvl >= def.maxLevel) return null;
    return Math.round(def.baseCost * Math.pow(def.costGrowth, lvl - 1));
  }

  function buySkill(state, key) {
    if (!C.SKILLS[key]) return { ok: false, reason: '没有这个技能' };
    const current = state.meta.skills[key];
    const lvl = current === undefined ? 1 : current;
    state.meta.skills[key] = lvl;                  // 兼容旧存档
    const cost = skillCost(state, key);
    if (cost === null) return { ok: false, reason: '已满级' };
    if (state.meta.coins < cost) return { ok: false, reason: '铜币不够' };
    state.meta.coins -= cost;
    state.meta.skills[key] = lvl + 1;
    return { ok: true };
  }

  /**
   * 技能在给定等级下的数值。
   *
   * 加 state 参数是为了让**装备改造**能接进来（§4.6）。改造必须作用在这里，
   * 而不是各技能分支里各写一遍 —— 6 件改造散在 5 个分支中，
   * 漏一处就是"买了装备没变化"，而单元测试不会发现。
   */
  function skillStats(skillKey, level, state) {
    const def = C.SKILLS[skillKey];
    const lv = Math.max(1, level || 1) - 1;
    const out = {
      // 战吼没有伤害字段，用 0 兜底，否则会算出 NaN 并污染下游计算
      damage: (def.damage || 0) + (def.damagePerLevel || 0) * lv,
      cooldown: Math.max(1.2, def.cooldown - (def.cdPerLevel || 0) * lv),
      radius: (def.radius || def.forwardRange || 0) + (def.radiusPerLevel || 0) * lv,
      heal: (def.heal || 0) + (def.healPerLevel || 0) * lv,
    };
    if (!state) return out;

    // 战斧：震地范围 +50%、冷却 +15%
    if (skillKey === 'slam') {
      const wide = hasFx(state, 'slamWide');
      if (wide) {
        out.radius *= 1 + (wide.areaMul - 1) * wide.mul;
        out.cooldown *= 1 + (wide.cdMul - 1) * wide.mul;
      }
      // 熔火战靴的灼烧半径也跟着震地范围走
      const burn = hasFx(state, 'slamBurn');
      if (burn) out.burn = { dps: burn.dps * burn.mul, duration: burn.duration,
                             radius: burn.radius * burn.mul };
    }
    // 三叉圣杖：大招范围 +20%
    if (skillKey === 'nova') {
      const ult = hasFx(state, 'ultWide');
      if (ult) out.radius *= 1 + (ult.areaMul - 1) * ult.mul;
    }
    // 虚空之刃：裂风斩吸血
    if (skillKey === 'whirl') {
      const ls = hasFx(state, 'waveLifesteal');
      if (ls) out.lifesteal = ls.lifesteal * ls.mul;
    }
    return out;
  }


  // ================================================================ 药水

  /**
   * 买药水。价格固定（不随等级递增），因为消耗品靠"每局都要买"限流，
   * 不靠涨价 —— 涨价会让后期直接买不起，出口反而被堵死。
   */
  function buyPotion(state, id, n) {
    const def = C.POTIONS[id];
    if (!def) return { ok: false, reason: '没有这种药' };
    if (!state.meta.potions) state.meta.potions = { heal: 0, strength: 0, wall: 0 };
    const want = n || 1;
    const held = state.meta.potions[id] || 0;
    const room = def.carry - held;
    if (room <= 0) return { ok: false, reason: '已带满 ' + def.carry + ' 瓶' };
    const count = Math.min(want, room);
    const cost = def.price * count;
    if (state.meta.coins < cost) return { ok: false, reason: '铜币不够' };
    state.meta.coins -= cost;
    state.meta.potions[id] = held + count;
    return { ok: true, count: count, cost: cost };
  }

  /**
   * 喝药水。
   *
   * 只在**战斗进行中**可用：基地/农场里喝药没有意义，
   * 而且会让玩家用铜币在基地回血，破坏"每局重置"的节奏。
   */
  function usePotion(state, id) {
    const def = C.POTIONS[id];
    if (!def) return { ok: false, reason: '没有这种药' };
    if (state.phase !== 'run' || !state.run) return { ok: false, reason: '不在战斗中' };
    const run = state.run;
    if (run.status !== 'active') return { ok: false, reason: '战斗已结束' };

    // 本局携带量是权威值；meta 只在结算后同步
    if (!run.potions) run.potions = { heal: 0, strength: 0, wall: 0 };
    if ((run.potions[id] || 0) <= 0) return { ok: false, reason: '没有携带' };

    const p = run.player;
    run.potions[id] -= 1;

    if (def.kind === 'instant') {
      p.hp = Math.min(p.maxHp, p.hp + def.heal);
      pushEffect(run, 'ring', p.x, p.z, 70, 0.35, def.color);
      return { ok: true, id: id };
    }

    // buff 类：同类药水刷新时长，不叠加倍率 ——
    // 允许叠加会让"连喝两瓶力量药"变成唯一最优解，把选择变成操作量竞赛。
    p.potionBuff = {
      id: id,
      timer: def.duration,
      damageMul: def.damageMul || 1,
      hurtMul: def.hurtMul || 1,
    };
    pushEffect(run, 'ring', p.x, p.z, 90, 0.4, def.color);
    return { ok: true, id: id };
  }

  /** 药水对伤害的乘数（力量药）。没有 buff 时恒为 1。 */
  function potionDamageMul(p) {
    return (p.potionBuff && p.potionBuff.damageMul) || 1;
  }

  function upgradeCost(state, key) {
    const def = C.UPGRADES[key];
    const lvl = state.meta.upgrades[key];
    if (lvl >= def.maxLevel) return null;
    return Math.round(def.base * Math.pow(def.growth, lvl));
  }

  // ---------------------------------------------------------------- 经营操作
  function plant(state, plotIndex) {
    const plot = state.farm.plots[plotIndex];
    if (!plot || plot.state !== 'empty') return { ok: false, reason: '这块田不是空的' };
    if (state.meta.seeds < C.FARM.seedCost) return { ok: false, reason: '种子不够' };
    state.meta.seeds -= C.FARM.seedCost;
    plot.state = 'growing';
    plot.growth = 0;
    return { ok: true };
  }

  function buyUpgrade(state, key) {
    if (!C.UPGRADES[key]) return { ok: false, reason: '没有这个强化' };
    const cost = upgradeCost(state, key);
    if (cost === null) return { ok: false, reason: '已满级' };
    if (state.meta.coins < cost) return { ok: false, reason: '铜币不够' };
    state.meta.coins -= cost;
    state.meta.upgrades[key] += 1;
    return { ok: true };
  }

  // ---------------------------------------------------------------- 背包条目
  // 背包是**条目数组**，每件一个 { id, level, uid }。
  //
  // 旧结构是「id 列表 + 按 id 的等级表」，它装不下重复件：同一件装备掉两把，
  // 只能记一个等级、一个位置。改成条目数组之后，重复件各占一格、各升各的级。
  // uid 是对外的稳定标识（DOM 用「第几格」做 key 会在排序后错位），
  // 它只活在条目里，不参与战斗中掉落的其它语义。
  // 每页格数从 config 取，逻辑层不再内联写死数值（CI 会检查这一点）。
  const BAG_GRID_PER_PAGE = C.BAG.cellsPerPage;

  /** 造一个带新 uid 的条目。uid 计数器挂在 state.meta 上，随存档走。 */
  function bagEntry(state, id, level) {
    return { id: id, level: level || 1, uid: nextUid(state) };
  }

  function nextUid(state) {
    const n = (state.meta.uidSeq || 0) + 1;
    state.meta.uidSeq = n;
    return 'u' + n;
  }

  /** 背包总格数 = 已解锁页数 × 每页格数。 */
  function bagCapacity(state) {
    return (state.meta.bagPages || 1) * BAG_GRID_PER_PAGE;
  }

  function bagCount(state) {
    return (state.meta.bag || []).length;
  }

  function bagAt(state, index) {
    const e = (state.meta.bag || [])[index];
    return e ? { id: e.id, level: e.level, uid: e.uid } : null;
  }

  /**
   * 下标落在第几页（0 基）。
   * 分页只是"视图"，背包仍然是一个连续数组 —— 排序由 UI 决定，
   * 逻辑层只负责回答"这一格在第几页"。
   */
  function pageOf(state, index) {
    return Math.floor(index / BAG_GRID_PER_PAGE);
  }

  /**
   * 第 page 页的 35 格。缺的补 null（DOM 渲染需要固定格数，
   * 否则最后一页会塌成一行，格子位置随件数跳动）。
   */
  function pageSlice(state, page) {
    const out = [];
    const start = page * BAG_GRID_PER_PAGE;
    for (let i = 0; i < BAG_GRID_PER_PAGE; i++) out.push(bagAt(state, start + i));
    return out;
  }

  /**
   * 买一页容量（设计 §4.7 的扩容线）。
   *
   * 页数是 1..maxPages；买第 N+1 页收 pagePrices[N] —— 页价表的第一项
   * 是 0（没有"第 0 页"可买），所以买第 2 页落在 pagePrices[1]。
   * 已到顶时返回 ok:false 而不是静默截断：静默截断会让玩家以为
   * 钱花了页也加了，实际上什么都没发生。
   */
  function buyBagPage(state) {
    if (!state.meta.bagPages) state.meta.bagPages = 1;
    const max = C.BAG.maxPages;
    if (state.meta.bagPages >= max) return { ok: false, reason: '已解锁全部 ' + max + ' 页' };
    const cost = C.BAG.pagePrices[state.meta.bagPages];
    if (state.meta.coins < cost) return { ok: false, reason: '铜币不够' };
    state.meta.coins -= cost;
    state.meta.bagPages += 1;
    return { ok: true, cost: cost, pages: state.meta.bagPages };
  }

  /** 放一件进背包，返回落位下标；容量内满了返回 -1（由调用方决定怎么办）。 */
  function bagAdd(state, id, level) {
    if (!state.meta.bag) state.meta.bag = [];
    if (!state.meta.bagPages) state.meta.bagPages = 1;
    if (state.meta.bag.length >= bagCapacity(state)) return -1;
    state.meta.bag.push(bagEntry(state, id, level || 1));
    return state.meta.bag.length - 1;
  }

  function bagRemove(state, index) {
    const bag = state.meta.bag || [];
    if (!(index >= 0 && index < bag.length)) return { ok: false, reason: '格子里没有东西' };
    bag.splice(index, 1);
    return { ok: true };
  }

  function bagIndexOfUid(state, uid) {
    const bag = state.meta.bag || [];
    for (let i = 0; i < bag.length; i++) if (bag[i].uid === uid) return i;
    return -1;
  }

  /** 背包里第一件该 id 的下标，没有返回 -1。 */
  function bagIndexOfId(state, id) {
    const bag = state.meta.bag || [];
    for (let i = 0; i < bag.length; i++) if (bag[i].id === id) return i;
    return -1;
  }

  // ---------------------------------------------------------------- 装备
  /**
   * 某件装备当前的持有状态。
   * 返回 'equipped' / 'owned' / null，供商店和面板决定显示"装备/换装/购买"。
   */
  function equipOwned(state, id) {
    const eq = state.meta.equipment;
    for (let i = 0; i < C.EQUIP_SLOTS.length; i++) {
      const it = eq[C.EQUIP_SLOTS[i]];
      if (it && it.id === id) return 'equipped';
    }
    if (bagIndexOfId(state, id) >= 0) return 'owned';
    return null;
  }

  /**
   * 购买装备。
   *
   * 买过的不再重复卖（返回"已拥有"），因为重复品只会在掉落路径出现 ——
   * 商店里允许重复购买等于让玩家白白花两次钱，那不是"选择"，那是陷阱。
   */
  function buyEquipment(state, id) {
    const def = C.equipDef(id);
    if (!def) return { ok: false, reason: '没有这件装备' };
    if (equipOwned(state, id)) return { ok: false, reason: '已拥有' };
    if (state.meta.coins < def.price) return { ok: false, reason: '铜币不够' };
    // 容量判定必须在扣钱**之前**：满包时先收钱再发现放不进去，
    // 就是一台可无限重复的铜币黑洞，而且玩家什么都拿不到。
    if (bagCount(state) >= bagCapacity(state)) return { ok: false, reason: '背包已满' };
    state.meta.coins -= def.price;
    // 新买的按 1 级入格。等级直接记在条目上，穿戴 / 卸下都跟着条目走，
    // 不会再出现"换出去再换回来就悄悄掉级"。
    bagAdd(state, id, 1);
    return { ok: true, id: id };
  }

  /**
   * 穿上一件装备。会自动把该位原有的装备放回背包 ——
   * 否则换装会凭空销毁装备，玩家会开始害怕换装，选择就死了。
   */
  function equipItem(state, id, uid) {
    const def = C.equipDef(id);
    if (!def) return { ok: false, reason: '没有这件装备' };
    if (equipOwned(state, id) === 'equipped') return { ok: false, reason: '已经装备着' };

    // 同 id 可能有两件（掉落会带重复品）。调用方点的是哪一件就穿哪一件，
    // 没给 uid（或 uid 已失效）才退回"第一件同 id"——老的两参数调用行为不变。
    let idx = uid ? bagIndexOfUid(state, uid) : -1;
    if (idx < 0) idx = bagIndexOfId(state, id);
    if (idx < 0) return { ok: false, reason: '背包里没有' };
    const entry = state.meta.bag.splice(idx, 1)[0];

    const prev = state.meta.equipment[def.slot];
    if (prev) {
      // 换下来的装备连同它的等级一起收回背包（条目自带等级），
      // 否则升级成果会丢：花了铜币升到 3 级、只是换把武器试一下，
      // 回来变成 1 级，这种惩罚会让"换装"这个核心乐趣直接废掉。
      bagAdd(state, prev.id, prev.level || 1);
    }

    state.meta.equipment[def.slot] = { id: id, level: (entry && entry.level) || 1 };

    // 换装可能改变生命上限。不能让当前血量超过新上限（血条会画到框外），
    // 但也不能白送血 —— 所以只做截断，不做补满。
    if (state.run && state.run.player) {
      const st = playerStats(state);
      state.run.player.maxHp = st.maxHp;
      if (state.run.player.hp > st.maxHp) state.run.player.hp = st.maxHp;
    }
    return { ok: true, id: id, slot: def.slot };
  }

  /** 卸下某个部位，放回背包。 */
  function unequipSlot(state, slot) {
    if (C.EQUIP_SLOTS.indexOf(slot) < 0) return { ok: false, reason: '没有这个部位' };
    const it = state.meta.equipment[slot];
    if (!it) return { ok: false, reason: '这个部位是空的' };
    // 满包时拒绝，**不要先把部位清空**：清空之后再发现放不进去，
    // 装备就凭空消失了 —— 谎报成功比直接报错更糟（§4.7「不丢装备」）。
    if (bagCount(state) >= bagCapacity(state)) return { ok: false, reason: '背包已满' };
    state.meta.equipment[slot] = null;
    // 等级跟着条目走，不需要另一张表记账。
    bagAdd(state, it.id, it.level || 1);

    if (state.run && state.run.player) {
      const st = playerStats(state);
      state.run.player.maxHp = st.maxHp;
      if (state.run.player.hp > st.maxHp) state.run.player.hp = st.maxHp;
    }
    return { ok: true, id: it.id };
  }

  /**
   * 升级价格：下一级的价格。满级返回 null。
   *
   * 带上 uid 时按**那一条**背包条目报价：同 id 的重复件各升各的级，
   * 报价必须跟着玩家实际点中的那件走，否则会出现"按 A 件的价收钱、升 B 件"。
   */
  function equipUpgradeCost(state, id, uid) {
    const def = C.equipDef(id);
    if (!def) return null;
    const max = C.equipMaxLevel(id);
    const held = equipOwned(state, id);
    if (!held) return null;                      // 没拥有就不能升级
    let level = 1;
    if (held === 'equipped') {
      // 身上只有一件，uid 在这里不适用：等级就是装备位上的等级。
      C.EQUIP_SLOTS.forEach(function (s) {
        const it = state.meta.equipment[s];
        if (it && it.id === id) level = it.level || 1;
      });
    } else {
      let idx = uid ? bagIndexOfUid(state, uid) : -1;
      if (idx < 0) idx = bagIndexOfId(state, id);
      level = (idx >= 0 && state.meta.bag[idx].level) || 1;
    }
    if (level >= max) return null;
    return C.equipPrice(id, level + 1);
  }

  /**
   * 升级装备。**只提升强度参数，不改变机制**（§4.4）。
   *
   * 背包里的装备与身上的装备都要能升级，所以等级存在两处：
   * 装备位上直接带 level，背包条目里也各自带 level（v6 起）。
   */
  function upgradeEquipment(state, id, uid) {
    // 报价与实收必须是同一件：uid 一路透传给 equipUpgradeCost。
    const cost = equipUpgradeCost(state, id, uid);
    if (cost === null) {
      const def = C.equipDef(id);
      if (!def) return { ok: false, reason: '没有这件装备' };
      if (!equipOwned(state, id)) return { ok: false, reason: '还没拥有' };
      return { ok: false, reason: '已满级' };
    }
    if (state.meta.coins < cost) return { ok: false, reason: '铜币不够' };
    state.meta.coins -= cost;

    const held = equipOwned(state, id);
    if (held === 'equipped') {
      C.EQUIP_SLOTS.forEach(function (s) {
        const it = state.meta.equipment[s];
        if (it && it.id === id) it.level = (it.level || 1) + 1;
      });
    } else {
      // 背包里只升一件：同一 id 可能有重复件，各升各的级，
      // 不能把它们一起抬上去（那等于凭空送出升级）。
      // 升的必须是 equipUpgradeCost 报价时用的那一条，否则收错价、升错件。
      let idx = uid ? bagIndexOfUid(state, uid) : -1;
      if (idx < 0) idx = bagIndexOfId(state, id);
      if (idx >= 0) state.meta.bag[idx].level = (state.meta.bag[idx].level || 1) + 1;
    }

    if (state.run && state.run.player) {
      const st = playerStats(state);
      state.run.player.maxHp = st.maxHp;
      if (state.run.player.hp > st.maxHp) state.run.player.hp = st.maxHp;
    }
    return { ok: true, id: id, cost: cost };
  }

  /**
   * 掉落判定（§4.3）。只掉基础装备，5% 概率。
   *
   * 重复品也一律进背包：产品决定是"每件掉落都进包，卖不卖玩家自己定"，
   * 所以这里不再有折算，只标记 duplicate 供 UI 提示用。
   */
  function rollEquipDrop(state) {
    const pool = Object.keys(C.ALL_EQUIPMENT).filter(function (id) {
      return C.ALL_EQUIPMENT[id].kind === 'base';
    });
    if (pool.length === 0) return null;
    const id = pool[Math.floor(nextRandom(state) * pool.length)];
    const duplicate = !!equipOwned(state, id);
    // 容量感知落位：全满时不丢、也不越界（§4.7「不丢装备」），
    // 而是覆盖最后已解锁页的末格，由 UI 提示"背包已满"。
    const idx = bagAdd(state, id, 1);
    if (idx === -1) {
      const last = bagCapacity(state) - 1;
      // 覆盖前先把被顶掉的那件带出去。玩家有权知道"我刚丢的是哪一件"——
      // 只报 bagFull 而说不出覆盖了谁，UI 就只能干巴巴地说"背包已满"，
      // 而玩家手里已经白头掉一件装备了。被覆盖的**必须**是最后一格那件，
      // 不是随机的某一格（掉落不该变成随机销毁）。
      const victim = state.meta.bag[last];
      state.meta.bag[last] = bagEntry(state, id, 1);
      return {
        id: id, duplicate: duplicate, bagFull: true,
        overwrote: victim ? { id: victim.id, uid: victim.uid, level: victim.level } : null,
      };
    }
    return { id: id, duplicate: duplicate, bagFull: false };
  }

  /** 敌人死亡时调用：按概率决定是否掉装备。返回掉落结果或 null。 */
  function tryEquipDrop(state) {
    if (nextRandom(state) >= C.EQUIP_DROP.chance) return null;
    return rollEquipDrop(state);
  }

  // ---------------------------------------------------------------- 开局
  function startRun(state, difficultyId) {
    const diff = C.difficultyById(difficultyId);
    const st = playerStats(state);
    state.phase = 'run';
    state.run = {
      difficultyId: diff.id,
      status: 'active',
      waveIndex: 0,
      waveState: 'spawning',
      breakTimer: 0,
      spawnQueue: [],
      spawnTimer: 0,
      enemies: [],
      loot: { coins: 0, seeds: 0 },
      effects: [],
      projectiles: [],
      pickups: [],
      // 装备制造的地面区域（熔火战靴的灼烧、霜缚护甲的冰霜）。
      // 与 effects 分开：effects 是纯视觉、几帧就消失，
      // 区域要参与逐帧伤害/减速结算，生命周期也长得多。
      burnZones: [],
      frostZones: [],
      equipDrops: [],
      elapsed: 0,
      player: {
        x: C.FIELD_W / 2,
        z: C.FIELD_D / 2,
        h: 0,
        vy: 0,
        hp: st.maxHp,
        maxHp: st.maxHp,
        facing: 1,
        attackTimer: 0,
        attackCd: 0,
        invuln: 0,
        swingId: 0,
        hitIds: [],
        comboStep: 0,
        blockTimer: 0,          // 格挡（守誓者）剩余时间
        deathWardUsed: false,   // 相位战靴本局是否已用掉
        comboTimer: 0,
        cooldowns: { whirl: 0, blink: 0, slam: 0, cry: 0, nova: 0 },
        buffTimer: 0,
        potionBuff: null,
        specialCd: 0,          // 专属技能冷却剩余
        ashCd: 0,               // 烬灰斗篷的反伤爆发冷却
        casting: null,
      },
      // 本局携带的药水：从 meta 快照一份。
      // 绝对不能让本局直接扣 meta —— 中途退出/重开就会把药水永久吃掉，
      // 玩家在基地买的药会"凭空消失"，而结算界面又取不到证据。
      potions: {
        heal: (state.meta.potions && state.meta.potions.heal) || 0,
        strength: (state.meta.potions && state.meta.potions.strength) || 0,
        wall: (state.meta.potions && state.meta.potions.wall) || 0,
      },
      diff: diff,
    };
    buildWave(state);
    return state.run;
  }

  function buildWave(state) {
    const run = state.run;
    const diff = run.diff;
    const comp = C.waveComposition(run.waveIndex, diff);
    const queue = [];
    Object.keys(comp).forEach(function (kind) {
      for (let i = 0; i < comp[kind]; i++) queue.push(kind);
    });
    // 洗牌用同一个确定性 RNG，保证同种子同波次构成一致
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(nextRandom(state) * (i + 1));
      const tmp = queue[i]; queue[i] = queue[j]; queue[j] = tmp;
    }
    run.spawnQueue = queue;
    run.spawnTimer = 0;
    run.waveState = 'spawning';
  }

  function makeEnemy(state, kind, diff) {
    const def = C.ENEMIES[kind];
    const hp = Math.round(def.hp * diff.hpMul);
    // 从左右两侧进场，z 随机落在景深带内 —— 玩家必须用 W/S 去应对不同深度
    const fromLeft = nextRandom(state) < 0.5;
    return {
      id: ++state._eid || (state._eid = 1),
      kind: kind,
      x: fromLeft ? 40 : C.FIELD_W - 40,
      z: randRange(state, 30, C.FIELD_D - 30),
      h: 0,
      hp: hp,
      maxHp: hp,
      damage: Math.round(def.damage * diff.dmgMul),
      speed: def.speed * diff.speedMul,
      radius: def.radius,
      state: 'chase',
      timer: 0,
      fireCd: def.behavior === 'ranged' ? randRange(state, 0.9, 1.9) : 0,
      attackCd: 0,
      facing: fromLeft ? 1 : -1,
      hitFlash: 0,
      stun: 0,
      vx: 0,
      vz: 0,
    };
  }

  // ---------------------------------------------------------------- 每帧推进
  function step(state, input, dt) {
    if (state.phase !== 'run' || !state.run) return state;
    const run = state.run;
    if (run.status !== 'active') return state;

    dt = Math.min(dt, 0.05);                 // 夹住 dt，避免切页后大跳
    run.elapsed += dt;

    if (run.effects && run.effects.length) {
      run.effects.forEach(function (ef) { ef.timer -= dt; });
      run.effects = run.effects.filter(function (ef) { return ef.timer > 0; });
    }
    if (run.player.casting) {
      run.player.casting.timer -= dt;
      if (run.player.casting.timer <= 0) run.player.casting = null;
    }

    stepPlayer(state, run, input, dt);
    stepZones(state, run, dt);
    stepSpawning(state, run, dt);
    stepEnemies(state, run, dt);
    stepProjectiles(state, run, dt);
    stepPickups(state, run, dt);
    stepWave(state, run, dt);

    if (run.player.hp <= 0 && run.status === 'active') endRun(state, false);
    return state;
  }

  function stepPlayer(state, run, input, dt) {
    const p = run.player;
    const st = playerStats(state);

    p.attackTimer = Math.max(0, p.attackTimer - dt);
    p.attackCd = Math.max(0, p.attackCd - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    p.specialCd = Math.max(0, p.specialCd - dt);
    p.blockTimer = Math.max(0, p.blockTimer - dt);
    p.ashCd = Math.max(0, (p.ashCd || 0) - dt);

    // 冲刺：按住 Shift 加速。松开立刻恢复步行（不做惯性，操作要"跟手"）。
    p.sprinting = !!input.sprint;
    const speedMul = p.sprinting ? C.SPRINT_MULT : 1;
    const depthMul = p.sprinting ? C.SPRINT_DEPTH_MULT : 1;

    // 水平
    let mx = 0;
    if (input.left) mx -= 1;
    if (input.right) mx += 1;
    if (mx !== 0) {
      p.facing = mx;
      p.x += mx * st.speed * speedMul * dt;
    }
    // 景深：W/S 在 z 轴走动（这是与纯横版的关键区别）
    // 方向约定：z 越大 = 离镜头越远 = 屏幕上越靠上（render 里 sy = GROUND_Y - z*Z_TO_Y）。
    // 所以 W（屏幕向上）必须让 z **增大**。第一版写反了，按 W 会往下走。
    let mz = 0;
    if (input.up) mz += 1;
    if (input.down) mz -= 1;
    if (mz !== 0) p.z += mz * C.PLAYER_DEPTH_SPEED * depthMul * dt;

    // 冲刺时留残影（供渲染层用）
    p.runTrail = p.sprinting && (mx !== 0 || mz !== 0);

    // 跳跃
    if (input.jump && p.h === 0) p.vy = C.JUMP_V;
    if (p.h > 0 || p.vy > 0) {
      p.vy -= C.GRAVITY * dt;
      p.h += p.vy * dt;
      if (p.h <= 0) { p.h = 0; p.vy = 0; }
    }

    // 边界
    p.x = clamp(p.x, C.PLAYER_W / 2, C.FIELD_W - C.PLAYER_W / 2);
    p.z = clamp(p.z, 0, C.FIELD_D);

    // 冷却与增益计时
    if (!p.cooldowns) p.cooldowns = { whirl: 0, blink: 0, slam: 0, cry: 0, nova: 0 };
    C.SKILL_ORDER.forEach(function (k) {
      if (p.cooldowns[k] > 0) p.cooldowns[k] = Math.max(0, p.cooldowns[k] - dt);
    });
    p.buffTimer = Math.max(0, (p.buffTimer || 0) - dt);
    if (p.potionBuff) {
      p.potionBuff.timer -= dt;
      if (p.potionBuff.timer <= 0) p.potionBuff = null;
    }

    // 药水（1/2/3）：按下即用。justPressed 语义由渲染层保证，
    // 这里只认 input.potionN，长按不会连续消耗（每瓶都是一次资源）。
    if (input.potion1) usePotion(state, 'heal');
    if (input.potion2) usePotion(state, 'strength');
    if (input.potion3) usePotion(state, 'wall');

    // 技能（U/I/O/K/L）：冷却好了就释放
    C.SKILL_ORDER.forEach(function (k) {
      if (input[k]) tryCastSkill(state, run, p, k);
    });

    /*
     * 武器专属技能（V）。
     *
     * 与上面五个技能不同，它不是"天生就会"：只有装了带 grantSkill 的武器
     * （誓约剑 → 格挡、秘法典 → 二段闪）才有，卸下就没有。
     * castSpecial 内部会自己检查是否有对应武器，所以这里无脑转交即可 ——
     * 没装武器时它会直接返回 false，不需要在这里重复判断。
     */
    if (input.special) castSpecial(state, run, p);

    // 连击窗口倒计时：超时就回到第 1 段
    if (p.comboTimer > 0) {
      p.comboTimer = Math.max(0, p.comboTimer - dt);
      if (p.comboTimer === 0) p.comboStep = 0;
    }

    // 攻击（三段式：快 → 快 → 慢）
    if (input.attack && p.attackCd === 0) {
      const step = C.COMBO.steps[Math.min(p.comboStep, C.COMBO.steps.length - 1)];
      p.attackTimer = C.ATTACK_DURATION;
      p.attackCd = step.cooldown;
      p.swingId += 1;
      p.hitIds = [];
      p.comboDamageMul = step.damageMul;
      p.comboKnockback = step.knockback;
      p.comboStun = step.stun;
      p.comboRange = step.range;
      p.comboSwingStep = p.comboStep + 1;   // 渲染用：本次挥击是第几段
      p.comboStep = (p.comboStep + 1) % C.COMBO.steps.length;
      p.comboTimer = C.COMBO.window;
    }
    if (p.attackTimer > 0) resolveAttack(state, run, p, st);
  }

  /** 当前实际伤害：战吼与力量药生效期间按倍率提升。技能伤害也吃这个倍率。 */
  function currentDamage(state, p) {
    let d = playerStats(state).damage;
    if (p.buffTimer > 0) d *= C.SKILLS.cry.buffMult;
    d *= potionDamageMul(p);
    return d;
  }

  function pushEffect(run, kind, x, z, radius, time, color, facing, depth) {
    run.effects.push({ kind: kind, x: x, z: z, radius: radius,
                       timer: time, maxTimer: time, color: color,
                       facing: facing || 1, depth: depth || 40 });
  }

  /**
   * 技能释放。冷却未好则忽略（返回 false）。
   * 伤害类技能一律按 (x, z) 两轴的距离判定，与普攻一致 —— 深度轴必须贯穿所有玩法。
   */
  function tryCastSkill(state, run, p, key) {
    const def = C.SKILLS[key];
    if (!def) return false;
    if (p.cooldowns[key] > 0) return false;
    const level = state.meta.skills[key] || 1;
    const st = skillStats(key, level, state);
    // 直接乘增益倍率。原写法 (1 + current/base - 1) 代数上等价，
    // 但 BASE_DAMAGE 若变成 0 会除出 NaN。
    const dmg = st.damage * (p.buffTimer > 0 ? C.SKILLS.cry.buffMult : 1) * potionDamageMul(p);
    p.cooldowns[key] = st.cooldown;
    p.casting = { key: key, timer: def.fxTime };

    const hitRadius = function (rad, applyDamage, knockback) {
      run.enemies.forEach(function (e) {
        if (e.state === 'dead') return;
        const dist = Math.hypot(e.x - p.x, e.z - p.z);
        if (dist > rad) return;
        if (applyDamage) {
          e.hp -= Math.round(dmg);
          e.hitFlash = 0.12;
          if (e.hp <= 0) { killEnemy(state, run, e); return; }
        }
        if (knockback) {
          const dx = e.x - p.x, dz = e.z - p.z;
          const d = Math.hypot(dx, dz) || 1;
          e.vx = (dx / d) * knockback;
          e.vz = (dz / d) * knockback;
          if (def.stunTime) e.stun = Math.max(e.stun || 0, def.stunTime);
        }
      });
    };

    if (key === 'whirl') {
      // 朝前长条：只命中面朝方向、且在深度容差内的目标
      const range = def.forwardRange;
      const depth = def.forwardDepth;
      // 虚空之刃的吸血按**实际命中**结算，不是按施放次数 ——
      // 空放也能回血的话，最优解会变成原地刷技能。
      let dealtTotal = 0;
      run.enemies.forEach(function (e) {
        if (e.state === 'dead') return;
        const dx = (e.x - p.x) * p.facing;
        if (dx < -C.ATTACK_BACK || dx > range) return;
        if (Math.abs(e.z - p.z) > depth) return;
        const dealt = Math.round(dmg);
        e.hp -= dealt;
        dealtTotal += dealt;
        e.hitFlash = 0.12;
        e.vx = p.facing * (def.knockback || 0);
        if (def.stunTime) e.stun = Math.max(e.stun || 0, def.stunTime);
        if (e.hp <= 0) killEnemy(state, run, e);
      });
      if (st.lifesteal && dealtTotal > 0) {
        const heal = Math.max(1, Math.round(dealtTotal * st.lifesteal));
        p.hp = Math.min(p.maxHp, p.hp + heal);
      }
      pushEffect(run, 'wave', p.x, p.z, range, def.fxTime, def.fxColor, p.facing, depth);
    } else if (key === 'blink') {
      const fromX = p.x;
      const fromZ = p.z;
      p.x = clamp(p.x + p.facing * def.distance, C.PLAYER_W / 2, C.FIELD_W - C.PLAYER_W / 2);
      p.invuln = Math.max(p.invuln, def.iframes);
      // 描述承诺"沿途造成伤害"，判定要做成到线段的最短距离，
      // 而不是只结算落点 —— 否则一次穿过一排敌人只有落点那只受伤。
      run.enemies.forEach(function (e2) {
        if (e2.state === 'dead') return;
        if (distToSegment(e2.x, e2.z, fromX, fromZ, p.x, p.z) <= def.radius) {
          e2.hp -= Math.round(dmg);
          e2.hitFlash = 0.12;
          if (e2.hp <= 0) killEnemy(state, run, e2);
        }
      });
      pushEffect(run, 'trail', fromX, p.z, def.radius, def.fxTime, def.fxColor);
      pushEffect(run, 'ring', p.x, p.z, def.radius, def.fxTime, def.fxColor);
      // 霜缚护甲：落点留下冰霜，减速范围内的敌人
      const frost = hasFx(state, 'blinkFrost');
      if (frost) {
        run.frostZones.push({
          x: p.x, z: p.z, radius: frost.radius * frost.mul,
          slowMul: 1 - (1 - frost.slowMul) * frost.mul,
          timer: frost.duration, maxTimer: frost.duration,
        });
      }
    } else if (key === 'slam') {
      hitRadius(st.radius, true, def.knockback);
      pushEffect(run, 'burst', p.x, p.z, st.radius, def.fxTime, def.fxColor);
      // 熔火战靴：在落点留下灼烧地面
      if (st.burn) {
        run.burnZones.push({
          x: p.x, z: p.z, radius: st.burn.radius,
          dps: st.burn.dps, timer: st.burn.duration, maxTimer: st.burn.duration,
        });
      }
    } else if (key === 'cry') {
      p.hp = Math.min(p.maxHp, p.hp + st.heal);
      p.buffTimer = def.buffTime;
      pushEffect(run, 'aura', p.x, p.z, 90, def.fxTime, def.fxColor);
    } else if (key === 'nova') {
      hitRadius(st.radius, true, 260);
      pushEffect(run, 'nova', C.FIELD_W / 2, C.FIELD_D / 2, C.FIELD_W, def.fxTime, def.fxColor);
    }
    return true;
  }

  // ---------------------------------------------------------------- 专属技能

  /**
   * 当前装备授予的专属技能 id（没有则 null）。
   *
   * 专属技能**只在装备时存在**，所以技能栏必须动态显示 ——
   * 固定显示会让玩家以为卸下装备后还能用；而如果卸下后仍然可用，
   * 那"装备占武器位"这个代价就是假的，等于白送手段（§4.7）。
   */
  function specialSkillOf(state) {
    const eq = (state.meta && state.meta.equipment) || null;
    if (!eq || !eq.weapon || !eq.weapon.id) return null;
    const def = C.equipDef(eq.weapon.id);
    if (!def || !def.fx || def.fx.id !== 'grantSkill') return null;
    return def.fx.skill || null;
  }

  /** 释放专属技能。没有装备对应武器时直接返回 false。 */
  function castSpecial(state, run, p) {
    const id = specialSkillOf(state);
    if (!id) return false;
    const def = C.SPECIAL_SKILLS[id];
    if (!def) return false;
    if (p.specialCd > 0) return false;

    p.specialCd = def.cooldown;
    if (id === 'block') {
      p.blockTimer = def.duration;
      pushEffect(run, 'ring', p.x, p.z, 90, 0.4, def.color);
    } else if (id === 'blink2') {
      p.x = clamp(p.x + p.facing * def.distance,
                  C.PLAYER_W / 2, C.FIELD_W - C.PLAYER_W / 2);
      p.invuln = Math.max(p.invuln, def.invuln);
      pushEffect(run, 'trail', p.x - p.facing * def.distance, p.z, 40, 0.3, def.color);
      pushEffect(run, 'ring', p.x, p.z, 90, 0.4, def.color);
    }
    return true;
  }

  /** 地面区域逐帧结算：灼烧（伤害）与冰霜（减速）。 */
  function stepZones(state, run, dt) {
    // 灼烧：每秒 dps 点伤害，按帧分摊。
    // 用 accumulated 而不是每帧取整 —— 否则 dps 9 在 60fps 下
    // 每帧 0.15 点会被 Math.round 抹成 0，灼烧等于不存在。
    for (let i = run.burnZones.length - 1; i >= 0; i--) {
      const zn = run.burnZones[i];
      zn.timer -= dt;
      zn.acc = (zn.acc || 0) + zn.dps * dt;
      const tick = Math.floor(zn.acc);
      if (tick > 0) {
        zn.acc -= tick;
        run.enemies.forEach(function (e) {
          if (e.state === 'dead') return;
          if (Math.hypot(e.x - zn.x, e.z - zn.z) > zn.radius) return;
          e.hp -= tick;
          e.hitFlash = 0.1;
          if (e.hp <= 0) killEnemy(state, run, e);
        });
      }
      if (zn.timer <= 0) run.burnZones.splice(i, 1);
    }

    // 冰霜：减速区域内的敌人
    for (let j = run.frostZones.length - 1; j >= 0; j--) {
      const fz = run.frostZones[j];
      fz.timer -= dt;
      run.enemies.forEach(function (e) {
        if (e.state === 'dead') return;
        if (Math.hypot(e.x - fz.x, e.z - fz.z) > fz.radius) return;
        e.slowTimer = Math.max(e.slowTimer || 0, 0.2);
        e.slowMul = fz.slowMul;
      });
      if (fz.timer <= 0) run.frostZones.splice(j, 1);
    }
  }

  /**
   * 命中判定：x 方向在朝向前方的矩形内，且 **z 差不超过容差**。
   * 这一步正是 W/S 深度轴有意义的地方——只按 x 判会变成纯横版。
   */
  function resolveAttack(state, run, p, st) {
    for (let i = 0; i < run.enemies.length; i++) {
      const e = run.enemies[i];
      if (e.state === 'dead' || p.hitIds.indexOf(e.id) >= 0) continue;
      const dx = (e.x - p.x) * p.facing;
      const dz = Math.abs(e.z - p.z);
      const reach = p.comboRange || C.ATTACK_RANGE;
      const inFront = dx > -C.ATTACK_BACK && dx < reach;
      const sameDepth = dz <= C.ATTACK_DEPTH;
      // 这里原本还有一条 Math.abs(p.h - e.h) < 70 的高度门限，
      // 但最大跳跃高度 = 430²/(2·1500) ≈ 61.6px，条件恒真，是死代码。
      // 已删除：命中判定只看 (x, z)，跳跃不提供额外豁免。
      if (inFront && sameDepth) {
        // 取整：三段伤害应当是 12 / 14 / 22 这样的整数，
        // 浮点数会让伤害数字显示成 13.799999999999997
        const dealt = Math.round(currentDamage(state, p) * (p.comboDamageMul || 1));
        e.hp -= dealt;
        e.hitFlash = 0.12;
        p.hitIds.push(e.id);
        e.vx = p.facing * (p.comboKnockback || 420);
        if (p.comboStun) e.stun = Math.max(e.stun || 0, p.comboStun);

        // 雷冠：第三段命中时炸出电光，对周围敌人附带伤害。
        // 绑在**第三段**而不是每一段，是为了让它真正奖励"打完连段"：
        // 每段都触发的话，它就退化成一次无条件 AOE，连段节奏就没意义了。
        const shock = hasFx(state, 'comboShock');
        if (shock && p.comboSwingStep === C.COMBO.steps.length) {
          const shockDmg = Math.max(1, Math.round(dealt * shock.damageMul));
          run.enemies.forEach(function (o) {
            if (o.state === 'dead' || o === e) return;
            if (Math.hypot(o.x - e.x, o.z - e.z) > shock.radius) return;
            o.hp -= shockDmg;
            o.hitFlash = 0.12;
            if (o.hp <= 0) killEnemy(state, run, o);
          });
          pushEffect(run, 'ring', e.x, e.z, shock.radius, 0.28, 0xffe066);
        }

        // 暴风指环：命中时按概率引连锁闪电劈向最近的另一个敌人。
        // 概率走 state 的确定性随机源，不能用 Math.random ——
        // 用了的话同一存档种子重放会得到不同结果，平衡报告就不可复现了。
        const chain = hasFx(state, 'chainLightning');
        if (chain && nextRandom(state) < chain.chance) {
          let best = null, bestD = Infinity;
          run.enemies.forEach(function (o) {
            if (o.state === 'dead' || o === e) return;
            const d = Math.hypot(o.x - e.x, o.z - e.z);
            if (d < bestD && d <= chain.radius) { bestD = d; best = o; }
          });
          if (best) {
            best.hp -= Math.max(1, Math.round(dealt * chain.damageMul));
            best.hitFlash = 0.12;
            pushEffect(run, 'ring', best.x, best.z, 60, 0.25, 0x9ad7ff);
            if (best.hp <= 0) killEnemy(state, run, best);
          }
        }

        if (e.hp <= 0) killEnemy(state, run, e);
      }
    }
  }

  // ================================================================ Boss
  /**
   * 生成藤蔓 Boss。三档难度只改数值，不改机制 —— 机制一致才能让
   * "背下技能前摇"成为玩家可积累的技能。
   */
  function spawnBoss(state, run, tierId) {
    const tier = C.BOSS.tiers[tierId] || C.BOSS.tiers.normal;
    const hp = tier.hp;
    const boss = {
      id: ++state._eid || (state._eid = 1),
      kind: 'vineTitan',
      isBoss: true,
      bossTier: tierId,
      x: C.FIELD_W * 0.72,
      z: C.FIELD_D / 2,
      h: 0,
      hp: hp, maxHp: hp,
      damage: tier.damage,
      speed: C.BOSS.speed * tier.speedMul,
      radius: C.BOSS.radius,
      state: 'chase',
      timer: 0,
      attackCd: C.BOSS.attackCooldown,
      fireCd: 0,
      facing: -1,
      hitFlash: 0,
      stun: 0,
      vx: 0, vz: 0,
      // 技能状态
      casting: null,          // { id, timer, windup, done }
      skillCds: {},
      // 供测试与渲染读取
      bossSkills: C.BOSS.skills.map(function (k) { return { id: k.id, name: k.name,
        range: k.range, radius: k.radius, windup: k.windup }; }),
    };
    C.BOSS.skills.forEach(function (k) { boss.skillCds[k.id] = k.cd * 0.4; });
    run.enemies.push(boss);
    return boss;
  }

  /** 释放 Boss 技能。前摇期间不结算伤害，结束后才结算。 */
  function bossCast(state, run, boss, skillId) {
    const def = C.BOSS.skills.find(function (k) { return k.id === skillId; });
    if (!def) return false;
    // 全屏技能：在前摇**开始时**固定爆发中心。
    // 玩家看到前摇就有 1.4 秒时间用闪现拉开距离。
    boss.castOriginX = boss.x;
    boss.castOriginZ = boss.z;
    boss.casting = { id: skillId, timer: def.windup, windup: def.windup, done: false };
    boss.skillCds[skillId] = def.cd * (C.BOSS.tiers[boss.bossTier] || {}).cdMul || def.cd;
    return true;
  }

  /** 前摇结束，结算技能效果。 */
  function bossResolve(state, run, boss, def) {
    const p = run.player;
    const dist = Math.hypot(p.x - boss.x, p.z - boss.z);

    if (def.range === 'full') {
      // 全屏技能的躲避机制：**靠闪现的无敌帧卡时机**（PM 指定）。
      //
      // 设计约束：前摇 1.4 秒，闪现无敌 0.4 秒。
      // 所以玩家必须在**前摇结束前 0.4 秒内**按下闪现，无敌帧才能覆盖爆发时刻。
      // 按早了无敌就过期 —— 这正是"卡时机"的紧张感来源。
      //
      // 实现上只需要检查爆发瞬间玩家是否处于无敌帧。
      // 但有一条边界必须处理：玩家可能"正好在爆发前一帧"按下闪现，
      // 此时 p.invuln 已经 > 0，判定通过 —— 这是正确的。
      const base = Math.round(def.damage *
        (C.BOSS.tiers[boss.bossTier].damage / C.BOSS.tiers.normal.damage));
      if (p.invuln > 0) {
        // 无敌帧覆盖了爆发时刻 —— 成功躲开
        pushEffect(run, 'ring', p.x, p.z, 90, 0.4, 0xc9a6ff);
        return;
      }
      hurtPlayer(state, run, p, base);
      pushEffect(run, 'nova', boss.x, boss.z, C.FIELD_W, 0.6, 0xff7a3c);
      return;
    }

    if (dist > def.radius) return;                  // 不在范围内
    if (p.invuln > 0) return;
    hurtPlayer(state, run, p, def.damage);
    if (def.knockback) {
      const dx = p.x - boss.x, dz = p.z - boss.z;
      const d = Math.hypot(dx, dz) || 1;
      p.x = clamp(p.x + (dx / d) * def.knockback * 0.06, C.PLAYER_W / 2, C.FIELD_W - C.PLAYER_W / 2);
    }
    if (def.pull) {
      // 缠绕：把玩家拉向 Boss
      const dx = boss.x - p.x;
      p.x = clamp(p.x + Math.sign(dx) * def.pull, C.PLAYER_W / 2, C.FIELD_W - C.PLAYER_W / 2);
    }
    if (def.stunTime) p.stunTimer = Math.max(p.stunTimer || 0, def.stunTime);
    pushEffect(run, 'ring', boss.x, boss.z, def.radius, 0.45, 0xff7a3c);
  }

  /** Boss 每帧：慢速逼近、贴身普攻、按冷却放技能。 */
  function stepBoss(state, run, boss, dt) {
    const p = run.player;
    const tier = C.BOSS.tiers[boss.bossTier] || C.BOSS.tiers.normal;

    // 正在施法：只走前摇计时
    if (boss.casting) {
      boss.casting.timer -= dt;
      if (boss.casting.timer <= 0 && !boss.casting.done) {
        const def = C.BOSS.skills.find(function (k) { return k.id === boss.casting.id; });
        if (def) bossResolve(state, run, boss, def);
        boss.casting.done = true;
        boss.casting = null;
      }
      return;
    }

    // 技能冷却
    C.BOSS.skills.forEach(function (k) {
      if (boss.skillCds[k.id] > 0) boss.skillCds[k.id] = Math.max(0, boss.skillCds[k.id] - dt);
    });

    const dist = Math.hypot(p.x - boss.x, p.z - boss.z);
    boss.facing = p.x >= boss.x ? 1 : -1;

    // 优先放技能：远的用范围/全屏，近的用近身
    for (let i = 0; i < C.BOSS.skills.length; i++) {
      const k = C.BOSS.skills[i];
      if (boss.skillCds[k.id] > 0) continue;
      const inMelee = dist <= C.BOSS.meleeRange + 40;
      if (k.range === 'melee' && inMelee) { bossCast(state, run, boss, k.id); return; }
      if (k.range === 'area' && dist <= k.radius * 0.9) { bossCast(state, run, boss, k.id); return; }
      if (k.range === 'full' && dist < 700) { bossCast(state, run, boss, k.id); return; }
    }

    // 贴身普攻
    boss.attackCd -= dt;
    if (dist <= C.BOSS.meleeRange && boss.attackCd <= 0) {
      boss.attackCd = C.BOSS.attackCooldown / tier.speedMul;
      if (p.invuln === 0) {
        hurtPlayer(state, run, p, boss.damage);
        const dx = p.x - boss.x, dz = p.z - boss.z;
        const d = Math.hypot(dx, dz) || 1;
        p.x = clamp(p.x + (dx / d) * 30, C.PLAYER_W / 2, C.FIELD_W - C.PLAYER_W / 2);
      }
      return;
    }

    // 推开重叠：玩家不能走进 Boss 身体，否则视觉上像穿模。
    // 判定半径 46 是"能被打到"的范围，但身体视觉宽约 88，
    // 所以需要额外把玩家推到 88 之外。
    const minGap = C.BOSS.radius + C.PLAYER_W / 2 + 6;
    if (dist < minGap && dist > 0.001) {
      const ddx = p.x - boss.x, ddz = p.z - boss.z;
      const dd = Math.hypot(ddx, ddz) || 1;
      const push = (minGap - dist);
      p.x = clamp(p.x + (ddx / dd) * push, C.PLAYER_W / 2, C.FIELD_W - C.PLAYER_W / 2);
      p.z = clamp(p.z + (ddz / dd) * push * 0.5, 0, C.FIELD_D);
    }

    // 缓慢逼近（两个轴都跟，但很慢）
    if (dist > C.BOSS.meleeRange * 0.7) {
      const dx = p.x - boss.x, dz = p.z - boss.z;
      const d = Math.hypot(dx, dz) || 1;
      const bsp = boss.speed * (boss.slowMul || 1);
      boss.x += (dx / d) * bsp * dt;
      boss.z += (dz / d) * bsp * 0.7 * dt;
      boss.x = clamp(boss.x, 60, C.FIELD_W - 60);
      boss.z = clamp(boss.z, 20, C.FIELD_D - 20);
    }
  }

  function killEnemy(state, run, e) {
    e.state = 'dead';
    // 改成掉在地上等玩家去捡（见 LOOT 注释：这是战斗节奏的一部分）
    // 掉落物是**实体**：从死亡点弹起、抛向一侧，落地后停住。
    // 旧版本只是贴在原地不动的标记，视觉上没有"东西掉出来"的感觉。
    const spawn = function (kind, value, spreadX, spreadZ) {
      run.pickups.push({
        x: e.x, z: e.z, kind: kind, value: value,
        life: C.LOOT.pickupLife, bob: nextRandom(state) * 6.28,
        h: 30,                                    // 起始离地高度
        vh: randRange(state, 90, 150),            // 上抛速度
        vx: randRange(state, -spreadX, spreadX),  // 横向散开
        vz: randRange(state, -spreadZ, spreadZ),
        grounded: false,
      });
    };
    spawn('coin', Math.round(C.LOOT.coinsPerKill * run.diff.lootMul), 90, 55);
    if (nextRandom(state) < C.LOOT.seedChance) spawn('seed', 1, 110, 70);

    // 血滴护符：击杀回血
    const kh = hasFx(state, 'killHeal');
    if (kh) {
      const p = run.player;
      p.hp = Math.min(p.maxHp, p.hp + Math.max(1, Math.round(kh.heal * kh.mul)));
    }

    // 装备掉落（5%，只掉基础装备）。
    // Boss 不参与：Boss 的价值在通关本身，掉装备会让"重复刷 Boss"变成最优解。
    if (!e.isBoss) {
      const drop = tryEquipDrop(state);
      if (drop) {
        run.equipDrops = run.equipDrops || [];
        run.equipDrops.push({ id: drop.id, duplicate: drop.duplicate });
      }
    }
  }

  /** 拾取物：玩家靠近即收，超时消失。 */
  function stepPickups(state, run, dt) {
    const p = run.player;
    for (let i = run.pickups.length - 1; i >= 0; i--) {
      const it = run.pickups[i];
      it.life -= dt;
      it.bob += dt * 3.2;

      // 抛物线：未落地时受重力，落地即停（不做弹跳，避免散落物到处滚）
      if (!it.grounded) {
        it.vh -= C.LOOT.pickupGravity * dt;
        it.h += it.vh * dt;
        it.x += it.vx * dt;
        it.z += it.vz * dt;
        it.vx *= Math.exp(-2.2 * dt);
        it.vz *= Math.exp(-2.2 * dt);
        if (it.h <= 0) {
          it.h = 0;
          it.vh = 0;
          it.vx = 0;
          it.vz = 0;
          it.grounded = true;
        }
        it.x = clamp(it.x, 20, C.FIELD_W - 20);
        it.z = clamp(it.z, 0, C.FIELD_D);
      }
      // 只有**落地后**才能被捡起。否则弹在空中的掉落物会立刻被吸走，
      // 玩家看不到"东西掉出来"的过程 —— 那正是实体感想表达的东西。
      const near = it.grounded
                && Math.abs(it.x - p.x) < C.LOOT.pickupRadiusX
                && Math.abs(it.z - p.z) < C.LOOT.pickupRadiusZ;
      if (near) {
        if (it.kind === 'coin') run.loot.coins += it.value;
        else run.loot.seeds += it.value;
        run.pickups.splice(i, 1);
      } else if (it.life <= 0) {
        run.pickups.splice(i, 1);
      }
    }
  }

  /** 把场上所有掉落物一次收走（清波时用，避免"清完场却丢了战利品"）。 */
  function collectAll(state, run) {
    run.pickups.forEach(function (it) {
      if (it.kind === 'coin') run.loot.coins += it.value;
      else run.loot.seeds += it.value;
    });
    run.pickups.length = 0;
  }

  function stepSpawning(state, run, dt) {
    if (run.waveState !== 'spawning') return;
    if (!run.spawnQueue.length) return;
    run.spawnTimer -= dt;
    if (run.spawnTimer > 0) return;

    // 一批 3 只同时出来，批与批之间停顿 —— 比连续滴漏更有推进感
    const burst = Math.min(C.SPAWN.burstSize, run.spawnQueue.length);
    for (let i = 0; i < burst; i++) {
      const kind = run.spawnQueue.shift();
      run.enemies.push(makeEnemy(state, kind, run.diff));
    }
    run.spawnTimer = run.spawnQueue.length
      ? C.SPAWN.burstGap * (run.diff.spawnGap / 1.1)
      : 0;
  }

  function stepEnemies(state, run, dt) {
    const p = run.player;
    for (let i = run.enemies.length - 1; i >= 0; i--) {
      const e = run.enemies[i];
      if (e.state === 'dead') {
        e.hitFlash = Math.max(0, e.hitFlash - dt);
        if (e.hitFlash === 0) run.enemies.splice(i, 1);   // 死后短暂保留以便渲染火花
        continue;
      }
      e.hitFlash = Math.max(0, e.hitFlash - dt);
      e.attackCd = Math.max(0, e.attackCd - dt);
      // 冰霜减速计时。放在 def 之前，且对 boss 同样生效 ——
      // 霜缚护甲的定位就是"给 boss 争取输出窗口"，对 boss 无效等于废掉。
      if (e.slowTimer > 0) {
        e.slowTimer = Math.max(0, e.slowTimer - dt);
        if (e.slowTimer === 0) e.slowMul = 1;
      }

      const def = C.ENEMIES[e.kind];
      // 僵直：被击退期间不走位。
      // 没有这个，即使冲量很大，小怪每帧朝玩家移动也会把位移吃掉
      // —— 实测击退 1050 的震地只把怪推开 19px，手感完全不"掀飞"。
      if (e.isBoss) {
        if (e.stun > 0) e.stun = Math.max(0, e.stun - dt);
        else stepBoss(state, run, e, dt);
        e.hitFlash = Math.max(0, e.hitFlash - dt);
        continue;
      }
      if (e.stun > 0) {
        e.stun = Math.max(0, e.stun - dt);
      } else if (def.behavior === 'lunge') {
        stepLunge(state, run, e, def, dt);
      } else if (def.behavior === 'ranged') {
        stepRanged(state, run, e, def, dt);
      } else {
        stepChase(state, run, e, dt);
      }

      // 击退衰减：必须按时间指数衰减。
      // 之前的 `e.vx *= 0.86` 是每帧衰减，配 dt 使用时 60fps 下不到 5 帧就归零，
      // 实际位移只有几像素 —— 击退等于没做，玩家无法拉开距离，只能被贴身磨死。
      e.x += e.vx * dt; e.vx *= Math.exp(-10 * dt);
      e.z += e.vz * dt; e.vz *= Math.exp(-10 * dt);
      e.x = clamp(e.x, 20, C.FIELD_W - 20);
      e.z = clamp(e.z, 0, C.FIELD_D);

      // 接触伤害：必须两个轴都贴近
      const dx = Math.abs(e.x - p.x);
      const dz = Math.abs(e.z - p.z);
      if (dx < (e.radius + C.PLAYER_W / 2) && dz < C.ATTACK_DEPTH) {
        if (e.attackCd === 0 && p.invuln === 0) {
          hurtPlayer(state, run, p, e.damage);
          e.attackCd = 0.9;
          // 把玩家往反方向推开一点，避免黏住
          const dir = p.x >= e.x ? 1 : -1;
          p.x = clamp(p.x + dir * 26, C.PLAYER_W / 2, C.FIELD_W - C.PLAYER_W / 2);
        }
      }
    }
  }

  function stepChase(state, run, e, dt) {
    const p = run.player;
    const dx = p.x - e.x;
    const dz = p.z - e.z;
    const dist = Math.hypot(dx, dz) || 1;
    e.facing = dx >= 0 ? 1 : -1;
    const sp = e.speed * (e.slowMul || 1);
    if (dist > 18) {
      e.x += (dx / dist) * sp * dt;
      e.z += (dz / dist) * sp * dt;
    }
  }

  /** 冲刺虫：蓄力 → 直线突进 → 冷却。行为与爬虫明显不同，但共享同一套数值口径。 */
  function stepLunge(state, run, e, def, dt) {
    const p = run.player;
    e.timer -= dt;
    if (e.state === 'chase') {
      // 缓慢逼近，进入距离后蓄力
      const dx = p.x - e.x, dz = p.z - e.z;
      const dist = Math.hypot(dx, dz) || 1;
      e.facing = dx >= 0 ? 1 : -1;
      if (dist > 140) {
        const sp = e.speed * (e.slowMul || 1);
        e.x += (dx / dist) * sp * 0.6 * dt;
        e.z += (dz / dist) * sp * 0.6 * dt;
      } else {
        e.state = 'windup';
        e.timer = def.lungeWindup;
        e.vz = (dz / dist) * def.lungeSpeed * 0.5;
        e.vx = (dx / dist) * def.lungeSpeed;
      }
    } else if (e.state === 'windup') {
      e.vx *= 0.9; e.vz *= 0.9;
      if (e.timer <= 0) { e.state = 'lunge'; e.timer = def.lungeTime; }
    } else if (e.state === 'lunge') {
      if (e.timer <= 0) { e.state = 'chase'; e.timer = 0; }
    }
  }

  /**
   * 吐酸虫：维持距离 → 抬手 → 吐弹。
   * 弹道沿 (x, z) 直线飞行，只覆盖一条深度线，所以玩家换深度就能躲开。
   */
  function stepRanged(state, run, e, def, dt) {
    const p = run.player;
    const dx = p.x - e.x, dz = p.z - e.z;
    const dist = Math.hypot(dx, dz) || 1;
    e.facing = dx >= 0 ? 1 : -1;

    if (e.state === 'windup') {
      e.timer -= dt;
      if (e.timer <= 0) {
        spawnProjectile(state, run, e, def);
        e.state = 'chase';
        e.fireCd = def.fireCd;
      }
      return;
    }

    // 太近后退、太远靠近，尽量停在 keepDistance 附近
    const sp = e.speed * (e.slowMul || 1);
    if (dist < def.keepDistance * 0.72) {
      e.x -= (dx / dist) * sp * dt;
      e.z -= (dz / dist) * sp * 0.75 * dt;
    } else if (dist > def.keepDistance * 1.2) {
      e.x += (dx / dist) * sp * dt;
      e.z += (dz / dist) * sp * 0.75 * dt;
    }

    e.fireCd -= dt;
    if (e.fireCd <= 0) {
      e.state = 'windup';
      e.timer = def.windup;
    }
  }

  function spawnProjectile(state, run, e, def) {
    const p = run.player;
    const dx = p.x - e.x, dz = p.z - e.z;
    const d = Math.hypot(dx, dz) || 1;
    run.projectiles.push({
      x: e.x, z: e.z, h: 20,
      vx: (dx / d) * def.projSpeed,
      vz: (dz / d) * def.projSpeed,
      damage: Math.round(def.projDamage * run.diff.dmgMul),
      radius: def.projRadius,
      depth: def.projDepth,
      life: def.projLife,
      spin: 0,
    });
  }

  function stepProjectiles(state, run, dt) {
    const p = run.player;
    for (let i = run.projectiles.length - 1; i >= 0; i--) {
      const pr = run.projectiles[i];
      pr.x += pr.vx * dt;
      pr.z += pr.vz * dt;
      pr.life -= dt;
      pr.spin += dt * 12;

      let gone = pr.life <= 0 || pr.x < -40 || pr.x > C.FIELD_W + 40
                 || pr.z < -30 || pr.z > C.FIELD_D + 30;

      // 命中判定同样要求两个轴都贴近 —— 深度差够大就能擦身而过
      if (!gone && p.invuln === 0
          && Math.abs(pr.x - p.x) < pr.radius
          && Math.abs(pr.z - p.z) < pr.depth) {
        hurtPlayer(state, run, p, pr.damage);
        gone = true;
      }
      if (gone) run.projectiles.splice(i, 1);
    }
  }

  function stepWave(state, run, dt) {
    const alive = run.enemies.filter(function (e) { return e.state !== 'dead'; }).length;
    if (run.waveState === 'spawning' && run.spawnQueue.length === 0 && alive === 0) {
      run.waveState = 'break';
      run.breakTimer = C.WAVE_BREAK;
      collectAll(state, run);
      run.loot.coins += Math.round(C.LOOT.clearBonusCoins * run.diff.lootMul);
      // 清波回血：没有它，难度越高越变成"数学上不可能"而不是"更难"
      run.player.hp = Math.min(run.player.maxHp, run.player.hp + C.WAVE_HEAL);
      if (run.waveIndex + 1 > state.meta.bestWave) state.meta.bestWave = run.waveIndex + 1;
    } else if (run.waveState === 'break') {
      run.breakTimer -= dt;
      if (run.breakTimer <= 0) {
        run.waveIndex += 1;
        if (run.waveIndex >= run.diff.waves) {
          endRun(state, true);
        } else {
          buildWave(state);
        }
      }
    }
  }

  // ---------------------------------------------------------------- 结算
  function endRun(state, won) {
    const run = state.run;
    run.status = won ? 'won' : 'lost';
    const keep = won ? 1 : C.LOOT.lossKeep;
    const coins = Math.floor(run.loot.coins * keep);
    const seeds = Math.floor(run.loot.seeds * keep);

    state.meta.coins += coins;
    state.meta.seeds += seeds;
    state.meta.runsCompleted += 1;
    if (won) state.meta.runsWon += 1;

    // 药水同步：本局喝掉多少，meta 就扣掉多少。
    // 用"剩余量回写"而不是"扣减量"，中途重开也不会重复扣。
    if (run.potions && state.meta.potions) {
      state.meta.potions.heal = run.potions.heal || 0;
      state.meta.potions.strength = run.potions.strength || 0;
      state.meta.potions.wall = run.potions.wall || 0;
    }

    // 农庄推进：**每一局**（无论胜负）都算一次生长，成熟后开始被动产出。
    // 这是强度 A 的关键：作物按"局"计龄，所以失败也有进展，玩家不会卡死。
    let matured = 0;
    state.farm.plots.forEach(function (plot) {
      if (plot.state === 'growing') {
        plot.growth += 1;
        if (plot.growth >= C.FARM.runsToMature) { plot.state = 'mature'; matured += 1; }
      }
    });
    const passive = passiveIncome(state);
    state.meta.coins += passive;

    state.lastResult = {
      won: won,
      difficultyId: run.difficultyId,
      wavesCleared: won ? run.diff.waves : run.waveIndex,
      coins: coins, seeds: seeds,
      passive: passive, matured: matured,
      elapsed: Math.round(run.elapsed),
    };
    state.phase = 'result';
    state.run = null;
  }

  function returnToFarm(state) {
    if (state.phase === 'result') state.phase = 'farm';
    return state;
  }

  // ---------------------------------------------------------------- 存档
  function serialize(state) {
    return JSON.stringify(state);
  }

  /**
   * 旧存档迁移。
   *
   * 早期版本直接 throw，页面那边 catch 之后用新档顶替 ——
   * 玩家更新一次就丢掉整个农场和强化，而且屏幕上没有任何提示。
   * v2 → v3 只是新增了 meta.skills，属于可以无损补齐的改动，没必要销毁。
   */
  function migrate(s) {
    if (s.version === 2) {
      if (!s.meta) s.meta = {};
      if (!s.meta.skills) s.meta.skills = { whirl: 1, blink: 1, slam: 1, cry: 1, nova: 1 };
      if (s.hub === undefined) s.hub = null;      // ensureHub 会补
      s.version = 3;
    }
    // v3 → v4：新增 meta.potions（药水携带量）。空药水是安全的默认值，
    // 老玩家不会因此白得药水，也不会丢档。
    if (s.version === 3) {
      if (!s.meta) s.meta = {};
      if (!s.meta.potions) s.meta.potions = { heal: 0, strength: 0, wall: 0 };
      s.version = 4;
    }
    // v4 → v5：新增装备（五个空位 + 空背包）。老档不白送装备 ——
    // 白送会凭空改变难度曲线，而老玩家的进度是按"没有装备"平衡出来的。
    if (s.version === 4) {
      if (!s.meta) s.meta = {};
      if (!s.meta.equipment) {
        s.meta.equipment = { head: null, torso: null, back: null, weapon: null, feet: null };
      }
      // v5 的库存字段（inventory / inventoryLevels）**故意不补** ——
      // 它们已经废掉了，补出来只会被下一步的 5→6 块当成真数据再搬一次。
      s.version = 5;
    }
    // v5 → v6：库存从「id 列表 + 按 id 的标量等级」改为「条目数组」。
    // 旧结构装不下重复件（同一 id 只能记一个等级），而本批要求重复件也进背包。
    // 迁移按 id 去重 —— 老档本来也只存得下一件，不凭空造件。
    if (s.version === 5) {
      if (!s.meta) s.meta = {};
      const oldIds = s.meta.inventory || [];
      const oldLv = s.meta.inventoryLevels || {};
      const seen = {};
      s.meta.bag = [];
      oldIds.forEach(function (id) {
        if (seen[id]) return;
        seen[id] = true;
        s.meta.bag.push(bagEntry(s, id, oldLv[id] || 1));
      });
      delete s.meta.inventory;
      delete s.meta.inventoryLevels;
      s.meta.bagPages = 1;
      // 音效设置也在这一版进来：老档没有，Task 12 一读就 TypeError。
      if (!s.meta.settings) s.meta.settings = { volume: 0.30, muted: false };
      s.version = 6;
    }
    return s;
  }

  function deserialize(json) {
    const s = migrate(JSON.parse(json));
    if (s.version !== STATE_VERSION) {
      throw new Error('存档版本不匹配: ' + s.version + '（当前 ' + STATE_VERSION + '）');
    }
    // 兜底：补齐后来新增的字段，保证老档读出来也能直接玩
    if (!s.meta.skills) s.meta.skills = { whirl: 1, blink: 1, slam: 1, cry: 1, nova: 1 };
    if (!s.meta.upgrades) s.meta.upgrades = { damage: 0, maxHp: 0, speed: 0 };
    if (!s.meta.potions) s.meta.potions = { heal: 0, strength: 0, wall: 0 };
    if (!s.meta.equipment) {
      s.meta.equipment = { head: null, torso: null, back: null, weapon: null, feet: null };
    }
    // 注意：兜底块在版本校验**之后**，所以它救不了迁移没抬版本的老档 ——
    // 版本链必须自己走完，这里只是防止 v6 存档缺字段。
    if (!s.meta.bag) s.meta.bag = [];
    if (!s.meta.bagPages) s.meta.bagPages = 1;
    if (!s.meta.uidSeq) s.meta.uidSeq = 0;
    if (!s.meta.settings) s.meta.settings = { volume: 0.30, muted: false };
    if (!s.farm || !s.farm.plots) {
      s.farm = { plots: new Array(C.FARM.cols * C.FARM.rows).fill(null)
        .map(function () { return { state: 'empty', growth: 0 }; }) };
    }
    return s;
  }

  /** 点到线段的最短距离（闪现的沿途判定用）。 */
  function distToSegment(px, pz, ax, az, bx, bz) {
    const abx = bx - ax, abz = bz - az;
    const len2 = abx * abx + abz * abz;
    if (len2 === 0) return Math.hypot(px - ax, pz - az);
    let t = ((px - ax) * abx + (pz - az) * abz) / len2;
    t = clamp(t, 0, 1);
    return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  const API = {
    STATE_VERSION,
    createState, startRun, step, endRun, returnToFarm,
    plant, buyUpgrade, upgradeCost,
    buySkill, skillCost, skillStats, tryCastSkill, currentDamage,
    stepProjectiles, stepRanged, spawnProjectile, stepPickups, collectAll, killEnemy,
    specialSkillOf, castSpecial, stepZones,
    spawnBoss, bossCast, stepBoss, bossResolve,
    buyPotion, usePotion, hurtPlayer, potionDamageMul,
    equipBonus, hasFx, equipOwned, buyEquipment, equipItem, unequipSlot,
    equipUpgradeCost, upgradeEquipment, rollEquipDrop, tryEquipDrop,
    // bagIndexOfId 一直在本文件里（equipOwned 等都要用它），
    // 但此前没进 API —— hub.js 想按 id 找背包条目读等级时拿不到它。
    // 函数"存在却不可达"和不存在一样会让调用方写出错的行为。
    bagAdd, bagRemove, bagAt, bagCount, bagCapacity,
    bagIndexOfId, bagIndexOfUid, bagEntry, nextUid,
    buyBagPage, pageOf, pageSlice,
    playerStats, maturePlots, passiveIncome,
    serialize, deserialize,
    nextRandom, buildWave, makeEnemy,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.GameLogic = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
