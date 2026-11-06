/**
 * config.js — 全部数值集中在这里，逻辑与渲染都不允许写死数字。
 *
 * 为什么单独一层
 * --------------
 * 难点设计是「用难度档代替关卡数」，所以难度必须是**数据**而不是代码分支。
 * 这样调平衡只改这张表，逻辑层完全不动，测试也能直接遍历所有难度跑一遍。
 *
 * 坐标约定（2.5D 横版，参照熔炉密林的景深带）
 * ------------------------------------------
 *   x   水平位置，0..FIELD_W
 *   z   景深（地面带内的前后位置），0..FIELD_D；渲染时表现为屏幕上的竖直偏移
 *   h   离地高度，跳跃用；0 表示站在地上
 *
 * 命中判定需要用 (x, z) 两个轴：只有 x 重叠而 z 差太多时不该命中，
 * 这是 beat-em-up 的惯例，也是 W/S 深度轴存在的意义。
 */
(function (global) {
  'use strict';

  const FIELD_W = 960;          // 场地宽度（像素）
  const FIELD_D = 210;          // 景深带厚度：可用 W/S 走动的范围
  const GROUND_Y = 430;         // z=0 时的地面基线（屏幕 y）
  const PLAYER_W = 34;
  const PLAYER_H = 54;          // 站立高度，用于跳跃与绘制
  const PLAYER_SPEED = 250;     // 水平速度 px/s
  const PLAYER_DEPTH_SPEED = 150;// 深度速度 px/s（比水平慢，符合视觉惯性）
  const JUMP_V = 430;           // 起跳初速度
  const GRAVITY = 1500;
  const ATTACK_DURATION = 0.16; // 挥击持续时间
  const ATTACK_COOLDOWN = 0.30;
  const ATTACK_RANGE = 62;      // 前方攻击距离
  const ATTACK_DEPTH = 52;      // 深度容差：|z 差| 超过它就打不中
  const ATTACK_BACK = 14;       // 身后也能蹭到一点
  const INVULN_AFTER_HIT = 0.8;
  const WAVE_BREAK = 1.4;       // 清波后的间歇
const WAVE_HEAL = 18;         // 清波回血：没有回血机制时长局在数学上不可通关

  // 玩家基础值（强化会在此之上叠加）
  const BASE_HP = 100;
  const BASE_DAMAGE = 12;
  const BASE_ATTACK_SPEED = 1.0;

  /**
   * 难度档 —— 替代「关卡数」的核心设计。
   *
   * lootMul 是最关键的一个字段：难度越高，战利品倍率越高。
   * 这让玩家必须决定「稳着种田」还是「冒险推进」，而这就是本作的经济张力。
   */
  const DIFFICULTIES = [
    { id: 'grass',  name: '草丛',  desc: '想先摸清操作的话从这里开始',
      hpMul: 0.85, dmgMul: 0.70, speedMul: 0.90, waves: 3, baseCount: 4,
      lootMul: 1.0,  spawnGap: 1.50 },
    { id: 'wood',   name: '林地',  desc: '标准强度，战利品与风险相称',
      hpMul: 1.20, dmgMul: 1.10, speedMul: 1.00, waves: 3, baseCount: 5,
      lootMul: 1.7,  spawnGap: 1.35 },
    { id: 'deep',   name: '密林',  desc: '多一波，小怪更硬更快',
      hpMul: 1.60, dmgMul: 1.40, speedMul: 1.12, waves: 4, baseCount: 6,
      lootMul: 2.5,  spawnGap: 1.20 },
    { id: 'forge',  name: '熔炉',  desc: '高风险高回报，倒下会损失一半战利品',
      hpMul: 2.10, dmgMul: 1.75, speedMul: 1.20, waves: 4, baseCount: 7,
      lootMul: 3.5,  spawnGap: 1.05 },
  ];

  /**
   * 小怪原型：只有两种，但行为不同，目的是用最少的内容撑起区分度。
   * 每个难度会把这些基础值乘上该档的倍率（见 makeEnemy）。
   */
  const ENEMIES = {
    crawler: {
      name: '爬虫', hp: 42, damage: 7, speed: 88, radius: 18,
      behavior: 'chase',            // 直线追玩家，两个轴都跟
      knockback: 1.0,
    },
    runner: {
      name: '冲刺虫', hp: 30, damage: 10, speed: 120, radius: 16,
      behavior: 'lunge',            // 先蓄力，再朝玩家方向直线冲
      lungeWindup: 0.55, lungeSpeed: 430, lungeTime: 0.32,
      knockback: 1.4,
    },
  };

  /**
   * 每波的小怪构成：随波次与难度变化。
   * 波次索引 0-based；越往后 runner 占比越高。
   */
  function waveComposition(waveIndex, diff) {
    const n = diff.baseCount + waveIndex;
    const runnerShare = Math.min(0.55, 0.15 + waveIndex * 0.12);
    const runners = Math.round(n * runnerShare);
    return { crawler: n - runners, runner: runners };
  }

  /**
   * 强化：三条独立线，成本递增。
   * 与「种田」并列，构成每局结束后的第二个花钱去处 —— 玩家的取舍就在这里。
   */
  // 强化幅度刻意压平：满级约等于基础值的 2 倍，不是 3 倍。
  // 早期版本 +3 伤害 / +25 血 / 8 级，全满时伤害与血量都是 3 倍，
  // 结果"中期强化"就让四档难度全部变成 100% 通关 —— 难度选择失去意义，
  // 经营层反而吃掉了整个游戏的核心张力。
  const UPGRADES = {
    damage: { name: '锋刃', desc: '每次攻击 +2 伤害',
      base: 25, growth: 1.42, maxLevel: 6, perLevel: 2 },
    maxHp: { name: '耐力', desc: '生命上限 +12',
      base: 30, growth: 1.40, maxLevel: 6, perLevel: 12 },
    speed: { name: '轻步', desc: '移动速度 +4.5%',
      base: 28, growth: 1.48, maxLevel: 4, perLevel: 0.045 },
  };

  /**
   * 农庄（强度 A）：种子种下后需要 RUNS_TO_MATURE 局才成熟，
   * 成熟后**每局**被动产出，永久生效 —— 这是复利，也是拖慢节奏的投资决策。
   */
  const FARM = {
    cols: 3, rows: 3,
    runsToMature: 2,
    yieldPerPlot: 9,        // 每块成熟田每局产出的铜币
    seedCost: 1,            // 每块田消耗 1 颗种子
    runDecayChance: 0,      // 预留：作物枯萎（当前关闭，避免惩罚过重）
  };

  // 战利品：每只小怪的基础掉落，再乘难度 lootMul
  const LOOT = {
    coinsPerKill: 4,
    seedChance: 0.38,       // 每只小怪掉种子的概率
    clearBonusCoins: 20,    // 清完一波的额外奖励
    lossKeep: 0.5,          // 倒下时保留的战利品比例
  };

  const API = {
    FIELD_W, FIELD_D, GROUND_Y,
    PLAYER_W, PLAYER_H, PLAYER_SPEED, PLAYER_DEPTH_SPEED,
    JUMP_V, GRAVITY,
    ATTACK_DURATION, ATTACK_COOLDOWN, ATTACK_RANGE, ATTACK_DEPTH, ATTACK_BACK,
    INVULN_AFTER_HIT, WAVE_BREAK, WAVE_HEAL,
    BASE_HP, BASE_DAMAGE, BASE_ATTACK_SPEED,
    DIFFICULTIES, ENEMIES, UPGRADES, FARM, LOOT,
    waveComposition,
    difficultyById: function (id) {
      return DIFFICULTIES.find(function (d) { return d.id === id; }) || DIFFICULTIES[1];
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.GameConfig = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
