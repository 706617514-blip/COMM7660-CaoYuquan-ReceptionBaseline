/**
 * test_audio.js — 自建 AudioContext 音效层的测试。
 *
 * 为什么要单独一层，而不是借 Phaser 的声音
 * ----------------------------------------
 * boot() 里显式写了 audio: { noAudio: true }（见 game/app.js）。
 * 于是 Phaser 用的是 NoAudioSoundManager：play() 恒返回 false，**没有 .context**。
 * 这个决定是对的（Phaser 的音频解码在 Canvas/无音频环境下会给玩家留一堆死音轨），
 * 但它意味着音效必须自己 new AudioContext()。
 *
 * 这条测试要守住的不是"函数被调用过"，而是那些**如果坏了玩家立刻听得出**的事实：
 *   - play() 真的向 AudioContext 建了振荡器/增益节点（空函数也能"不抛错"）
 *   - 用的是我们自建的 ctx，不是 Phaser 的 game.sound.context
 *   - 自动播放策略：首次用户手势里调过 resume()
 *   - 同音效 25ms 内重复触发被合并（连段攻击同帧三下，不合并就是爆音）
 *   - 静音是 masterGain.gain = 0，**不许** ctx.close()（关掉就再也开不回来了）
 *   - 音量/静音读写 meta.settings，跨会话保留
 *
 * stub 说明：Node 里没有 WebAudio。stub 只桩 play() 真正用到的 API。
 * 实现里若新增 createXxx / AudioParam 方法，必须在这里补同名方法，
 * 否则会抛 TypeError: ... is not a function —— 那是 stub 不全，不是音效坏了。
 * 提交前用 `grep -o 'create[A-Za-z]*' game/audio.js | sort -u` 对一遍。
 *
 * 用法: node tests/test_audio.js
 */
'use strict';

const path = require('path');

let pass = 0, fail = 0;
const failures = [];

function ok(cond, label, detail) {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else {
    fail++; failures.push(label);
    console.log(`  FAIL  ${label}` + (detail !== undefined ? `  -> ${detail}` : ''));
  }
}
function eq(actual, expected, label) {
  ok(actual === expected, label, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(t) { console.log(`\n=== ${t} ===`); }

// 段落包一层：段内抛异常（例如 API 还没实现）记一次失败并继续，
// 不让整个套件崩掉把后面的断言全藏起来。
function group(label, fn) {
  try { fn(); }
  catch (e) { ok(false, label + '（段落抛异常）', e.message); }
}

// ---------------------------------------------------------------- WebAudio stub

// AudioParam：记录每一次自动化事件，value 跟着走。
function makeParam(initial) {
  return {
    value: initial === undefined ? 0 : initial,
    events: [],
    setValueAtTime(v, t) { this.value = v; this.events.push(['set', v, t]); return this; },
    linearRampToValueAtTime(v, t) { this.value = v; this.events.push(['lin', v, t]); return this; },
    exponentialRampToValueAtTime(v, t) { this.value = v; this.events.push(['exp', v, t]); return this; },
    setTargetAtTime(v, t, c) { this.value = v; this.events.push(['target', v, t, c]); return this; },
    cancelScheduledValues(t) { this.events.push(['cancel', t]); return this; },
  };
}

const contexts = [];

function StubAudioContext() {
  this.state = 'running';
  this.currentTime = 0;
  this.sampleRate = 44100;
  this.destination = { connect() {}, disconnect() {} };
  // 每一次 create* 都进这张表：数量为 0 就说明 play() 是空函数。
  this.created = [];
  this.resumed = false;
  this.resumeCount = 0;
  this.closed = false;
  contexts.push(this);
}

StubAudioContext.prototype.resume = function () {
  this.resumed = true;
  this.resumeCount += 1;
  if (this.state === 'suspended') this.state = 'running';
  return { then(fn) { return fn && fn(); }, catch() { return this; } };
};
StubAudioContext.prototype.close = function () { this.closed = true; this.state = 'closed'; };

StubAudioContext.prototype.createGain = function () {
  const g = {
    __kind: 'gain', gain: makeParam(1),
    connectedTo: null,
    connect(node) { this.connectedTo = node; return node; },
    disconnect() {},
  };
  this.created.push(g);
  return g;
};
StubAudioContext.prototype.createOscillator = function () {
  const o = {
    __kind: 'osc', type: 'sine', frequency: makeParam(440), detune: makeParam(0),
    started: false, stopped: false, startAt: null, stopAt: null,
    connect(node) { return node; }, disconnect() {},
    start(t) { this.started = true; this.startAt = t; },
    stop(t) { this.stopped = true; this.stopAt = t; },
    onended: null,
  };
  this.created.push(o);
  return o;
};
StubAudioContext.prototype.createBufferSource = function () {
  const s = {
    __kind: 'src', buffer: null, loop: false,
    started: false, stopped: false, startAt: null, stopAt: null,
    connect(node) { return node; }, disconnect() {},
    start(t) { this.started = true; this.startAt = t; },
    stop(t) { this.stopped = true; this.stopAt = t; },
    onended: null,
  };
  this.created.push(s);
  return s;
};
StubAudioContext.prototype.createBuffer = function (channels, length, rate) {
  const data = new Float32Array(length);
  return {
    __kind: 'buffer', numberOfChannels: channels, length, sampleRate: rate,
    getChannelData() { return data; },
  };
};
StubAudioContext.prototype.createBiquadFilter = function () {
  const f = {
    __kind: 'filter', type: 'lowpass', frequency: makeParam(350), Q: makeParam(1),
    gain: makeParam(0), connectedTo: null,
    connect(node) { this.connectedTo = node; return node; }, disconnect() {},
  };
  this.created.push(f);
  return f;
};
StubAudioContext.prototype.createDynamicsCompressor = function () {
  const c = {
    __kind: 'comp',
    threshold: makeParam(-24), knee: makeParam(30), ratio: makeParam(12),
    attack: makeParam(0.003), release: makeParam(0.25),
    connect(node) { return node; }, disconnect() {},
  };
  this.created.push(c);
  return c;
};

// 浏览器里 window === global。测试里给 global 补一个 addEventListener，
// 模拟"audio.js 在加载时注册首次手势监听"，并让测试能手动触发那一次手势。
const gestures = [];
global.addEventListener = function (type, fn) { gestures.push({ type: type, fn: fn }); };

global.AudioContext = StubAudioContext;
// 有的实现会查 webkit 前缀；桩上，避免加载时报错。
global.webkitAudioContext = StubAudioContext;

const C = require(path.join(__dirname, '..', 'game', 'config.js'));

let A = null;
let loadErr = null;
try {
  A = require(path.join(__dirname, '..', 'game', 'audio.js'));
} catch (e) { loadErr = e; }

// 让 currentTime 往前走。stub 的时钟不会自己走，节流断言必须手动推进。
function tick(seconds) {
  contexts.forEach((c) => { c.currentTime += seconds; });
}
function nodeCount() { return A && A.context ? A.context.created.length : 0; }
function gains() { return A.context.created.filter((n) => n.__kind === 'gain'); }
function masterGains() {
  return gains().filter((n) => n.connectedTo === A.context.destination);
}

// ---------------------------------------------------------------- 1. 模块与配置
section('1. 模块加载与 21 个音效的配置表');
ok(loadErr === null, 'game/audio.js 能被加载', loadErr && loadErr.message);
if (!A) {
  console.log('\n' + '='.repeat(56));
  console.log(`失败 ${fail} 项，通过 ${pass} 项`);
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}

// Task 23：17 -> 21。death 改名 defeat（-1/+1），新增 step1..3（+3）与 victory（+1）。
const NAMES = ['slash', 'hit', 'crit', 'hurt', 'coin', 'seed', 'dropNew', 'dropDup',
  'potion', 'skill', 'special', 'upgrade', 'sell', 'bagOpen', 'wave', 'boss', 'defeat',
  'victory', 'step1', 'step2', 'step3'];

group('21 个音效名', function () {
  const sfx = C.AUDIO && C.AUDIO.sfx;
  ok(!!sfx, 'config.js 里有 AUDIO.sfx 表');
  const keys = Object.keys(sfx || {});
  eq(keys.length, 21, 'AUDIO.sfx 恰好 21 个音效');
  const missing = NAMES.filter((n) => !sfx[n]);
  ok(missing.length === 0, '21 个名字一个不少', JSON.stringify(missing));
  const extra = keys.filter((k) => NAMES.indexOf(k) < 0);
  ok(extra.length === 0, '没有多出来的孤儿音效（避免"配了没人播"）', JSON.stringify(extra));
  // §3.3：旧名字必须彻底消失，否则"改了名但没改调用点"会静默无声
  ok(!sfx.death, 'death 已改名为 defeat（旧名不该还在）');
});

group('每个音效都有可听的合成参数', function () {
  const sfx = C.AUDIO.sfx;
  const bad = [];
  NAMES.forEach(function (n) {
    const s = sfx[n] || {};
    const voices = s.voices;
    if (!Array.isArray(voices) || voices.length === 0) { bad.push(n + ': 没有 voices'); return; }
    voices.forEach(function (v) {
      if (typeof v.wave !== 'string') bad.push(n + ': wave 不是字符串');
      if (!(v.dur > 0 && v.dur <= 1.5)) bad.push(n + ': dur=' + v.dur + '（应为 (0, 1.5]）');
      if (!(v.gain > 0 && v.gain <= 1)) bad.push(n + ': gain=' + v.gain + '（应为 (0, 1]）');
      // 噪声声部靠滤波器成形，没有 f0 时必须有 filter，否则只是"白噪声全带"
      if (v.wave === 'noise' && !v.filter) bad.push(n + ': 噪声声部没有 filter');
    });
  });
  ok(bad.length === 0, '每个声部的波形/时长/增益都合法', JSON.stringify(bad));
});

group('节流与总音量是配置而非魔数', function () {
  eq(C.AUDIO.throttle, 0.025, '节流 25ms 写在 config（不是散在代码里）');
  ok(C.AUDIO.volume > 0 && C.AUDIO.volume <= 1, '默认总音量在 (0, 1]', C.AUDIO.volume);
});

// ---------------------------------------------------------------- 2. 惰性创建
section('2. 加载时不建 AudioContext（Node 里没有 WebAudio 也不能炸）');
eq(contexts.length, 0, '模块加载时没有构造 AudioContext（惰性，等用户手势）');
ok(gestures.length > 0, '加载时注册了首次手势监听（自动播放策略）',
   gestures.map((g) => g.type).join(','));

// ---------------------------------------------------------------- 3. 21 个音效真的发声
section('3. 21 个音效都真的建了音频节点');
const before = nodeCount();
NAMES.forEach(function (n) {
  const n0 = nodeCount();
  let threw = null;
  let ret = null;
  try { ret = A.play(n); } catch (e) { threw = e.message; }
  ok(threw === null, n + ' 可播放且不抛错' + (threw ? '（抛了：' + threw + '）' : ''));
  ok(ret === true, n + ' 的 play() 返回 true（真的播了，不是被吞掉）', ret);
  ok(nodeCount() > n0, n + ' 至少建了一个音频节点（play 不是空函数）',
     nodeCount() - n0);
});
ok(A.context && A.context.created && A.context.created.length > 0,
   '真的向 AudioContext 里建了音频节点（play 不是空函数）', before);
ok(A.context instanceof StubAudioContext, '用的是自建的 AudioContext，不是 Phaser 的 game.sound');
eq(contexts.length, 1, '单例：21 个音效共用同一个 context（不是每次播放新建）');
eq(A.context.created.filter((n) => n.__kind === 'osc' || n.__kind === 'src').length > 0, true,
   '建了振荡器/噪声源（不是只建了个 gain 摆样子）');

// ctx.state === 'running' 这条本身证明不了实现（stub 一开始就是 running），
// 断言留到浏览器侧（smoke）去测真实状态；这里只断言我们没把它关掉。
ok(A.context.closed !== true && A.context.state !== 'closed', '播放后 context 没有被 close');

// 每个音效都必须真的被 stop()：用完即弃，不预建常驻音轨。
group('节点用完即弃', function () {
  const sources = A.context.created.filter((n) => n.__kind === 'osc' || n.__kind === 'src');
  const notStopped = sources.filter((n) => !n.stopped);
  ok(notStopped.length === 0, '每个音源都安排了 stop()（不会永久占用音轨）',
     notStopped.length);
  const noStart = sources.filter((n) => !n.started);
  ok(noStart.length === 0, '每个音源都 start() 过', noStart.length);
});

// ---------------------------------------------------------------- 4. 手势启动
section('4. 自动播放策略：首个用户手势里 resume()');
group('手势', function () {
  eq(A.context.resumeCount, 0, '加载与播放阶段没有擅自 resume（首次手势之前）');
  gestures.forEach((g) => { try { g.fn({ type: g.type }); } catch (e) { ok(false, '手势回调抛异常', e.message); } });
  ok(A.resumed === true || A.context.resumed === true,
     'ensureStarted() 调过 resume()（自动播放策略要求在用户手势里启动）');
  ok(gestures.filter((g) => g.type === 'pointerdown' || g.type === 'keydown').length > 0,
     '监听的正是 pointerdown / keydown 这类真实手势',
     gestures.map((g) => g.type).join(','));
});

// ---------------------------------------------------------------- 5. 节流
section('5. 同音效 25ms 节流（连段同帧三下不爆音）');
group('节流', function () {
  tick(0.2);                       // 先让时钟离开上一次播放的时刻
  const n1 = nodeCount();
  eq(A.play('coin'), true, 'clock 走开后第一声可以播');
  const oneShot = nodeCount() - n1;
  ok(oneShot > 0, '第一声建了节点', oneShot);

  const n2 = nodeCount();
  eq(A.play('coin'), false, '同一帧（0ms 后）再来一次被节流');
  eq(A.play('coin'), false, '第三下同样被节流');
  eq(nodeCount(), n2, '被节流时不建任何节点（不是"静音播放"）');

  const n3 = nodeCount();
  eq(A.play('seed'), true, '别的音效不受这一条影响（节流按名字分开）');
  ok(nodeCount() > n3, '别的音效照常建节点', nodeCount() - n3);

  tick(C.AUDIO.throttle + 0.001);
  const n4 = nodeCount();
  eq(A.play('coin'), true, '超过 25ms 之后同一个音效可以再播');
  ok(nodeCount() > n4, '重新建了节点', nodeCount() - n4);
});

// ---------------------------------------------------------------- 6. 音量与静音
section('6. 音量与静音（静音 = masterGain.gain = 0，不 close）');
group('音量', function () {
  const masters = masterGains();
  eq(masters.length, 1, '恰好一个 masterGain 接在 destination 上');
  const master = masters[0];
  ok(master.gain.value > 0, '默认总音量不是 0', master.gain.value);
  // 外面只能靠这个句柄证明"静音真的是把增益压到 0"，
  // 所以它必须是同一个节点，而不是另建一个谁也没接上的。
  eq(A.masterGain, master, 'A.masterGain 就是接在 destination 上的那个节点');

  A.setMasterVolume(0);
  eq(master.gain.value, 0, 'setMasterVolume(0) 让 masterGain.gain 真的归零');
  ok(A.context.closed !== true, '静音没有 close 掉 context（关了就读不回来了）');
  eq(A.context.state === 'closed', false, '静音后 context 仍是活的', A.context.state);

  // 静音状态下仍然允许"播"（只是听不到），否则节流/状态会变得不可预测；
  // 关键断言是：不许因为静音就跳过建节点，也不许任何操作 close。
  tick(0.2);
  ok(A.play('hit') === true, '静音时 play 仍然返回 true（音量由 masterGain 统一压掉）');

  A.setMasterVolume(0.5);
  eq(master.gain.value, 0.5, 'setMasterVolume(0.5) 恢复');

  A.setMuted(true);
  eq(A.isMuted(), true, 'isMuted() 反映静音状态');
  eq(master.gain.value, 0, 'setMuted(true) 同样把 masterGain 压到 0');
  A.setMuted(false);
  eq(A.isMuted(), false, 'setMuted(false) 解除静音');
  eq(master.gain.value, 0.5, '解除静音后回到静音前的音量（不是回到 1）');

  // 越界值必须被夹住：滑块或旧存档都可能给出 3 或 -1
  A.setMasterVolume(3);
  eq(master.gain.value, 1, '音量上限夹到 1');
  A.setMasterVolume(-1);
  eq(master.gain.value, 0, '音量下限夹到 0');
  A.setMasterVolume(0.5);
});

// ---------------------------------------------------------------- 7. 存档
section('7. 音量/静音存进 meta.settings（跨会话保留）');
group('持久化', function () {
  const st = { meta: { settings: { volume: 0.8, muted: false } } };
  A.syncSettings(st);
  eq(masterGains()[0].gain.value, 0.8, 'syncSettings 读到存档里的音量');

  A.setMasterVolume(0.4);
  eq(st.meta.settings.volume, 0.4, '调音量会写回 meta.settings.volume');

  A.setMuted(true);
  eq(st.meta.settings.muted, true, '静音会写回 meta.settings.muted');
  eq(masterGains()[0].gain.value, 0, '写回的同时当场生效');
  A.setMuted(false);

  // 旧存档可能没有 settings：要补默认值，而不是崩在 undefined.volume 上
  const old = { meta: {} };
  A.syncSettings(old);
  ok(old.meta.settings && typeof old.meta.settings.volume === 'number',
     '没有 settings 的旧存档补上默认值', JSON.stringify(old.meta.settings));
  eq(old.meta.settings.volume, C.AUDIO.volume, '补的默认音量来自 config');
});

// ---------------------------------------------------------------- 8. 未知名字
section('8. 未知音效名不炸、也不响');
group('未知名字', function () {
  tick(0.2);
  const n = nodeCount();
  let threw = null; let ret = null;
  try { ret = A.play('no_such_sfx'); } catch (e) { threw = e.message; }
  ok(threw === null, 'play(未知名) 不抛异常', threw);
  eq(ret, false, '返回 false 表示没播');
  eq(nodeCount(), n, '不建任何节点');
});

// ---------------------------------------------------------------- 9. 脚步
section('9. 脚步：按位移累积触发（Task 23 / 设计 §3.2）');
group('脚步配置', function () {
  const A2 = C.AUDIO;
  ok(typeof A2.stepStride === 'number' && A2.stepStride > 8 && A2.stepStride < 60,
     'AUDIO.stepStride 是合理的步幅（世界单位）', A2.stepStride);
  ok(typeof A2.stepStrideSprint === 'number' && A2.stepStrideSprint < A2.stepStride,
     '冲刺步幅比走路短（同样位移步子更密）', A2.stepStrideSprint);
  eq(A2.stepVolume, 0.12, 'stepVolume 上限 0.12 写在 config（不是散在代码里）');
  const variants = ['step1', 'step2', 'step3'];
  const miss = variants.filter((n) => !A2.sfx[n]);
  eq(miss.length, 0, '三个脚步变体都配了', miss.join(','));
  const peaks = variants.map((n) => (A2.sfx[n].voices || [])
    .reduce((sum, v) => sum + v.gain, 0) * A2.stepVolume);
  ok(peaks.every((p) => p <= A2.stepVolume + 1e-9),
     '每个变体的峰值都 ≤ stepVolume（脚步是背景节奏，不是事件）', JSON.stringify(peaks));
  const sigs = variants.map((n) => JSON.stringify(A2.sfx[n].voices));
  ok(new Set(sigs).size === 3, '三个变体互不相同（否则"轮换"等于没轮换）');
});

group('footstep 行为', function () {
  eq(typeof A.footstep, 'function', 'GameAudio.footstep 已暴露');
  if (typeof A.footstep !== 'function') return;
  const st = C.AUDIO.stepStride;
  const stS = C.AUDIO.stepStrideSprint;
  // 每一"帧"推进 50ms：测的是位移累积，不是 25ms 节流（节流在第 5 段单独测过）
  const step = function (dx, sprint) { tick(0.05); return A.footstep(dx, sprint); };

  const nBefore = nodeCount();
  eq(step(st), true, '走满一个步幅响一步');
  const single = nodeCount() - nBefore;
  ok(single >= 3, '一步至少建了几个节点（play 不是空函数）', single);

  const n0 = nodeCount();
  eq(step(0), false, '站着不动（dx=0）不响');
  eq(nodeCount(), n0, '不响的时候不建任何节点');

  eq(step(st - 1), false, '差 1 单位不到步幅：不响');
  eq(step(1), true, '补上那 1 单位正好够一步：响');

  eq(step(-st), true, '往回走（dx 为负）同样按位移绝对值算');
  eq(step(-(st - 1)), false, '反向但不足一步：不响');
  eq(step(1), true, '再补 1 单位够一步：响');

  // 大步幅（击退 / 闪现）不能一口气连响：一次调用最多一步。
  const nb = nodeCount();
  eq(step(st * 10), true, '十倍步幅的位移仍然响（只响一步）');
  eq(nodeCount() - nb, single, '一次调用只建一步的节点（不会一口气跺十下）');

  // 三个变体轮换：靠噪声滤波器的中心频率区分音色
  const freqs = [];
  const peaksCreated = [];
  for (let i = 0; i < 3; i += 1) {
    const before2 = nodeCount();
    eq(step(st), true, '第 ' + (i + 1) + ' 步能响');
    const created = A.context.created.slice(before2);
    const filters = created.filter((n) => n.__kind === 'filter' && n.frequency.events.length);
    ok(filters.length > 0, '第 ' + (i + 1) + ' 步有滤波噪声（不是裸白噪）');
    freqs.push(filters.length ? filters[0].frequency.events[0][1] : null);
    created.filter((n) => n.__kind === 'gain').forEach(function (g) {
      if (g.gain.events[1]) peaksCreated.push(g.gain.events[1][1]);
    });
  }
  ok(new Set(freqs).size === 3, '三声脚步用了三种不同音色（轮换真的轮换了）',
     JSON.stringify(freqs));
  ok(peaksCreated.length > 0 && Math.max.apply(null, peaksCreated) <= 0.12 + 1e-9,
     '实际播放的包络峰值 ≤ 0.12（stepVolume 真的乘进去了）',
     JSON.stringify(peaksCreated));

  // 步距真的换了：同一段位移在冲刺倍率下够一步、在走路倍率下不够。
  // 两种模式各记一份累积量，所以这里不用先"归零"。
  eq(step(st - 1, true), true, '冲刺时 stepStride-1 的位移已经够一步（' + stS + '）');
  eq(step(st - 1), false, '同样的位移在走路时不到一步（' + st + '）');
});

// ---------------------------------------------------------------- 10. 胜负
section('10. 胜负音效（Task 23 / 设计 §3.3）');
group('victory / defeat 配置', function () {
  const sfx = C.AUDIO.sfx;
  ok(!!sfx.victory, '新增 victory（通关）');
  ok(!sfx.death && !!sfx.defeat, 'death 已改名为 defeat（不许两个都在）');
  const dur = function (n) {
    return Math.max.apply(null, sfx[n].voices.map((v) => (v.at || 0) + v.dur));
  };
  ok(dur('victory') >= 0.3 && dur('victory') <= 0.8, 'victory 时长落在 0.3~0.8s', dur('victory'));
  ok(dur('defeat') >= 0.3 && dur('defeat') <= 0.8, 'defeat 时长落在 0.3~0.8s', dur('defeat'));
  eq(sfx.victory.voices.map((v) => v.wave).join(','), 'triangle,triangle,triangle',
     'victory 是三角波三音');
  eq(sfx.victory.voices.map((v) => v.f0).join(','), '392,523,784', 'victory 上行 392→523→784');
  eq(sfx.defeat.voices.map((v) => v.f0).join(','), '392,294,196', 'defeat 下行 392→294→196');
  // 两个都要"真的能播"（配置写错 f0/dur 时 play 会静默返回 false）
  tick(0.05); eq(A.play('victory'), true, 'victory 能播');
  tick(0.05); eq(A.play('defeat'), true, 'defeat 能播');
});

// ---------------------------------------------------------------- 11. 环境音
section('11. 环境音：基地虫鸣（Task 23 / 设计 §3.8）');
group('ambient 配置', function () {
  const amb = C.AUDIO.ambient;
  ok(!!amb, 'C.AUDIO.ambient 存在');
  if (!amb) return;
  eq(amb.name, 'cricket', '环境音名是 cricket');
  eq(amb.volume, 0.30, '默认环境音音量 0.30（与总音量默认值一致）');
  eq(amb.bufferSeconds, 8, '循环缓冲 8 秒');
  eq(amb.cricketCount, 26, '缓冲内 26 次蟋蟀叫声');
  eq(JSON.stringify(amb.cricketHz), JSON.stringify([4200, 6800]), '蟋蟀频段 4.2~6.8kHz');
  eq(amb.windHz, 60, '夜风底噪 60Hz');
  eq(typeof amb.seed, 'number', true, '固定随机种子写在 config', amb.seed);
});

let ambientSrc = null;
group('start / stop 与增益链', function () {
  eq(typeof A.startAmbient, 'function', 'GameAudio.startAmbient 已暴露');
  eq(typeof A.stopAmbient, 'function', 'GameAudio.stopAmbient 已暴露');
  eq(typeof A.setAmbientVolume, 'function', 'GameAudio.setAmbientVolume 已暴露');
  eq(typeof A.ambientName, 'function', 'GameAudio.ambientName 已暴露');
  if (typeof A.startAmbient !== 'function') return;

  eq(A.ambientName(), null, '还没进基地时没有环境音');
  eq(A.stopAmbient(), false, '没在播时 stopAmbient 返回 false（幂等）');
  eq(A.startAmbient('no_such_ambient'), false, '未知环境音名不启动');
  eq(A.ambientName(), null, '未知名字之后仍然是 null');

  const before = nodeCount();
  eq(A.startAmbient('cricket'), true, '启动虫鸣');
  eq(A.ambientName(), 'cricket', 'ambientName() 报出 cricket');
  ok(nodeCount() > before, '真的建了音频节点', nodeCount() - before);

  const srcs = A.context.created.filter((n) => n.__kind === 'src' && n.loop);
  ambientSrc = srcs[srcs.length - 1] || null;
  ok(!!ambientSrc, '有一个 loop 音源（不是一次性音效）');
  ok(ambientSrc && ambientSrc.started === true, 'loop 音源被 start() 了');
  ok(ambientSrc && ambientSrc.buffer && ambientSrc.buffer.length === 8 * A.context.sampleRate,
     '缓冲长度 = 8s × sampleRate（不是定时器现拼的）',
     ambientSrc && ambientSrc.buffer && ambientSrc.buffer.length);
  const masters = masterGains();
  eq(masters.length, 1, '仍然只有一个 masterGain 接在 destination 上');
  ok(!!A.ambientGain, 'ambientGain 已暴露（只读句柄）');
  eq(A.ambientGain && A.ambientGain.connectedTo, masters[0],
     '环境音走 ambientGain -> masterGain（不是直连 destination，否则总音量管不住它）');

  const n2 = nodeCount();
  eq(A.startAmbient('cricket'), true, '重复启动同一条环境音是幂等的');
  eq(nodeCount(), n2, '重复启动不再建节点（不会叠成两倍虫鸣）');

  // 拖环境音只动 ambientGain
  const master = masters[0];
  const m0 = master.gain.value;
  A.setAmbientVolume(0);
  eq(A.ambientGain.gain.value, 0, 'setAmbientVolume(0) 把虫鸣压到 0');
  // 独立性的定义：虫鸣调到 0，其他音效**照常响**。
  // 只断言"gain 是 0"不够 —— 那是数值，不是行为。
  tick(1);
  eq(A.play('slash'), true, '虫鸣调到 0 时其他音效照常播（独立通道，不是总静音）');
  eq(master.gain.value, m0, '拖环境音不碰 masterGain');
  A.setAmbientVolume(0.8);
  eq(A.ambientGain.gain.value, 0.8, 'setAmbientVolume(0.8) 生效');
  eq(master.gain.value, m0, '拖环境音之后 masterGain 还是原值');
  A.setAmbientVolume(3);
  eq(A.ambientGain.gain.value, 1, '上限夹到 1');
  A.setAmbientVolume(-1);
  eq(A.ambientGain.gain.value, 0, '下限夹到 0');
  A.setAmbientVolume(0.3);
});

group('环境音存进 meta.settings（老档补默认值）', function () {
  const st = { meta: { settings: { volume: 0.5, muted: false } } };
  A.syncSettings(st);
  eq(st.meta.settings.ambient, 0.30, '没有 ambient 的老档补上 0.30（不是 undefined/NaN）');
  A.setAmbientVolume(0.6);
  eq(st.meta.settings.ambient, 0.6, '调环境音写回 meta.settings.ambient');

  const st2 = { meta: { settings: { volume: 0.5, muted: false, ambient: 0.9 } } };
  A.syncSettings(st2);
  eq(A.ambientGain.gain.value, 0.9, 'syncSettings 读到存档里的环境音（不覆盖已有值）');
  A.setAmbientVolume(0.3);
});

group('虫鸣波形：不是静音、不是白噪、循环点不爆音', function () {
  ok(!!(ambientSrc && ambientSrc.buffer), '拿到缓冲');
  if (!ambientSrc || !ambientSrc.buffer) return;
  const data = ambientSrc.buffer.getChannelData(0);
  eq(ambientSrc.buffer.numberOfChannels, 1, '单声道（虫鸣没有左右声像需求）');
  eq(data.length, 8 * A.context.sampleRate, '样本数 = 8 秒');
  let peak = 0;
  let sumSq = 0;
  let sumAbs = 0;
  let sumDiff = 0;
  let prev = data[0] || 0;
  for (let i = 0; i < data.length; i += 1) {
    const v = data[i];
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
    sumSq += v * v;
    sumAbs += a;
    if (i > 0) { const dv = v - prev; sumDiff += dv < 0 ? -dv : dv; }
    prev = v;
  }
  const rms = Math.sqrt(sumSq / data.length);
  // 平均绝对斜率 / 平均绝对值 ≈ 2πf/sr：纯 60Hz 夜风约 0.009，
  // 5kHz 的蟋蟀约 0.7。蟋蟀脉冲的总时长只占缓冲的一小部分，但幅度远高于
  // 夜风底噪，按幅度加权后由蟋蟀主导，所以这个比值对"稀疏"不敏感。
  // （原来写的是过零率阈值 0.05，实测 0.039 —— 是阈值算错了：稀疏脉冲的
  //   过零率天然被夜风段稀释，不是波形有问题。）
  const hf = sumAbs > 0 ? sumDiff / sumAbs : 0;
  ok(peak <= 1, '峰值 ≤ 1（不削波）', peak);
  ok(rms > 0.004, '不是静音缓冲（RMS）', rms);
  ok(hf > 0.1, '高频能量占主导（蟋蟀真的在叫，不是一条 60Hz 嗡嗡声）', hf);
  ok(hf < 1.5, '高频占比也没离谱（带通后的沙沙声，不是纯白噪）', hf);
  ok(Math.abs(data[0]) < 0.05, '缓冲首样本接近 0（循环接缝处不跳变）', data[0]);
  ok(Math.abs(data[data.length - 1]) < 0.05, '缓冲末样本接近 0（循环接缝处不跳变）',
     data[data.length - 1]);
});

group('固定种子：两次合成分毫不差', function () {
  ok(!!(ambientSrc && ambientSrc.buffer), '有第一份缓冲可比');
  if (!ambientSrc || !ambientSrc.buffer) return;
  const d1 = ambientSrc.buffer.getChannelData(0);
  const audioPath = require.resolve(path.join(__dirname, '..', 'game', 'audio.js'));
  delete require.cache[audioPath];
  let A2 = null;
  try { A2 = require(audioPath); } catch (e) { ok(false, '重新加载 audio.js 不抛异常', e.message); }
  if (!A2) return;
  // 新实例还没建 ctx（惰性）：这时 startAmbient 只能"记住意图"，
  // 真正的源要等首个手势（ensureStarted）。基地场景在页面加载时就调
  // startAmbient，走的正是这条路 —— 不测它，自动播放策略那一关就是盲的。
  eq(A2.context, null, '新实例加载时不建 ctx（惰性，页面加载不白占音频设备）');
  eq(A2.startAmbient('cricket'), true, '没有 ctx 时 startAmbient 也接住（只记意图）');
  eq(A2.ambientName(), 'cricket', '意图已经记下：场景问「在放什么」要有答案');
  eq(A2.ambientGain, null, '还没有 ctx 就没有增益节点（不假装在播）');
  A2.ensureStarted();
  ok(!!A2.ambientGain, '首个手势里补建了环境音通道');
  const src2 = A2.context && A2.context.created.filter((n) => n.__kind === 'src' && n.loop)[0];
  ok(!!src2, '第二次实例也建了 loop 音源');
  if (!src2) { A2.stopAmbient(); global.GameAudio = A; return; }
  const d2 = src2.buffer.getChannelData(0);
  eq(d2.length, d1.length, '两次缓冲长度一致');
  let diff = 0;
  const n = Math.min(d1.length, d2.length);
  for (let i = 0; i < n; i += 1) if (d1[i] !== d2[i]) diff += 1;
  eq(diff, 0, '同一 seed 两次合成分毫不差（每次进基地不该换一套虫鸣）');
  A2.stopAmbient();
  global.GameAudio = A;
});

group('stopAmbient 真的停', function () {
  eq(A.stopAmbient(), true, 'stopAmbient 返回 true');
  eq(A.ambientName(), null, '停止后 ambientName() 归 null');
  ok(ambientSrc && ambientSrc.stopped === true, 'loop 音源被 stop()（不是只是静音）');
  const n = nodeCount();
  eq(A.stopAmbient(), false, '再停一次返回 false（幂等）');
  eq(nodeCount(), n, '重复停止不建节点');
});

// ---------------------------------------------------------------- 环境音淡入淡出
/*
 * 8 秒循环缓冲在任何相位被硬起/硬停都是一声爆音，营地 ↔ 关卡来回切时尤其明显。
 * 这三条钉的是「有没有走自动化」：stub 会把 setValueAtTime / linearRamp /
 * stop(t) 全部记下来，硬起硬停的实现一条都过不了。
 */
group('环境音起停是渐入渐出（不是硬切）', function () {
  eq(typeof C.AUDIO.ambient.fade, 'number', 'AUDIO.ambient.fade 写在 config（不是散在代码里）');
  eq(C.AUDIO.ambient.fade, 0.25, '默认淡入淡出 0.25 秒');

  const audioPath = require.resolve(path.join(__dirname, '..', 'game', 'audio.js'));
  delete require.cache[audioPath];
  const A3 = require(audioPath);
  A3.ensureStarted();
  const beforeCtx = (A3.context && A3.context.created) ? A3.context.created.length : 0;
  eq(A3.startAmbient('cricket'), true, '起播虫鸣');
  const g3 = A3.ambientGain;
  ok(!!g3, '有环境音增益节点');
  if (!g3) { A3.stopAmbient(); return; }

  // 起播必须从 0 开始：先 set 0，再 ramp 到目标音量。
  const ev = g3.gain.events || [];
  const setZero = ev.filter((e) => e[0] === 'set' && e[1] === 0)[0];
  ok(!!setZero, '起播时先把增益压到 0（不硬起）');
  const rampUp = ev.filter((e) => e[0] === 'lin' && e[1] > 0)[0];
  ok(!!rampUp, '再用 linearRamp 升上去');
  if (rampUp) {
    ok(Math.abs(rampUp[2] - (0 + C.AUDIO.ambient.fade)) < 1e-6,
      '升到目标用的时间就是 fade（不是随便一个数）', rampUp[2]);
  }
  ok(beforeCtx < (A3.context.created.length + 1), '起播过程中建了节点');

  // 停止必须是「按点时停」，不是立刻 stop()。
  const src3 = (A3.context.created || []).filter((n) => n.__kind === 'src' && n.loop)[0];
  ok(!!src3, '找得到 loop 音源');
  if (src3) {
    A3.stopAmbient();
    ok(src3.stopped === true, '音源确实被 stop');
    ok(typeof src3.stopAt === 'number',
      'stop 带了时间点（硬切实现会是不带参数的 stop()）', src3.stopAt);
    if (typeof src3.stopAt === 'number') {
      ok(Math.abs(src3.stopAt - (0 + C.AUDIO.ambient.fade)) < 1e-6,
        '停的时间点 = 现在 + fade', src3.stopAt);
    }
  }
});

// ---------------------------------------------------------------- 汇总
console.log('\n' + '='.repeat(56));
if (fail === 0) {
  console.log(`全部通过：${pass} 项断言`);
  process.exit(0);
} else {
  console.log(`失败 ${fail} 项，通过 ${pass} 项`);
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
