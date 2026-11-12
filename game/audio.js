/**
 * audio.js — 自建 AudioContext 音效层（21 个合成音效 + 一条环境音通道）。
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
 * 2. **数据驱动**：21 个音效的参数全在 config.js 的 AUDIO.sfx 里，每个音效是
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
 * 7. **脚步（Task 23）**：按位移累积触发，不按时间。走满 stepStride 个世界单位
 *    响一步，冲刺时步距更短。一次调用最多响一步 —— 击退/闪现那种一次位移
 *    好几百像素的情况不能一口气"跺"十下。
 * 8. **环境音（Task 23）**：营地虫鸣是一条独立通道 ambientGain -> masterGain，
 *    只受"环境音"滑块控制。8 秒循环缓冲是**离屏手算 PCM**（固定种子），
 *    不是 OfflineAudioContext、也不是定时器逐声调度：
 *    - 定时器版本会在 stopAmbient 之后继续响（Node 里表现为进程不退），
 *      这是本项目踩过的坑；
 *    - 离屏渲染是异步的，HubScene 建/关的时序会跟它抢；
 *    - 手算 PCM 是同步、确定、可单测的，而且循环接缝由整数周期保证。
 *
 * 暴露 global.GameAudio：
 *   play(name, gainScale) 播一个音效，返回是否真的播了（未知名/节流返回 false）
 *                         gainScale 可选，乘在峰值上（脚步靠它压到 0.12）
 *   footstep(dx, sprint)  按位移累积触发脚步；返回这一次是否真的响了
 *   ensureStarted()       手动启动（首次手势里自动调用；测试也可直接调）
 *   setMasterVolume(v)    0..1，夹住越界值；会写回 meta.settings.volume
 *   setMuted(bool)        静音开关；写回 meta.settings.muted
 *   isMuted()
 *   syncSettings(state)   读 state.meta.settings（旧存档缺字段时补默认值）
 *   startAmbient(name)    启动环境音（默认 config 里的 cricket）
 *   stopAmbient()         停止环境音（没在播时返回 false）
 *   setAmbientVolume(v)   环境音通道音量，写回 meta.settings.ambient
 *   ambientName()         当前环境音名，没有则 null
 *   context               当前的 AudioContext（惰性创建，可能为 null）
 *   masterGain / ambientGain   两条增益链的句柄（只读，给测试与调试面板）
 *   sfxNames              21 个音效名（给调试面板/测试用）
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
      play: noop, footstep: noop, ensureStarted: function () { return null; },
      setMasterVolume: noop, setMuted: noop, isMuted: function () { return false; },
      syncSettings: function () { return null; },
      startAmbient: noop, stopAmbient: noop, setAmbientVolume: noop,
      ambientName: function () { return null; },
      context: null, masterGain: null, ambientGain: null, sfxNames: [],
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

  // ---- 环境音（Task 23）----
  // ambientWanted = "场景要求播哪条"（HubScene 一进基地就要求 crickets）；
  // ambientPlaying = "真的已经在播哪条"。两者分开是因为自动播放策略：
  // 页面加载时还没有 AudioContext，这时只能记下意图，等首次手势再起播。
  let ambientGainNode = null;
  let ambientSrc = null;
  let ambientBuf = null;
  let ambientWanted = null;
  let ambientPlaying = null;
  let ambientVolume = clamp01((CFG.ambient && CFG.ambient.volume != null)
    ? CFG.ambient.volume : 0.3);

  // ---- 脚步（Task 23）----
  // 走路与冲刺各记一份累积量：中途换步态不会继承对方剩下的零头，
  // 否则"走两步按一下 Shift"会立刻多出一声，听起来像绊了一跤。
  const stepAccum = { walk: 0, sprint: 0 };
  const STEP_NAMES = ['step1', 'step2', 'step3'];
  let stepIndex = 0;

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
          if (ctx && ctx.state === 'closed') {
            ctx = null; master = null; noiseBuf = null; started = false;
            // 环境音的节点都挂在死 ctx 上，一起作废；名字留在 ambientWanted 里，
            // 下一次 ensureStarted() 会用新 ctx 重建。
            ambientGainNode = null; ambientSrc = null; ambientBuf = null;
            ambientPlaying = null;
          }
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
  function buildVoice(v, t0, scale) {
    const start = t0 + (v.at || 0);
    const dur = Math.max(0.01, v.dur || 0.1);
    const k = (typeof scale === 'number' && isFinite(scale) && scale > 0) ? Math.min(1, scale) : 1;
    const peak = Math.max(0.0001, Math.min(1, (v.gain == null ? 0.2 : v.gain) * k));
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

  /**
   * 播一个音效。
   *
   * gainScale 是"这一次的峰值缩放"，乘在配置的 gain 上（0..1，越界夹住）。
   * 存在的理由：脚步的三个变体是相对音量（合计约 1.0），真正的响度由
   * AUDIO.stepVolume 在**播放时**决定，这样调脚步音量只改 config 一处。
   * 不传就是 1，原有的 17 个音效行为完全不变。
   */
  function play(name, gainScale) {
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

    for (let i = 0; i < sfx.voices.length; i += 1) buildVoice(sfx.voices[i], now, gainScale);
    return true;
  }

  // ---------------------------------------------------------------- 脚步

  /**
   * 按位移累积触发脚步（设计 §3.2）。
   *
   *   stepAccum += moved; if (stepAccum >= stepStride) { play('footstep'); stepAccum -= stepStride; }
   *
   * 为什么不用定时器：定时器在"站着不动"时也会继续响。玩家站在原地想事情，
   * 脚下却一直"嗒、嗒"，那不是脚步，那是钟摆。位移驱动天然满足两条：
   * 不动就没声；冲刺位移更快，同样时间里步数更多。
   *
   * dx 是这一帧的位移（世界单位，带符号；内部取绝对值）。
   * sprint 为真时用更短的步距（跑起来脚步更密）。
   *
   * 一次调用最多响一步：一次位移两百多个单位（击退/闪现）不该"跺"十下。
   * 多余的位移折成余数（acc %= stride），既满足"最多一步"，
   * 又不会把余量清零 —— 下一帧只要再走一点就接着响。
   *
   * @returns {boolean} 这一次调用是否真的响了一步
   */
  function footstep(dx, sprint) {
    const moved = Math.abs(Number(dx) || 0);
    if (!(moved > 0)) return false;
    // 步幅只认 config：配置缺失就干脆不响，而不是在代码里编一个默认值
    // （那样调的就不是同一个旋钮了，玩家会遇到"改了 config 没反应"）。
    const size = CFG.stepStride;
    if (!(size > 0)) return false;
    const sprintSize = (CFG.stepStrideSprint > 0 && CFG.stepStrideSprint < size)
      ? CFG.stepStrideSprint : size;
    const mode = sprint ? 'sprint' : 'walk';
    const stride = sprint ? sprintSize : size;
    stepAccum[mode] += moved;
    if (stepAccum[mode] < stride) return false;
    stepAccum[mode] %= stride;
    const name = STEP_NAMES[stepIndex % STEP_NAMES.length];
    stepIndex += 1;
    // 走 API.play 而不是内部的 play：真浏览器冒烟测试把 GA.play 包了一层
    // 用来数"游戏里真的响了哪些音效"，脚步也必须经过同一个入口。
    return API.play(name, CFG.stepVolume);
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
    // 环境音是 Task 23 才有的字段：旧存档（v6，settings 里没有 ambient）
    // 必须补默认值，否则滑块会画成 NaN/0。这里只管"读不出来就补"，
    // 已经存过的值一律尊重玩家。
    if (typeof s.ambient !== 'number' || !isFinite(s.ambient)) {
      s.ambient = clamp01(CFG.ambient && CFG.ambient.volume != null ? CFG.ambient.volume : 0.3);
    }
    s.muted = !!s.muted;
    boundSettings = s;
    volume = clamp01(s.volume);
    muted = s.muted;
    ambientVolume = clamp01(s.ambient);
    applyGain();
    applyAmbientGain();
    return s;
  }

  // ---------------------------------------------------------------- 环境音

  /**
   * mulberry32：32 位确定性伪随机（同一 seed 每次得到同一套虫鸣）。
   * 用固定种子而不是 Math.random，是为了"每次进营地听到的是同一段虫鸣" ——
   * 换样本会让玩家以为换了个地方，而且没法写"两次合成分毫不差"的测试。
   */
  // 合成常数（不是可调旋钮：改这些是改"音色本身"，不是改"玩家能听出的响度"）。
  // 玩家可达的两个音量在 config 里：AUDIO.ambient.volume 与 AUDIO.stepVolume。
  const AMBIENT_PEAK = 0.45;   // 归一化后的缓冲峰值：留 6dB 余量，不削波
  const WIND_LEVEL = 0.012;    // 夜风底噪幅度：约 -38dBFS，只提供"在场感"

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * 往缓冲里叠一声蟋蟀脉冲。
   *
   * 一个脉冲 = 窄带噪声（RBJ 带通，Q=6，中心频率随虫而异）+ 同频纯音，
   * 包络是 sin² 半周：起落都在 0，所以不会有"咔哒"的脉冲边界。
   */
  function addCricketPulse(data, sr, t0, dur, freq, amp, rnd) {
    const start = Math.floor(t0 * sr);
    const n = Math.max(8, Math.floor(dur * sr));
    const w0 = (2 * Math.PI * freq) / sr;
    const q = 6;
    const alpha = Math.sin(w0) / (2 * q);
    const a0 = 1 + alpha;
    const b0 = alpha;
    const b2 = -alpha;
    const a1 = -2 * Math.cos(w0);
    const a2 = 1 - alpha;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < n; i += 1) {
      const idx = start + i;
      if (idx >= data.length) break;
      if (idx < 0) continue;
      const t = i / n;
      const env = Math.sin(Math.PI * t);
      const x = rnd() * 2 - 1;
      const y = (b0 * x + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = x;
      y2 = y1; y1 = y;
      // 0.7 的纯音给"吱"一个音高，2.2 的带通噪声给虫翅的沙感
      data[idx] += amp * env * env * (0.7 * Math.sin(w0 * idx) + 2.2 * y);
    }
  }

  /**
   * 生成 8 秒虫鸣循环缓冲（手算 PCM，同步、确定性）。
   *
   * 组成（设计 §3.8）：
   *   - cricketCount 次蟋蟀叫声，时间点在 [0.05, seconds-0.3] 的抖动网格上，
   *     每次 2~4 个脉冲，中心频率在 cricketHz 区间内随机（每只虫音高不同）；
   *   - windHz 的夜风底噪，铺满整段，做极慢的"呼吸"起伏。
   *
   * 循环接缝：风的周期数取整（8 秒 = 480 个 60Hz 周期），所以缓冲首尾相位
   * 严格接上；蟋蟀的叫声全部落在缓冲内部，不跨边界。这样 loop=true 时
   * 接缝处没有"咔"的一声，也不需要交叉淡化。
   */
  function buildAmbientBuffer(c) {
    const cfg = CFG.ambient || {};
    const sr = Math.max(8000, Math.floor(c.sampleRate || 44100));
    const seconds = Math.max(1, Number(cfg.bufferSeconds) || 8);
    const len = Math.max(1, Math.round(sr * seconds));
    const buf = c.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    const rnd = mulberry32(Number(cfg.seed) || 1);
    const hz = cfg.cricketHz || [4200, 6800];
    const lo = Math.min(hz[0], hz[1]);
    const hi = Math.max(hz[0], hz[1]);

    // 1) 夜风底噪：整数个周期 + 3 次慢呼吸
    const windCycles = Math.max(1, Math.round((Number(cfg.windHz) || 60) * seconds));
    const wStep = (2 * Math.PI * windCycles) / len;
    for (let i = 0; i < len; i += 1) {
      const breathe = 0.7 + 0.3 * Math.sin((2 * Math.PI * 3 * i) / len);
      data[i] = WIND_LEVEL * breathe * Math.sin(wStep * i);
    }

    // 2) 蟋蟀叫声：抖动网格铺开，避免听出"每 0.3 秒一下"的机械感
    const count = Math.max(1, Math.round(Number(cfg.cricketCount) || 26));
    const slot = (seconds - 0.35) / count;
    for (let k = 0; k < count; k += 1) {
      const at = 0.05 + slot * (k + 0.15 + 0.7 * rnd());
      const freq = lo + (hi - lo) * rnd();
      const pulses = 2 + Math.floor(rnd() * 3);
      const pulseDur = 0.012 + 0.008 * rnd();
      const gap = 0.016 + 0.014 * rnd();
      const amp = 0.35 + 0.5 * rnd();
      let t = at;
      for (let pi = 0; pi < pulses; pi += 1) {
        addCricketPulse(data, sr, t, pulseDur, freq, amp, rnd);
        t += pulseDur + gap;
      }
    }

    // 3) 归一化到 0.45 峰值：不削波，三次合成响度一致
    let peak = 0;
    for (let i = 0; i < len; i += 1) {
      const a = data[i] < 0 ? -data[i] : data[i];
      if (a > peak) peak = a;
    }
    if (peak > 0 && peak > AMBIENT_PEAK) {
      const nrm = AMBIENT_PEAK / peak;
      for (let i = 0; i < len; i += 1) data[i] *= nrm;
    }
    return buf;
  }

  function ensureAmbientGain() {
    if (!ctx) return null;
    if (ambientGainNode) return ambientGainNode;
    ambientGainNode = ctx.createGain();
    const now = typeof ctx.currentTime === 'number' ? ctx.currentTime : 0;
    try {
      ambientGainNode.gain.setValueAtTime(ambientVolume, now);
    } catch (e) {
      ambientGainNode.gain.value = ambientVolume;
    }
    // 链：source -> ambientGain -> master -> destination
    // 环境音跟着总音量走，但不经过"音乐"滑块（那条没有声源）。
    ambientGainNode.connect(master);
    return ambientGainNode;
  }

  function applyAmbientGain() {
    if (!ambientGainNode || !ctx) return;
    const now = typeof ctx.currentTime === 'number' ? ctx.currentTime : 0;
    const g = ambientGainNode.gain;
    try {
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(ambientVolume, now + 0.02);   // 20ms，拖动滑块不"咔"
    } catch (e) {
      g.value = ambientVolume;
    }
  }

  /** 真的建源并起播（要求 ctx 存在）。已经在播就返回 true，不重复建。 */
  function startAmbientSource() {
    if (ambientPlaying) return true;
    if (!ambientWanted || !ctx) return false;
    const g = ensureAmbientGain();
    if (!g) return false;
    if (!ambientBuf) ambientBuf = buildAmbientBuffer(ctx);
    const src = ctx.createBufferSource();
    src.buffer = ambientBuf;
    src.loop = true;
    src.connect(g);
    const now = typeof ctx.currentTime === 'number' ? ctx.currentTime : 0;
    try {
      src.start(now);
    } catch (e) {
      return false;
    }
    ambientSrc = src;
    ambientPlaying = ambientWanted;
    return true;
  }

  /**
   * 启动环境音。
   *
   * 自动播放策略下页面加载时还没有 AudioContext，这时**只记下意图**并返回
   * true（场景层不需要知道音频还没就绪），真正的源在首次手势的
   * ensureStarted() 里创建。这样 HubScene.create 可以直接调，不用等手势。
   */
  function startAmbient(name) {
    const cfg = CFG.ambient;
    if (!cfg || !cfg.name) return false;
    const want = name == null ? cfg.name : String(name);
    if (want !== cfg.name) return false;      // 目前只有一条虫鸣，未知名字直接拒绝
    if (ambientPlaying === want) return true; // 幂等：重复调用不再叠一条
    ambientWanted = want;
    if (!ctx) return true;
    return startAmbientSource();
  }

  function stopAmbient() {
    if (!ambientPlaying && !ambientWanted) return false;
    ambientWanted = null;
    const src = ambientSrc;
    ambientSrc = null;
    ambientPlaying = null;
    if (src && typeof src.stop === 'function') {
      try { src.stop(); } catch (e) { /* 已经停过就算了 */ }
    }
    return true;
  }

  function setAmbientVolume(v) {
    ambientVolume = clamp01(v);
    if (boundSettings) boundSettings.ambient = ambientVolume;
    applyAmbientGain();
    return ambientVolume;
  }

  function ambientName() {
    return ambientPlaying || ambientWanted;
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
    // 加载期就要求了环境音（HubScene.create）但没有 ctx：现在补上。
    if (ambientWanted) startAmbientSource();
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
    footstep: footstep,
    ensureStarted: ensureStarted,
    setMasterVolume: setMasterVolume,
    setMuted: setMuted,
    isMuted: function () { return muted; },
    syncSettings: syncSettings,
    startAmbient: startAmbient,
    stopAmbient: stopAmbient,
    setAmbientVolume: setAmbientVolume,
    ambientName: ambientName,
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

  /*
   * ambientGain 同理（只读句柄）。
   *
   * 「环境音滑块只动虫鸣、不动总音量」（V21）这件事，只有当外面能同时读到
   * 两条增益时才证得了。否则"没碰 masterGain"只是一句自我声明。
   */
  Object.defineProperty(API, 'ambientGain', {
    enumerable: true,
    get: function () { return ambientGainNode; },
  });

  bindGesture();

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.GameAudio = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
