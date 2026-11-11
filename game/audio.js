/**
 * audio.js — 自建 AudioContext 音效层（17 个合成音效）。
 *
 * 为什么不借 Phaser 的声音
 * ------------------------
 * boot() 里显式写了 audio: { noAudio: true }。Phaser 于是用 NoAudioSoundManager：
 * play() 恒返回 false、**没有 .context**。那是刻意的（无音频设备的环境里不让
 * Phaser 解码一堆 mp3 再丢掉），但它也意味着音效只能自己 new AudioContext()。
 * 两套系统互不影响，这也是本任务要守的边界。
 *
 * 设计要点
 * --------
 * 1. **惰性单例**：模块加载时不碰 AudioContext（Node 测试里根本没有 WebAudio）。
 *    第一次播放或第一次用户手势才创建；全游戏只有一个 ctx、一个 masterGain。
 * 2. **数据驱动**：17 个音效的参数全在 config.js 的 AUDIO.sfx 里，每个音效是
 *    若干"声部"（振荡器/噪声 + 包络 + 滤波 + 可选振幅调制）。这里没有
 *    "if (name === 'slash')" 这种分支，调音只改数据。
 * 3. **用完即弃**：每个声部建节点、start/stop、交给 GC；不预建常驻音轨。
 * 4. **25ms 节流**：同一音效 25ms 内重复触发只响一次。连段攻击同帧可能触发
 *    三次 slash，不合并就是爆音。节流按名字分开，不互相压。
 * 5. **静音 = masterGain.gain = 0**：不许 ctx.close()。关掉之后当前页面
 *    再也开不回来（必须先刷新），而且会打断正在排队的自动化事件。
 * 6. **自动播放策略**：浏览器要求音频在用户手势里启动。这里自己挂一次性
 *    pointerdown / keydown / touchstart 监听，首个手势里 resume()。
 *    不改 index.html 的内联脚本 —— 音效层不该要求页面配合。
 *
 * 暴露 global.GameAudio：
 *   play(name)            播一个音效，返回是否真的播了（未知名/节流返回 false）
 *   ensureStarted()       手动启动（首次手势里自动调用；测试也可直接调）
 *   setMasterVolume(v)    0..1，夹住越界值；会写回 meta.settings.volume
 *   setMuted(bool)        静音开关；写回 meta.settings.muted
 *   isMuted()
 *   syncSettings(state)   读 state.meta.settings（旧存档缺字段时补默认值）
 *   context               当前的 AudioContext（惰性创建，可能为 null）
 *   sfxNames              17 个音效名（给调试面板/测试用）
 */
(function (global) {
  'use strict';

  // 浏览器里 config.js 先于本文件加载；Node 测试里用 require。
  const C = global.GameConfig ||
    (typeof require === 'function' ? require('./config.js') : null);

  const clamp01 = function (v) {
    const n = Number(v);
    if (!isFinite(n)) return 0;
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
  };

  if (!C || !C.AUDIO || !C.AUDIO.sfx) {
    // 配置缺失时给一个安全的空实现：游戏照常跑，只是没声音。
    // 抛异常会让整个 app.js 的求值失败，那已经不是"没声音"而是"游戏打不开"。
    const noop = function () { return false; };
    global.GameAudio = {
      play: noop, ensureStarted: function () { return null; }, setMasterVolume: noop,
      setMuted: noop, isMuted: function () { return false; }, syncSettings: function () { return null; },
      context: null, sfxNames: [],
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = global.GameAudio;
    return;
  }

  const CFG = C.AUDIO;
  const NAMES = Object.keys(CFG.sfx);

  let ctx = null;             // AudioContext，惰性
  let master = null;          // 唯一的 masterGain，接在 destination 上
  let noiseBuf = null;        // 白噪声缓冲（1 秒，所有噪声声部共用）
  let volume = clamp01(CFG.volume == null ? 0.3 : CFG.volume);
  let muted = false;
  let started = false;        // 是否已经在手势里 resume 过
  let boundSettings = null;   // 正在使用的 meta.settings（音量/静音写回这里）
  const lastPlayed = Object.create(null);   // 音效名 -> 上次播放的 ctx.currentTime

  // ---------------------------------------------------------------- 底层

  function ensureContext() {
    if (ctx) return ctx;
    const Ctor = global.AudioContext || global.webkitAudioContext;
    if (typeof Ctor !== 'function') return null;   // 无 WebAudio 的环境：静默降级
    try {
      ctx = new Ctor();
    } catch (e) {
      ctx = null;
      return null;
    }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(ctx.destination);
    // ctx 被系统回收（切后台/音频设备变更）时，masterGain 也跟着作废，
    // 下一次 play 会重建一个干净的 —— 不能让一个死 ctx 永久挡住发声。
    if (typeof ctx.addEventListener === 'function') {
      try {
        ctx.addEventListener('statechange', function () {
          if (ctx && ctx.state === 'closed') { ctx = null; master = null; noiseBuf = null; started = false; }
        });
      } catch (e) { /* 老浏览器没有 statechange，忽略 */ }
    }
    return ctx;
  }

  function noiseBuffer() {
    if (noiseBuf) return noiseBuf;
    const len = Math.max(1, Math.floor((ctx.sampleRate || 44100) * 1.0));
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate || 44100);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  /**
   * 建一个声部。t0 是起奏时刻（ctx.currentTime 或它的将来）。
   *
   * 信号链：source -> [biquadFilter] -> gain(包络) -> master
   *         （可选 LFO -> gain -> gain.gain 做振幅调制）
   */
  function buildVoice(v, t0) {
    const start = t0 + (v.at || 0);
    const dur = Math.max(0.01, v.dur || 0.1);
    const peak = Math.max(0.0001, Math.min(1, v.gain == null ? 0.2 : v.gain));
    const attack = Math.min(v.attack != null ? v.attack : 0.004, dur * 0.5);

    const g = ctx.createGain();
    // 指数包络不能到 0（exponentialRamp 的终点必须是正数），用 1e-4 近似静音。
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(peak, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    g.connect(master);

    let src;
    if (v.wave === 'noise') {
      src = ctx.createBufferSource();
      src.buffer = noiseBuffer();
    } else {
      src = ctx.createOscillator();
      src.type = v.wave || 'sine';
      const f0 = v.f0 || 440;
      src.frequency.setValueAtTime(f0, start);
      if (typeof v.f1 === 'number' && v.f1 > 0 && v.f1 !== f0) {
        src.frequency.exponentialRampToValueAtTime(v.f1, start + dur);
      }
      if (v.detune) src.detune.setValueAtTime(v.detune, start);
    }

    if (v.filter) {
      const f = ctx.createBiquadFilter();
      f.type = v.filter.type || 'lowpass';
      f.Q.setValueAtTime(v.filter.q == null ? 1 : v.filter.q, start);
      const ff0 = v.filter.f0 || 1000;
      f.frequency.setValueAtTime(ff0, start);
      if (typeof v.filter.f1 === 'number' && v.filter.f1 > 0 && v.filter.f1 !== ff0) {
        f.frequency.exponentialRampToValueAtTime(v.filter.f1, start + dur);
      }
      src.connect(f);
      f.connect(g);
    } else {
      src.connect(g);
    }

    if (v.am && v.am.rate > 0) {
      const depth = Math.max(0, Math.min(1, v.am.depth == null ? 0.7 : v.am.depth));
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(v.am.rate, start);
      const lg = ctx.createGain();
      // AM：基准值留出 (1 - depth/2)，LFO 在其上摆动 ±depth/2。
      lg.gain.setValueAtTime(peak * depth * 0.5, start);
      lfo.connect(lg);
      lg.connect(g.gain);
      lfo.start(start);
      lfo.stop(start + dur + 0.02);
    }

    src.start(start);
    src.stop(start + dur + 0.02);   // 提前一点点收尾，避免包络尾音挂住音轨
  }

  // ---------------------------------------------------------------- 播放

  function play(name) {
    const sfx = CFG.sfx[name];
    if (!sfx || !sfx.voices || !sfx.voices.length) return false;
    const c = ensureContext();
    if (!c) return false;

    const now = typeof c.currentTime === 'number' ? c.currentTime : 0;
    const last = lastPlayed[name];
    // 节流只在 ctx 真的在跑时生效。suspended 状态下 currentTime 是冻结的，
    // 如果照样节流，第一次播放之后这个音效会被永久锁死（表现为"开局一声之后全哑"）。
    if (c.state === 'running' && last !== undefined && now - last < CFG.throttle) return false;
    lastPlayed[name] = now;

    for (let i = 0; i < sfx.voices.length; i += 1) buildVoice(sfx.voices[i], now);
    return true;
  }

  // ---------------------------------------------------------------- 音量

  function applyGain() {
    if (!ctx || !master) return;
    const target = muted ? 0 : volume;
    const now = typeof ctx.currentTime === 'number' ? ctx.currentTime : 0;
    const g = master.gain;
    try {
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(target, now + 0.02);   // 20ms 渐变，切换时不"咔"
    } catch (e) {
      g.value = target;   // 极老的实现没有自动化 API：直接赋值
    }
  }

  function setMasterVolume(v) {
    volume = clamp01(v);
    if (boundSettings) boundSettings.volume = volume;
    applyGain();
    return volume;
  }

  function setMuted(flag) {
    muted = !!flag;
    if (boundSettings) boundSettings.muted = muted;
    applyGain();
    return muted;
  }

  /**
   * 把存档里的音量/静音接到音效层。旧存档（没有 settings 字段）补默认值，
   * 而不是崩在 undefined.volume 上。
   */
  function syncSettings(state) {
    const meta = state && state.meta;
    if (!meta || typeof meta !== 'object') return null;
    if (!meta.settings || typeof meta.settings !== 'object') meta.settings = {};
    const s = meta.settings;
    if (typeof s.volume !== 'number' || !isFinite(s.volume)) s.volume = clamp01(CFG.volume);
    s.muted = !!s.muted;
    boundSettings = s;
    volume = clamp01(s.volume);
    muted = s.muted;
    applyGain();
    return s;
  }

  // ---------------------------------------------------------------- 启动

  /**
   * 首次用户手势里调用：创建 ctx（如果还没有）并 resume()。
   * 浏览器只允许在手势里启动音频，所以这一步一定发生在 click/keydown 内。
   */
  function ensureStarted() {
    const c = ensureContext();
    if (!c) return null;
    if (!started) {
      started = true;
      try {
        const p = c.resume();
        // resume() 返回 Promise；失败（比如没有音频设备）不该变成未处理拒绝。
        if (p && typeof p.catch === 'function') p.catch(function () {});
      } catch (e) { /* 有的实现 resume 是同步的 */ }
    }
    return c;
  }

  function bindGesture() {
    if (!global || typeof global.addEventListener !== 'function') return;
    const onGesture = function () { ensureStarted(); };
    const types = ['pointerdown', 'keydown', 'touchstart'];
    for (let i = 0; i < types.length; i += 1) {
      try {
        global.addEventListener(types[i], onGesture, { passive: true });
      } catch (e) {
        try { global.addEventListener(types[i], onGesture); } catch (e2) { /* 忽略 */ }
      }
    }
  }

  const API = {
    play: play,
    ensureStarted: ensureStarted,
    setMasterVolume: setMasterVolume,
    setMuted: setMuted,
    isMuted: function () { return muted; },
    syncSettings: syncSettings,
    sfxNames: NAMES,
  };

  // context 用 getter：ctx 是惰性创建、也可能被重建，静态字段会拿到 null 或旧对象。
  Object.defineProperty(API, 'context', {
    enumerable: true,
    get: function () { return ctx; },
  });

  /*
   * masterGain 也暴露出来（只读）。
   *
   * 理由：静音的正确实现是"总增益归零"，不是关闭 AudioContext。
   * 这件事只有拿到 masterGain 才能在外面证明 —— 否则浏览器侧只能相信
   * setMasterVolume 的返回值，而"返回了 true"和"增益真的是 0"是两回事。
   * 暴露的是节点本身，不是可变的状态，外面能读 gain.value 也能顺手改，
   * 但正常的调节入口仍然是 setMasterVolume。
   */
  Object.defineProperty(API, 'masterGain', {
    enumerable: true,
    get: function () { return master; },
  });

  bindGesture();

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.GameAudio = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
