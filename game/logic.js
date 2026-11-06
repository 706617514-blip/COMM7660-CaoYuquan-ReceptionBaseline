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

  const STATE_VERSION = 3;

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

  function playerStats(state) {
    const up = state.meta.upgrades;
    return {
      maxHp: C.BASE_HP + up.maxHp * C.UPGRADES.maxHp.perLevel,
      damage: C.BASE_DAMAGE + up.damage * C.UPGRADES.damage.perLevel,
      speed: C.PLAYER_SPEED * (1 + up.speed * C.UPGRADES.speed.perLevel),
    };
  }

  function maturePlots(state) {
    return state.farm.plots.filter(function (p) { return p.state === 'mature'; }).length;
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

  function skillStats(skillKey, level) {
    const def = C.SKILLS[skillKey];
    const lv = Math.max(1, level || 1) - 1;
    return {
      // 战吼没有伤害字段，用 0 兜底，否则会算出 NaN 并污染下游计算
      damage: (def.damage || 0) + (def.damagePerLevel || 0) * lv,
      cooldown: Math.max(1.2, def.cooldown - (def.cdPerLevel || 0) * lv),
      radius: def.radius + (def.radiusPerLevel || 0) * lv,
      heal: (def.heal || 0) + (def.healPerLevel || 0) * lv,
    };
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
        cooldowns: { whirl: 0, blink: 0, slam: 0, cry: 0, nova: 0 },
        buffTimer: 0,
        casting: null,
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
    stepSpawning(state, run, dt);
    stepEnemies(state, run, dt);
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

    // 水平
    let mx = 0;
    if (input.left) mx -= 1;
    if (input.right) mx += 1;
    if (mx !== 0) {
      p.facing = mx;
      p.x += mx * st.speed * dt;
    }
    // 景深：W/S 在 z 轴走动（这是与纯横版的关键区别）
    // 方向约定：z 越大 = 离镜头越远 = 屏幕上越靠上（render 里 sy = GROUND_Y - z*Z_TO_Y）。
    // 所以 W（屏幕向上）必须让 z **增大**。第一版写反了，按 W 会往下走。
    let mz = 0;
    if (input.up) mz += 1;
    if (input.down) mz -= 1;
    if (mz !== 0) p.z += mz * C.PLAYER_DEPTH_SPEED * dt;

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

    // 技能（U/I/O/K/L）：冷却好了就释放
    C.SKILL_ORDER.forEach(function (k) {
      if (input[k]) tryCastSkill(state, run, p, k);
    });

    // 攻击
    if (input.attack && p.attackCd === 0) {
      p.attackTimer = C.ATTACK_DURATION;
      p.attackCd = C.ATTACK_COOLDOWN;
      p.swingId += 1;
      p.hitIds = [];
    }
    if (p.attackTimer > 0) resolveAttack(state, run, p, st);
  }

  /** 当前实际伤害：战吼生效期间按倍率提升。技能伤害也吃这个倍率。 */
  function currentDamage(state, p) {
    let d = playerStats(state).damage;
    if (p.buffTimer > 0) d *= C.SKILLS.cry.buffMult;
    return d;
  }

  function pushEffect(run, kind, x, z, radius, time, color) {
    run.effects.push({ kind: kind, x: x, z: z, radius: radius,
                       timer: time, maxTimer: time, color: color });
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
    const st = skillStats(key, level);
    const dmg = st.damage * (1 + (currentDamage(state, p) / playerStats(state).damage - 1));
    p.cooldowns[key] = st.cooldown;
    p.casting = { key: key, timer: def.fxTime };

    const hitRadius = function (rad, applyDamage, knockback) {
      run.enemies.forEach(function (e) {
        if (e.state === 'dead') return;
        const dist = Math.hypot(e.x - p.x, e.z - p.z);
        if (dist > rad) return;
        if (applyDamage) {
          e.hp -= dmg;
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
      hitRadius(st.radius, true, 200);
      pushEffect(run, 'ring', p.x, p.z, st.radius, def.fxTime, def.fxColor);
    } else if (key === 'blink') {
      const fromX = p.x;
      p.x = clamp(p.x + p.facing * def.distance, C.PLAYER_W / 2, C.FIELD_W - C.PLAYER_W / 2);
      p.invuln = Math.max(p.invuln, def.iframes);
      hitRadius(def.radius, true, 0);
      pushEffect(run, 'trail', fromX, p.z, def.radius, def.fxTime, def.fxColor);
      pushEffect(run, 'ring', p.x, p.z, def.radius, def.fxTime, def.fxColor);
    } else if (key === 'slam') {
      hitRadius(st.radius, true, def.knockback);
      pushEffect(run, 'burst', p.x, p.z, st.radius, def.fxTime, def.fxColor);
    } else if (key === 'cry') {
      p.hp = Math.min(p.maxHp, p.hp + st.heal);
      p.buffTimer = def.buffTime;
      pushEffect(run, 'aura', p.x, p.z, 90, def.fxTime, def.fxColor);
    } else if (key === 'nova') {
      hitRadius(def.radius, true, 260);
      pushEffect(run, 'nova', C.FIELD_W / 2, C.FIELD_D / 2, C.FIELD_W, def.fxTime, def.fxColor);
    }
    return true;
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
      const inFront = dx > -C.ATTACK_BACK && dx < C.ATTACK_RANGE;
      const sameDepth = dz <= C.ATTACK_DEPTH;
      // 跳起来时打不到贴地的目标，落地才有效（简单的高度门限）
      const reachable = Math.abs(p.h - e.h) < 70;
      if (inFront && sameDepth && reachable) {
        e.hp -= currentDamage(state, p);
        e.hitFlash = 0.12;
        p.hitIds.push(e.id);
        e.vx = p.facing * 420;               // 击退冲量（约 42px 位移）
        if (e.hp <= 0) killEnemy(state, run, e);
      }
    }
  }

  function killEnemy(state, run, e) {
    e.state = 'dead';
    const diff = run.diff;
    run.loot.coins += Math.round(C.LOOT.coinsPerKill * diff.lootMul);
    if (nextRandom(state) < C.LOOT.seedChance) run.loot.seeds += 1;
  }

  function stepSpawning(state, run, dt) {
    if (run.waveState !== 'spawning') return;
    if (!run.spawnQueue.length) return;
    run.spawnTimer -= dt;
    if (run.spawnTimer <= 0) {
      const kind = run.spawnQueue.shift();
      run.enemies.push(makeEnemy(state, kind, run.diff));
      run.spawnTimer = run.diff.spawnGap;
    }
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

      const def = C.ENEMIES[e.kind];
      // 僵直：被击退期间不走位。
      // 没有这个，即使冲量很大，小怪每帧朝玩家移动也会把位移吃掉
      // —— 实测击退 1050 的震地只把怪推开 19px，手感完全不"掀飞"。
      if (e.stun > 0) {
        e.stun = Math.max(0, e.stun - dt);
      } else if (def.behavior === 'lunge') {
        stepLunge(state, run, e, def, dt);
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
          p.hp -= e.damage;
          p.invuln = C.INVULN_AFTER_HIT;
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
    if (dist > 18) {
      e.x += (dx / dist) * e.speed * dt;
      e.z += (dz / dist) * e.speed * dt;
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
        e.x += (dx / dist) * e.speed * 0.6 * dt;
        e.z += (dz / dist) * e.speed * 0.6 * dt;
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

  function stepWave(state, run, dt) {
    const alive = run.enemies.filter(function (e) { return e.state !== 'dead'; }).length;
    if (run.waveState === 'spawning' && run.spawnQueue.length === 0 && alive === 0) {
      run.waveState = 'break';
      run.breakTimer = C.WAVE_BREAK;
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

  function deserialize(json) {
    const s = JSON.parse(json);
    if (s.version !== STATE_VERSION) throw new Error('存档版本不匹配: ' + s.version);
    return s;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  const API = {
    STATE_VERSION,
    createState, startRun, step, endRun, returnToFarm,
    plant, buyUpgrade, upgradeCost,
    buySkill, skillCost, skillStats, tryCastSkill, currentDamage,
    playerStats, maturePlots, passiveIncome,
    serialize, deserialize,
    nextRandom, buildWave, makeEnemy,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.GameLogic = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
