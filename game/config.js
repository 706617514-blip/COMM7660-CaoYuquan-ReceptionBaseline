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
  const GROUND_Y = 515;         // z=0 时的地面基线（屏幕 y）
                              // 抬高是为了让景深带在 600 高的画布里占够比例，
                              // 否则整条可走区域挤在中间，下方留出大片空白
  const PLAYER_W = 34;
  const PLAYER_H = 54;          // 站立高度，用于跳跃与绘制
  const PLAYER_SPEED = 250;     // 水平速度 px/s
const SPRINT_MULT = 1.62;     // 按住 Shift 的冲刺倍率
const SPRINT_DEPTH_MULT = 1.35; // 深度轴上冲刺的倍率（比水平收敛，避免前后跳变）
  const PLAYER_DEPTH_SPEED = 150;// 深度速度 px/s（比水平慢，符合视觉惯性）
  const JUMP_V = 430;           // 起跳初速度
  const GRAVITY = 1500;
  const ATTACK_DURATION = 0.16; // 挥击持续时间
  const ATTACK_COOLDOWN = 0.30;

  /**
   * 三段式普攻。节奏是 快 → 快 → 慢：
   *   第 1、2 段出手极快，用来贴上去压血；
   *   第 3 段是收招，伤害与击退都明显更高，但硬直长，打空就会被惩罚。
   * 连击窗口内再次按下才接续；超时则回到第 1 段。
   */
  const COMBO = {
    steps: [
      { damageMul: 1.00, cooldown: 0.26, range: 58, knockback: 120, stun: 0.10 },
      { damageMul: 1.15, cooldown: 0.28, range: 62, knockback: 180, stun: 0.12 },
      { damageMul: 1.85, cooldown: 0.62, range: 74, knockback: 460, stun: 0.34 },
    ],
    window: 0.55,   // 两段之间允许的间隔
  };
  const ATTACK_RANGE = 62;      // 前方攻击距离
  const ATTACK_DEPTH = 52;      // 深度容差：|z 差| 超过它就打不中
  const ATTACK_BACK = 14;       // 身后也能蹭到一点
  const INVULN_AFTER_HIT = 0.8;
  const WAVE_BREAK = 1.4;       // 清波后的间歇
const WAVE_HEAL = 18;         // 清波回血：没有回血机制时长局在数学上不可通关

  // 玩家基础值（强化会在此之上叠加）
  const BASE_HP = 70;
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
      hpMul: 1.32, dmgMul: 1.26, speedMul: 1.02, waves: 3, baseCount: 5,
      lootMul: 1.7,  spawnGap: 1.35 },
    { id: 'deep',   name: '密林',  desc: '多一波，小怪明显更硬更快',
      // 密林原先的倍率让它在零强化下有 68% 胜率、半满即 100%，
      // 四档退化为"除了熔炉都不难"。上调到中间的真正难点。
      hpMul: 1.75, dmgMul: 1.45, speedMul: 1.14, waves: 4, baseCount: 6,
      // 上一轮加入三段式普攻与"掉落需落地才可拾取"后战斗变难，
      // 密林零强化胜率从 45% 掉到 23%，在 95% 与 0% 之间留了一个断档。
      // 回调到 1.75/1.45，实测约 38%，阶梯重新连贯。
      lootMul: 2.5,  spawnGap: 1.15 },
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
      name: '爬虫', hp: 42, damage: 10, speed: 92, radius: 18,
      behavior: 'chase',            // 直线追玩家，两个轴都跟
      knockback: 1.0,
    },
    runner: {
      name: '冲刺虫', hp: 30, damage: 14, speed: 126, radius: 16,
      behavior: 'lunge',            // 先蓄力，再朝玩家方向直线冲
      lungeWindup: 0.55, lungeSpeed: 430, lungeTime: 0.32,
      knockback: 1.4,
    },
    /**
     * 吐酸虫：保持距离、远程吐弹。
     *
     * 存在的意义不是多一种怪，而是打破"一直往后跑就安全"的解法：
     * 它本来就在远处，且弹道只覆盖一条深度线 —— 想躲必须用 W/S 换深度。
     * 这是深度轴从"能走动"变成"必须走位"的关键。
     */
    spitter: {
      name: '吐酸虫', hp: 24, damage: 8, speed: 78, radius: 17,
      behavior: 'ranged',
      keepDistance: 250,        // 想维持的距离
      fireCd: 2.3,              // 开火间隔
      windup: 0.65,             // 抬手预警
      projSpeed: 275,
      projDamage: 11,
      projRadius: 20,           // 命中宽度（x）
      projDepth: 26,            // 命中深度容差（z）
      projLife: 3.0,
    },
  };

  /**
   * 每波的小怪构成：随波次与难度变化。
   * 波次索引 0-based；越往后 runner 占比越高。
   */
  function waveComposition(waveIndex, diff) {
    const n = diff.baseCount + waveIndex;
    const runnerShare = Math.min(0.55, 0.15 + waveIndex * 0.12);
    // 吐酸虫从第 2 波（waveIndex >= 1）开始出现，比例随波次上升
    const spitterShare = waveIndex >= 1 ? Math.min(0.34, 0.14 + (waveIndex - 1) * 0.10) : 0;
    const runners = Math.round(n * runnerShare);
    const spitters = Math.round(n * spitterShare);
    return { crawler: Math.max(0, n - runners - spitters), runner: runners, spitter: spitters };
  }

  /**
   * 技能：U / I / O / K 是基础技能，L 是大招。
   *
   * 设计意图：玩家反馈"整体没有难度"，而单纯加血加伤只会变成互相磨。
   * 技能给的是**应对手段**——闪现用来脱身、旋风斩用来解围、战吼用来续命、
   * 大招用来收尾。难度因此来自"要不要用、什么时候用"，而不是数值对撞。
   *
   * 全部技能冷却完毕才可释放；冷却与伤害都随等级提升（冷却缩短、伤害增加）。
   */
  const SKILLS = {
    /**
     * 裂风斩（原名"旋风斩"）：朝**前方**挥出一道长风。
     *
     * 改成朝前之后，三个技能的形状彻底分开了：
     *   普攻 = 近距离矩形 · 裂风斩 = 前方长条 · 震地 = 环形掀飞
     * 环绕型的"旋风斩"与普通攻击在体感上太接近（都是"打周围"），
     * 而朝前释放强迫玩家先面向目标，是更明确的操作。
     */
    whirl: {
      key: 'U', name: '裂风斩', short: '裂风',
      desc: '朝面朝方向挥出一道长风，贯穿前方一整排',
      cooldown: 5.6, maxLevel: 5, baseCost: 40, costGrowth: 1.5,
      forwardRange: 190,     // 前方长度
      forwardDepth: 74,      // 深度容差
      damage: 26, damagePerLevel: 9,
      knockback: 360, stunTime: 0.22,
      cdPerLevel: 0.22, fxTime: 0.40, fxColor: 0x9ad7ff,
    },
    blink: {
      key: 'I', name: '闪现', short: '闪现',
      desc: '朝面朝方向瞬移，短暂无敌并沿途造成伤害',
      cooldown: 4.0, maxLevel: 5, baseCost: 35, costGrowth: 1.45,
      distance: 200, radius: 88, damage: 10, damagePerLevel: 4,
      iframes: 0.40, cdPerLevel: 0.18, fxTime: 0.28, fxColor: 0xc9a6ff,
    },
    slam: {
      key: 'O', name: '震地', short: '震地',
      desc: '砸向地面，把周围小怪强力掀飞（伤害较低，靠位移解围）',
      cooldown: 8.0, maxLevel: 5, baseCost: 48, costGrowth: 1.5,
      radius: 132,
      // 按需求调整：伤害下调，击退显著加强 —— 定位从"输出技能"变成"解围技能"
      damage: 16, damagePerLevel: 6,
      knockback: 1050, stunTime: 0.60,
      cdPerLevel: 0.30, fxTime: 0.40, fxColor: 0xffb066,
    },
    cry: {
      key: 'K', name: '战吼', short: '战吼',
      desc: '立刻回血，并在数秒内提升攻击力',
      cooldown: 13.0, maxLevel: 5, baseCost: 44, costGrowth: 1.45,
      heal: 22, healPerLevel: 10, buffMult: 1.35, buffTime: 6.0,
      cdPerLevel: 0.45, fxTime: 0.5, fxColor: 0x7fe08a,
    },
    nova: {
      key: 'L', name: '熔野爆发', short: '大招',
      desc: '大招：烈焰席卷整个林场',
      cooldown: 26.0, maxLevel: 3, baseCost: 90, costGrowth: 1.8,
      radius: 2000, damage: 45, damagePerLevel: 22,
      cdPerLevel: 1.0, fxTime: 0.7, fxColor: 0xff7a3c, ultimate: true,
    },
  };
  const SKILL_ORDER = ['whirl', 'blink', 'slam', 'cry', 'nova'];

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

  /**
   * 藤蔓 Boss。三个设计约束（来自 PM 要求）：
   *
   * 1. **移动极慢**，靠贴身普攻与技能施压，而不是追击。
   * 2. **技能范围分层**：2 近身 + 2 范围（直径不超过半屏 480px）+ 1 全屏。
   * 3. **全屏技能必须有前摇**，且前摇长到可以用闪现躲开 —— 这是唯一的应对手段，
   *    所以 windup 必须显著大于玩家的反应时间 + 按键时间（约 0.35s）。
   *
   * 三档难度对应 PM 定的装备门槛：
   *   normal — 次顶级装备可艰难通过
   *   hard   — 顶级装备可艰难通过
   *   hell   — 全套装备 + 熟练技能使用才能通过
   */
  const BOSS = {
    id: 'vineTitan',
    name: '藤蔓巨像',
    radius: 46,              // 判定半径。视觉高 150px，判定按体宽的一半，
                             // 避免玩家站在 Boss "身体里"却不在判定内。
    bodyW: 240, bodyH: 220,  // 美术简报里的原生尺寸
    // 移动很慢：小怪是 92~126，Boss 只有 26
    speed: 26,
    attackCooldown: 2.4,     // 贴身普攻间隔
    meleeRange: 96,          // 贴身普攻距离
    tiers: {
      normal: { hp: 1400, damage: 18, speedMul: 1.00, cdMul: 1.00,
                label: '普通', hint: '次顶级装备可艰难通过' },
      hard:   { hp: 2400, damage: 26, speedMul: 1.15, cdMul: 0.85,
                label: '困难', hint: '顶级装备可艰难通过' },
      hell:   { hp: 4000, damage: 36, speedMul: 1.30, cdMul: 0.70,
                label: '地狱', hint: '全套装备且熟练使用技能' },
    },
    skills: [
      // ---- 2 个近身技能（贴身）----
      { id: 'slam',    name: '碾压',   range: 'melee', radius: 120, damage: 26,
        windup: 0.55, cd: 5.0,  knockback: 380,
        desc: '抬起身体砸向近处，命中范围略大于体型' },
      { id: 'grab',    name: '缠绕',   range: 'melee', radius: 140, damage: 22,
        windup: 0.40, cd: 7.0,  stunTime: 0.8, pull: 90,
        desc: '藤蔓缠住近处目标，把玩家拉向自己' },
      // ---- 2 个范围技能（直径不超过半屏 480px）----
      { id: 'sweep',   name: '横扫',   range: 'area', radius: 210, damage: 24,
        windup: 0.70, cd: 8.0,  knockback: 300,
        desc: '横扫半个场地，直径 420px' },
      { id: 'seeds',   name: '种子爆散', range: 'area', radius: 180, damage: 18,
        windup: 0.85, cd: 10.0, projectiles: 8, projSpeed: 220,
        desc: '向四周爆散种子，直径 360px，需靠走位穿过间隙' },
      // ---- 1 个全屏技能（有前摇，可闪现躲）----
      { id: 'wither',  name: '枯萎领域', range: 'full', radius: 2000, damage: 42,
        windup: 1.40, cd: 20.0,
        desc: '全屏枯萎，1.4 秒前摇后爆发；前摇期间闪现离开原地可躲开' },
    ],
  };

  // 战利品：每只小怪的基础掉落，再乘难度 lootMul
  const LOOT = {
    coinsPerKill: 4,
    seedChance: 0.05,       // 每只小怪掉种子的概率（0.05 = 5%）
    clearBonusCoins: 20,    // 清完一波的额外奖励
    lossKeep: 0.5,          // 倒下时保留的战利品比例
    // 掉落物需要走过去捡。这是战斗节奏的关键：
    // 打完一波之后有一段"扫战场"的动作，而不是数字自动入账，
    // 于是 打 → 捡 → 下一波 形成节拍。
    pickupLife: 16,         // 掉落物存在时间（秒）
    pickupRadiusX: 40,      // 拾取范围
    pickupRadiusZ: 34,
    pickupGravity: 620,     // 掉落物弹出的重力，决定手感（越大落得越快）
  };

  /**
   * 刷怪分批发。一次全涌出来会让每波变成"站桩清场"，
   * 改成 3 只一批、批间停顿，战斗就有了推进感。
   */
  const SPAWN = {
    burstSize: 3,           // 每批数量
    burstGap: 2.6,          // 批与批之间的停顿（秒）
  };

  const API = {
    FIELD_W, FIELD_D, GROUND_Y,
    PLAYER_W, PLAYER_H, PLAYER_SPEED, PLAYER_DEPTH_SPEED,
    SPRINT_MULT, SPRINT_DEPTH_MULT,
    JUMP_V, GRAVITY,
    ATTACK_DURATION, ATTACK_COOLDOWN, ATTACK_RANGE, ATTACK_DEPTH, ATTACK_BACK, COMBO,
    INVULN_AFTER_HIT, WAVE_BREAK, WAVE_HEAL,
    BASE_HP, BASE_DAMAGE, BASE_ATTACK_SPEED,
    DIFFICULTIES, ENEMIES, UPGRADES, FARM, LOOT, SKILLS, SKILL_ORDER, SPAWN, BOSS,
    waveComposition,
    difficultyById: function (id) {
      return DIFFICULTIES.find(function (d) { return d.id === id; }) || DIFFICULTIES[1];
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.GameConfig = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
