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
      { damageMul: 1.00, cooldown: 0.26, range: 61, knockback: 120, stun: 0.10 },
      { damageMul: 1.15, cooldown: 0.28, range: 66, knockback: 180, stun: 0.12 },
      { damageMul: 1.85, cooldown: 0.62, range: 78, knockback: 460, stun: 0.34 },
    ],
    window: 0.55,   // 两段之间允许的间隔
  };
  const ATTACK_RANGE = 66;      // 前方攻击距离（V18：三段连段与判定整体 +5%，62×1.05=65.1 故取 66）
  const ATTACK_DEPTH = 55;      // 深度容差：|z 差| 超过它就打不中（原 52，同比放大）
  const ATTACK_BACK = 15;       // 身后也能蹭到一点（原 14，同比放大）
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
   * 药水（消耗品）。
   *
   * 存在的理由不是"多三个技能"，而是给经营层开一个**永远不会枯竭的出口**：
   * 升级与装备都会在满级后停止吸钱，只有"每局都要重新买"的消耗品
   * 能让铜币始终有去处，玩家的选择也始终有效。
   *
   * 三条效果刻意选在**不同维度**上，避免互相替代：
   *   治疗 = 立刻回血（换血量）
   *   力量 = 15 秒增伤（换输出窗口）
   *   护盾 = 8 秒减伤（换容错）
   * 前两个是"增量"，第三个是"抗压"，对应三种不同的翻盘场景。
   *
   * 键位 1/2/3 由 PM 指定（设计文档 4.5 曾把键位列为实现者决定，
   * PM 已明确要数字键）。
   */
  const POTIONS = {
    heal: {
      key: '1', name: '治疗药水', short: '治疗',
      desc: '立刻恢复 25 点生命',
      price: 60, carry: 3,
      kind: 'instant', heal: 25,
      color: 0x7fe08a,
    },
    strength: {
      key: '2', name: '力量药水', short: '力量',
      desc: '15 秒内伤害提升 25%',
      price: 80, carry: 2,
      kind: 'buff', duration: 15.0, damageMul: 1.25,
      color: 0xff9a6c,
    },
    wall: {
      key: '3', name: '护盾药水', short: '护盾',
      desc: '8 秒内受到的伤害减半',
      price: 90, carry: 2,
      kind: 'buff', duration: 8.0, hurtMul: 0.5,
      color: 0x9ad7ff,
    },
  };
  const POTION_ORDER = ['heal', 'strength', 'wall'];

  /**
   * 装备（设计文档 §4）。
   *
   * 定位：铁匠铺管**基础属性**，装备管**独特机制**（方案 C）。
   * 如果装备只是"第三个加属性的地方"，三层就退化成同一件事，
   * 玩家只会比较数字大小 —— 那是最省事也最没有内容的设计。
   *
   * 三条不变量（改数值时必须一起检查，测试里有对应断言）：
   *   1. 特效装备价格挤在 680–900：让玩家按打法选，不是按数值选。
   *   2. 任何装备的等效强度不超过同部位基础装备的 1.3 倍，防止唯一最优解。
   *   3. 特效装备升级只提升**强度参数**，绝不改变机制本身 ——
   *      反伤 30%→34%→38% 永远是"反伤"，不会升级成别的东西。
   *
   * 价格按 1.45 倍递增（§4.4），基础装备 3 级、特效装备 5 级。
   */
  const EQUIP_SLOTS = ['head', 'torso', 'back', 'weapon', 'feet'];

  const EQUIP_SLOT_NAMES = {
    head: '头部', torso: '躯干', back: '背部', weapon: '武器', feet: '鞋',
  };

  // 等级价格倍率与效果倍率。效果每级约 +8%，价格 1.45 倍递增 ——
  // 价格涨得比效果快，是为了让"升到满级"始终是一个需要攒钱的决定，
  // 而不是顺手点两下就完成的事。
  const EQUIP_LEVEL = {
    priceGrowth: 1.45,
    effectPerLevel: 0.08,
    levels: { base: 3, special: 5 },
  };

  /**
   * 基础装备 16 件：主要是属性倾向，视觉靠轮廓区分（§4.2）。
   * 扩到 16 件是为了让 5% 掉落能持续 10+ 局 —— 只做 4 件会被 2–3 局掉完，
   * 掉落的价值立刻归零（重复品进背包、由玩家自行出售，见 2026-11-12 设计文档）。
   *
   * 每件只给 1–2 条属性，且单件强度都低于一级强化，
   * 避免装备叠加后把难度阶梯压平。
   */
  const EQUIPMENT = {
    // ---- 头部（4 档）----
    leatherHelm: { name: '皮盔', slot: 'head', tier: 0, price: 80, kind: 'base',
      desc: '生命上限 +12', mods: { maxHp: 12 } },
    ironHelm: { name: '铁盔', slot: 'head', tier: 1, price: 190, kind: 'base',
      desc: '生命上限 +22', mods: { maxHp: 22 } },
    guardHelm: { name: '护颊盔', slot: 'head', tier: 2, price: 380, kind: 'base',
      desc: '生命上限 +32 · 受伤 −6%', mods: { maxHp: 32, hurtMul: 0.94 } },
    hornHelm: { name: '角盔', slot: 'head', tier: 3, price: 700, kind: 'base',
      desc: '生命上限 +44 · 受伤 −8%', mods: { maxHp: 44, hurtMul: 0.92 } },

    // ---- 躯干（4 档）----
    leatherVest: { name: '皮甲', slot: 'torso', tier: 0, price: 90, kind: 'base',
      desc: '受伤 −6%', mods: { hurtMul: 0.94 } },
    chestPlate: { name: '胸甲', slot: 'torso', tier: 1, price: 210, kind: 'base',
      desc: '受伤 −11% · 生命 +10', mods: { hurtMul: 0.89, maxHp: 10 } },
    pauldron: { name: '肩甲', slot: 'torso', tier: 2, price: 420, kind: 'base',
      desc: '受伤 −16% · 生命 +18', mods: { hurtMul: 0.84, maxHp: 18 } },
    fullPlate: { name: '全身板甲', slot: 'torso', tier: 3, price: 780, kind: 'base',
      desc: '受伤 −22% · 生命 +28 · 移速 −4%',
      mods: { hurtMul: 0.78, maxHp: 28, speedMul: 0.96 } },

    // ---- 背部（4 档）----
    shortCape: { name: '短披风', slot: 'back', tier: 0, price: 85, kind: 'base',
      desc: '移速 +3%', mods: { speedMul: 1.03 } },
    longCloak: { name: '长斗篷', slot: 'back', tier: 1, price: 200, kind: 'base',
      desc: '移速 +5% · 受伤 −5%', mods: { speedMul: 1.05, hurtMul: 0.95 } },
    // 背部是移动/防护槽，**不承担输出**。
    // 原本这里给了 +4/+7 伤害，加上武器与 buff 后满套基础装能到 3 倍基础伤害，
    // 装备就从"倾向"变成了"替代难度选择"，30 节的平衡不变量会被击穿。
    runeCloak: { name: '符文披风', slot: 'back', tier: 2, price: 440, kind: 'base',
      desc: '移速 +7% · 受伤 −4%', mods: { speedMul: 1.07, hurtMul: 0.96 } },
    wingCape: { name: '翼形斗篷', slot: 'back', tier: 3, price: 760, kind: 'base',
      desc: '移速 +10% · 受伤 +3%（跑得快，也更脆）',
      mods: { speedMul: 1.10, hurtMul: 1.03 } },

    // ---- 武器（5 档）----
    rustySword: { name: '锈剑', slot: 'weapon', tier: 0, price: 100, kind: 'base',
      desc: '伤害 +4', mods: { damage: 4 } },
    shortSword: { name: '短剑', slot: 'weapon', tier: 1, price: 230, kind: 'base',
      desc: '伤害 +8', mods: { damage: 8 } },
    broadSword: { name: '阔剑', slot: 'weapon', tier: 2, price: 450, kind: 'base',
      desc: '伤害 +13', mods: { damage: 13 } },
    twinBlades: { name: '双刀', slot: 'weapon', tier: 3, price: 720, kind: 'base',
      desc: '伤害 +10 · 移速 +4%', mods: { damage: 10, speedMul: 1.04 } },
    crystalStaff: { name: '棱晶杖', slot: 'weapon', tier: 4, price: 900, kind: 'base',
      desc: '伤害 +12 · 受伤 −5%', mods: { damage: 12, hurtMul: 0.95 } },

    // ---- 鞋（4 档）----
    strawShoes: { name: '草鞋', slot: 'feet', tier: 0, price: 80, kind: 'base',
      desc: '移速 +4%', mods: { speedMul: 1.04 } },
    windBoots: { name: '疾风靴', slot: 'feet', tier: 1, price: 200, kind: 'base',
      desc: '移速 +7%', mods: { speedMul: 1.07 } },
    greaves: { name: '护膝胫甲', slot: 'feet', tier: 2, price: 400, kind: 'base',
      desc: '移速 +9% · 生命 +14', mods: { speedMul: 1.09, maxHp: 14 } },
    stoneBoots: { name: '磐石靴', slot: 'feet', tier: 3, price: 740, kind: 'base',
      desc: '移速 +12% · 受伤 −7%', mods: { speedMul: 1.12, hurtMul: 0.93 } },
  };

  /**
   * 特效装备 12 件：数值刻意接近，**差异全在效果**（§4.2）。
   * 价格挤在 680–900，就是为了让选择发生在"我想怎么打"这一层。
   *
   * fx 字段是机制的声明式描述，具体实现集中在 logic.js，
   * 这里只写"是什么"和强度参数，方便测试逐条断言机制真的触发了。
   */
  const EQUIP_FX = {
    // ---- 技能改造 6 件（§4.6）----
    battleAxe: { name: '战斧', slot: 'weapon', price: 700, kind: 'special',
      desc: '震地范围 +50%，冷却 +15%',
      fx: { id: 'slamWide', areaMul: 1.5, cdMul: 1.15 } },
    voidBlade: { name: '虚空之刃', slot: 'weapon', price: 820, kind: 'special',
      desc: '裂风斩附加吸血（伤害的 15% 回血）',
      fx: { id: 'waveLifesteal', lifesteal: 0.15 } },
    frostArmor: { name: '霜缚护甲', slot: 'torso', price: 760, kind: 'special',
      desc: '闪现落点留下冰霜，减速范围内的敌人',
      fx: { id: 'blinkFrost', slowMul: 0.55, duration: 2.2, radius: 110 } },
    thunderHelm: { name: '雷鸣角盔', slot: 'head', price: 740, kind: 'special',
      desc: '第 3 段普攻附带电击',
      fx: { id: 'comboShock', radius: 90, damageMul: 0.6 } },
    emberBoots: { name: '熔火战靴', slot: 'feet', price: 720, kind: 'special',
      desc: '震地留下灼烧地面，持续伤害',
      fx: { id: 'slamBurn', dps: 9, duration: 3.0, radius: 100 } },
    trident: { name: '三叉圣杖', slot: 'weapon', price: 880, kind: 'special',
      desc: '大招范围 +20%',
      fx: { id: 'ultWide', areaMul: 1.2 } },

    // ---- 其余特效 6 件 ----
    thornMail: { name: '荆棘甲', slot: 'torso', price: 700, kind: 'special',
      desc: '受击时反弹 30% 伤害给攻击者',
      fx: { id: 'thorns', reflect: 0.30 } },
    bloodCharm: { name: '血滴护符', slot: 'back', price: 800, kind: 'special',
      desc: '击杀敌人回复 2 点生命',
      fx: { id: 'killHeal', heal: 2 } },
    stormRing: { name: '雷鸣指环', slot: 'head', price: 690, kind: 'special',
      desc: '攻击有 20% 概率触发连锁闪电',
      fx: { id: 'chainLightning', chance: 0.20, radius: 120, damageMul: 0.5 } },
    cinderCloak: { name: '余烬披风', slot: 'back', price: 750, kind: 'special',
      desc: '受击后在身周爆出火星，灼烧附近敌人',
      fx: { id: 'ashBurst', radius: 100, damage: 10 } },
    aegisPlate: { name: '庇护胸铠', slot: 'torso', price: 860, kind: 'special',
      desc: '生命低于 35% 时获得护盾，减伤 25%',
      fx: { id: 'lowHpShield', threshold: 0.35, hurtMul: 0.75 } },
    phaseBoots: { name: '相位战靴', slot: 'feet', price: 790, kind: 'special',
      desc: '受到致命伤时免疫一次并回 15 血（每局一次）',
      fx: { id: 'deathWard', heal: 15 } },

    // ---- 专属技能 2 件（占武器位，§4.7）----
    oathkeeper: { name: '守誓者', slot: 'weapon', price: 900, kind: 'special',
      desc: '获得专属技能「格挡」：举盾 2 秒减伤 70%，期间不能移动',
      fx: { id: 'grantSkill', skill: 'block' } },
    arcaneTome: { name: '秘法之书', slot: 'weapon', price: 860, kind: 'special',
      desc: '获得专属技能「短距传送」：前冲 240px，无敌',
      fx: { id: 'grantSkill', skill: 'blink2' } },
  };

  /** 专属技能定义。键位 V，与现有技能栏并列但**只在装备时出现**。 */
  const SPECIAL_SKILLS = {
    block: {
      key: 'V', name: '格挡', short: '格挡',
      desc: '举盾 2 秒，减伤 70%，期间不能移动',
      cooldown: 12.0, duration: 2.0, hurtMul: 0.30,
      color: 0x9ad7ff,
    },
    blink2: {
      key: 'V', name: '短距传送', short: '传送',
      desc: '向前突进 240px，途中无敌',
      cooldown: 9.0, distance: 240, invuln: 0.45,
      color: 0xc9a6ff,
    },
  };

  /** 掉落（§4.3）。5% 是明确要求；重复品不再折算，统一进背包由玩家自行处理。 */
  const EQUIP_DROP = {
    chance: 0.05,
    // 只掉基础装备：特效装备是"目标"，需要攒钱买，
    // 掉落会让它失去稀缺性，玩家也就不会再为它攒钱了。
    baseOnly: true,
  };

  /** 全部装备的查询表与排序。基础装备按部位+档位，特效装备随后。 */
  const ALL_EQUIPMENT = Object.assign({}, EQUIPMENT, EQUIP_FX);

  function equipDef(id) { return ALL_EQUIPMENT[id] || null; }

  /** 某件装备在给定等级（1 起）的价格。等级越高越贵，1.45 倍递增。 */
  function equipPrice(id, level) {
    const def = equipDef(id);
    if (!def) return 0;
    const lv = Math.max(1, level || 1);
    return Math.round(def.price * Math.pow(EQUIP_LEVEL.priceGrowth, lv - 1));
  }

  function equipMaxLevel(id) {
    const def = equipDef(id);
    if (!def) return 1;
    return def.kind === 'special' ? EQUIP_LEVEL.levels.special
                                  : EQUIP_LEVEL.levels.base;
  }

  /**
   * 等级带来的效果倍率。1 级 = 1.0，每级 +8%。
   * **只缩放强度参数，不改变机制**（§4.4 的关键约束）。
   */
  function equipEffectMul(level) {
    return 1 + (Math.max(1, level || 1) - 1) * EQUIP_LEVEL.effectPerLevel;
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
    /*
     * 种子失效（设计 §3.5）：超过「自家播种量」（= 田地数）的那部分种子
     * 每局腐烂这个比例。写在配置里而不是逻辑里，是为了和别的数值一样可调。
     * 为什么需要它：meta.seeds 是单一整数，玩家没有上限地囤种子，
     * 而田地有限，囤积没有任何用途 —— 只是数字变大。
     */
    seedSpoilRate: 0.25,
  };

  /**
   * 背包分页与扩容（设计 §4.7）。
   *
   * 5×7 = 35 格一页，起手 1 页、最多 6 页，所以容量是 35 → 210。
   * pagePrices[N] 是「从第 N 页扩到第 N+1 页」的价格，
   * 于是买页 2 收 pagePrices[1]。价位刻意做陡：扩容是长线投入，
   * 不该和买装备抢同一笔钱的决策权重。
   * 数值只写在这里 —— CI 会检查逻辑层不许内联写死数值。
   */
  const BAG = {
    cols: 5, rows: 7,
    cellsPerPage: 35,
    maxPages: 6,
    pagePrices: [0, 200, 500, 1000, 2000, 5000],
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
    attackCooldown: 3.1,     // 贴身普攻间隔。2.4 时出手过密，玩家读不到节奏；
                             // 调到 3.1 让每一次出手之间有可预判的空隙。
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
        windup: 0.55, cd: 5.8,  knockback: 380,
        desc: '抬起身体砸向近处，命中范围略大于体型' },
      { id: 'grab',    name: '缠绕',   range: 'melee', radius: 140, damage: 22,
        windup: 0.40, cd: 8.1,  stunTime: 0.8, pull: 90,
        desc: '藤蔓缠住近处目标，把玩家拉向自己' },
      // ---- 2 个范围技能（直径不超过半屏 480px）----
      { id: 'sweep',   name: '横扫',   range: 'area', radius: 210, damage: 24,
        windup: 0.70, cd: 9.2,  knockback: 300,
        desc: '横扫半个场地，直径 420px' },
      { id: 'seeds',   name: '种子爆散', range: 'area', radius: 180, damage: 18,
        windup: 0.85, cd: 11.5, projectiles: 8, projSpeed: 220,
        desc: '向四周爆散种子，直径 360px，需靠走位穿过间隙' },
      // ---- 1 个全屏技能（有前摇，可闪现躲）----
      { id: 'wither',  name: '枯萎领域', range: 'full', radius: 2000, damage: 42,
        windup: 1.40, cd: 23.0,
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

  /**
   * 音效（Task 12）：自建 AudioContext 合成，不借 Phaser 的音频系统。
   *
   * 为什么参数在数据层
   * ------------------
   * 音色是**手感**的一部分，和伤害数值一样会被反复调。把它写成数据表，
   * 调音只改这里，audio.js 里没有任何一个音效专属的分支。
   *
   * 声部（voice）字段
   * -----------------
   *   wave    sine / triangle / square / sawtooth / noise
   *   at      相对起奏的秒数（和弦、双音靠这个错开）
   *   dur     声部时长（约等于包络衰减到静音的时间）
   *   gain    峰值增益（相对 masterGain，全部汇总后仍 < 1，不会削波）
   *   f0/f1   频率起点/终点；给了 f1 就做指数滑动（下滑=打击，上扬=蓄力）
   *   attack  起音时间，太长会糊、太短会"啪"（默认 4ms）
   *   filter  噪声成形（{type,f0,f1,q}）；噪声声部没有滤波器就是一片白噪
   *   am      振幅调制（{rate,depth}），做气泡/颤音的质感
   *
   * 音量与静音存在 meta.settings.volume / muted（logic.js 的 createState 里
   * 已经留好了这两个字段），跨会话保留。
   */
  const AUDIO = {
    volume: 0.30,           // 总音量（masterGain），首次进入的默认值
    throttle: 0.025,        // 同一音效 25ms 内只响一次（连段同帧三下会爆音）
    sfx: {
      // ---- 战斗 ----
      slash: { voices: [
        // 刀刃破风：带通噪声从 3.2kHz 扫到 1.1kHz，高频先起、快速衰减
        { wave: 'noise', dur: 0.075, gain: 0.30,
          filter: { type: 'bandpass', f0: 3200, f1: 1100, q: 1.2 } },
        // 加一条很轻的锯波下滑，给"挥"一个音高感，不然只是沙沙声
        { wave: 'sawtooth', dur: 0.055, gain: 0.06, f0: 420, f1: 180 },
      ] },
      hit: { voices: [
        // 入肉：低频正弦 180→70Hz 的短促下坠（身体能感到的那一下）
        { wave: 'sine', dur: 0.06, gain: 0.32, f0: 180, f1: 70 },
        // 叠一点低通噪声做"噗"，纯正弦会像木鱼
        { wave: 'noise', dur: 0.045, gain: 0.16,
          filter: { type: 'lowpass', f0: 1500, f1: 500, q: 0.8 } },
      ] },
      crit: { voices: [
        // 重劈：高频泛音（1046→1568 上扬）+ 三角波，短促 150ms
        { wave: 'triangle', dur: 0.14, gain: 0.22, f0: 1046, f1: 1568 },
        { wave: 'sine', dur: 0.10, gain: 0.20, f0: 2093 },
        // 一点高通噪声当"金属划痕"，让重击和普通命中区分得开
        { wave: 'noise', dur: 0.09, gain: 0.14,
          filter: { type: 'highpass', f0: 2600, f1: 5200, q: 0.7 } },
      ] },
      hurt: { voices: [
        // 玩家受伤：方波 220→90Hz 闷哼，低通压住高频（不能比命中还亮）
        { wave: 'square', dur: 0.20, gain: 0.20, f0: 220, f1: 90,
          filter: { type: 'lowpass', f0: 900, f1: 500, q: 0.9 } },
        { wave: 'sine', dur: 0.16, gain: 0.18, f0: 110, f1: 70 },
      ] },
      // ---- 战利品 ----
      coin: { voices: [
        // 铜币：两枚先后落在 1046 / 1568Hz，60ms 一颗，干净的正弦
        { wave: 'sine', dur: 0.06, gain: 0.22, f0: 1046 },
        { wave: 'sine', at: 0.045, dur: 0.07, gain: 0.18, f0: 1568 },
      ] },
      seed: { voices: [
        // 种子：比铜币更高更薄（1568→2093），三角波，音量更小
        { wave: 'triangle', dur: 0.05, gain: 0.16, f0: 1568, f1: 2093 },
      ] },
      dropNew: { voices: [
        // 掉落新件：C-E-G 三连上行（523/659/784），每音 90ms，庆祝但克制
        { wave: 'triangle', dur: 0.11, gain: 0.18, f0: 523 },
        { wave: 'triangle', at: 0.055, dur: 0.11, gain: 0.18, f0: 659 },
        { wave: 'triangle', at: 0.11, dur: 0.12, gain: 0.20, f0: 784 },
      ] },
      dropDup: { voices: [
        // 重复件：两个下行短音（392→294），方波但音量低，避免听着像惩罚
        { wave: 'square', dur: 0.07, gain: 0.10, f0: 392,
          filter: { type: 'lowpass', f0: 1800, f1: 1200, q: 0.8 } },
        { wave: 'square', at: 0.07, dur: 0.08, gain: 0.10, f0: 294,
          filter: { type: 'lowpass', f0: 1600, f1: 1000, q: 0.8 } },
      ] },
      // ---- 系统动作 ----
      potion: { voices: [
        // 喝药：150→210Hz 低频 + 22Hz 振幅调制 = 咕嘟气泡；0.28s 收住
        { wave: 'sine', dur: 0.28, gain: 0.26, f0: 150, f1: 210,
          am: { rate: 22, depth: 0.85 } },
        { wave: 'noise', at: 0.06, dur: 0.18, gain: 0.07,
          filter: { type: 'lowpass', f0: 700, f1: 400, q: 1.4 } },
      ] },
      skill: { voices: [
        // 技能：锯波 300→1200 上扬（蓄力），尾部接带通噪声"释放"
        { wave: 'sawtooth', dur: 0.18, gain: 0.14, f0: 300, f1: 1200,
          filter: { type: 'lowpass', f0: 2400, f1: 4000, q: 0.9 } },
        { wave: 'noise', at: 0.10, dur: 0.16, gain: 0.12,
          filter: { type: 'bandpass', f0: 1200, f1: 3000, q: 1.1 } },
      ] },
      special: { voices: [
        // 专属技：110→220 锯波 + 55Hz 方波低音 + 2.6kHz 三角尾，厚且沉
        { wave: 'sawtooth', dur: 0.28, gain: 0.16, f0: 110, f1: 220,
          filter: { type: 'lowpass', f0: 1600, f1: 2600, q: 1.0 } },
        { wave: 'square', dur: 0.30, gain: 0.14, f0: 55,
          filter: { type: 'lowpass', f0: 400, f1: 300, q: 0.9 } },
        { wave: 'triangle', at: 0.02, dur: 0.34, gain: 0.10, f0: 2600, f1: 1400 },
      ] },
      upgrade: { voices: [
        // 购买/穿戴/升级/播种成功：两声上行确认（1318→1760），短、轻、不烦
        { wave: 'sine', dur: 0.07, gain: 0.18, f0: 1318 },
        { wave: 'sine', at: 0.06, dur: 0.10, gain: 0.16, f0: 1760 },
      ] },
      sell: { voices: [
        // 出售：1568→2093 两个方波短音（收银机叮），音量压得很低
        { wave: 'square', dur: 0.05, gain: 0.07, f0: 1568,
          filter: { type: 'highpass', f0: 800, f1: 1200, q: 0.7 } },
        { wave: 'square', at: 0.05, dur: 0.07, gain: 0.07, f0: 2093,
          filter: { type: 'highpass', f0: 900, f1: 1400, q: 0.7 } },
      ] },
      bagOpen: { voices: [
        // 开背包：带通噪声 400→3000Hz 的"唰"（拉链/布料），0.14s
        { wave: 'noise', dur: 0.14, gain: 0.16,
          filter: { type: 'bandpass', f0: 400, f1: 3000, q: 0.9 } },
        { wave: 'triangle', at: 0.02, dur: 0.10, gain: 0.08, f0: 660, f1: 990 },
      ] },
      // ---- 进程 ----
      wave: { voices: [
        // 新一波：G-B-D（196/247/294）三音和声，22ms 错开成"号角"
        { wave: 'sawtooth', dur: 0.22, gain: 0.10, f0: 196,
          filter: { type: 'lowpass', f0: 1800, f1: 1200, q: 0.8 } },
        { wave: 'sawtooth', at: 0.01, dur: 0.22, gain: 0.09, f0: 247,
          filter: { type: 'lowpass', f0: 1800, f1: 1200, q: 0.8 } },
        { wave: 'sawtooth', at: 0.02, dur: 0.24, gain: 0.09, f0: 294,
          filter: { type: 'lowpass', f0: 2000, f1: 1300, q: 0.8 } },
      ] },
      boss: { voices: [
        // Boss 出场：55→38Hz 正弦超低 + 300Hz 低通噪声，0.5s 的地面震动
        { wave: 'sine', dur: 0.50, gain: 0.34, f0: 55, f1: 38 },
        { wave: 'noise', dur: 0.35, gain: 0.18,
          filter: { type: 'lowpass', f0: 320, f1: 180, q: 0.9 } },
        { wave: 'sawtooth', at: 0.04, dur: 0.40, gain: 0.08, f0: 82, f1: 55,
          filter: { type: 'lowpass', f0: 600, f1: 300, q: 1.0 } },
      ] },
      death: { voices: [
        // 玩家倒下：392 / 294 / 196 下行三音，每音 0.3s 指数衰减，收得干净
        { wave: 'triangle', dur: 0.30, gain: 0.18, f0: 392 },
        { wave: 'triangle', at: 0.11, dur: 0.30, gain: 0.18, f0: 294 },
        { wave: 'triangle', at: 0.22, dur: 0.32, gain: 0.20, f0: 196 },
      ] },
    },
  };

  const API = {
    FIELD_W, FIELD_D, GROUND_Y,
    PLAYER_W, PLAYER_H, PLAYER_SPEED, PLAYER_DEPTH_SPEED,
    SPRINT_MULT, SPRINT_DEPTH_MULT,
    JUMP_V, GRAVITY,
    ATTACK_DURATION, ATTACK_COOLDOWN, ATTACK_RANGE, ATTACK_DEPTH, ATTACK_BACK, COMBO,
    INVULN_AFTER_HIT, WAVE_BREAK, WAVE_HEAL,
    BASE_HP, BASE_DAMAGE, BASE_ATTACK_SPEED,
    DIFFICULTIES, ENEMIES, UPGRADES, FARM, BAG, LOOT, SKILLS, SKILL_ORDER, SPAWN, BOSS,
    POTIONS, POTION_ORDER,
    EQUIP_SLOTS, EQUIP_SLOT_NAMES, EQUIPMENT, EQUIP_FX, ALL_EQUIPMENT,
    SPECIAL_SKILLS, EQUIP_DROP, EQUIP_LEVEL,
    AUDIO,
    equipDef, equipPrice, equipMaxLevel, equipEffectMul,
    waveComposition,
    difficultyById: function (id) {
      return DIFFICULTIES.find(function (d) { return d.id === id; }) || DIFFICULTIES[1];
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.GameConfig = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
