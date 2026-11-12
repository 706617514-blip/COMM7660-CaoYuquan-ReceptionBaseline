/**
 * sprites.js — 贴图键 → <img> 可用的 dataURL（背包浮层与设施面板共用）
 *
 * 为什么单独一个文件
 * ----------------
 * 这套转换最初只写在 baghud.js 里（Task 8）。到了 Task 17，设施面板也要在
 * 每一行前面贴图（铁匠铺三个强化项的图标、兵器架 35 件装备的贴图），
 * 于是同一段"从 Phaser 纹理里抠出 dataURL"的代码需要第二个消费者。
 *
 * 复制一份的代价不是多几行字，而是**两份缓存**：背包面板缓存过的键，
 * 设施面板还得再转一次，而 toDataURL 是同步的、按 40×60 的离屏 canvas 逐张
 * 编码 —— 兵器架切页签时一屏 35 行，重复转换会把主线程按在那里。
 * 所以转换与缓存都收在这里，其他模块只问"这个键的 dataURL 是什么"。
 *
 * 为什么要缓存
 * ----------
 * generateTexture 产出的是一张**离屏 canvas**，它没有 src 属性，
 * 直接塞给 <img> 是空图；唯一的桥是 toDataURL('image/png')，而 PNG 编码
 * 不做缓存就会在每次 refreshPanel 时对 35 行各做一次。缓存键就是贴图键本身
 * —— 贴图烘好之后内容不再变，所以不存在"缓存过期"的问题；唯一需要作废缓存的
 * 场合是引擎重建（换档案、重启游戏），那种场合整页都重新加载了，缓存自然清空。
 *
 * 取不到就返回 null，不抛
 * ----------------------
 * 调用点在 DOM 渲染的中间：贴图还没烘好、键打错了、或者这个文件被单独加载
 * （Node 单测里没有 Phaser）都会走到这里。抛异常会把整个面板炸掉 ——
 * 玩家看到的是"点了设施没反应"，比"这一行少了张图"糟得多。
 */
(function (global) {
  'use strict';

  /**
   * 贴图键 → dataURL 的缓存。
   *
   * 键是函数作用域内的，没有挂在 global 上：这是本模块唯一的内部状态，
   * 外面只能通过 clear() 重置，不能往里塞东西。
   */
  const cache = new Map();

  /**
   * 紧裁切结果的缓存（Task 18）。键是"贴图键@盒宽x盒高"：同一张贴图放进不同
   * 大小的盒子，放大倍数不同，位图也不同，所以盒子尺寸必须进键。和上面那个
   * cache 分开存 —— 两者是不同的位图，不能互相命中。
   */
  const fitCache = new Map();

  /**
   * 贴图键 → dataURL；取不到返回 null。
   *
   * 为什么是懒取 global.__game：本文件在 app.js 之前求值（index.html 的脚本
   * 顺序），那时候游戏实例还不存在。
   */
  function url(key) {
    if (!key) return null;
    if (cache.has(key)) return cache.get(key);
    let out = null;
    try {
      const game = global.__game;
      const tex = game && game.textures && game.textures.get(key);
      const img = tex && tex.source && tex.source[0] && tex.source[0].image;
      if (img && typeof img.toDataURL === 'function') {
        out = img.toDataURL('image/png');
      }
    } catch (e) {
      out = null;   // 贴图还没烘好 / 键不存在：调用方退化成不贴图，不抛
    }
    // 只缓存成功的结果：失败往往是因为"引擎还没起来"，
    // 把 null 缓存下来会让第一次打开面板的那一屏永久空白。
    if (out) cache.set(key, out);
    return out;
  }

  /** 装备贴图键：与 app.js 烘焙装备贴图时的命名保持同一套规则。 */
  function equipUrl(slot, id) {
    if (!slot || !id) return null;
    return url('eq-' + slot + '-' + id);
  }

  /* ------------------------------------------------------------------ *
   * 紧裁切 + 整数倍放大（Task 18）
   * ------------------------------------------------------------------ *
   *
   * 为什么不能直接把 url() 塞进小盒子
   * --------------------------------
   * 装备贴图是一整块 40×60 的"整身画布"，每一件都画在这块画布的对应位置上：
   * 头部装备只占十来像素高的一条横带，脚下那双鞋只占底下一窄条。把它们塞进
   * 28×42 的盒子里 object-fit:contain，得到的是 0.7 倍缩小 —— 画面上看，
   * 头部装备就是一条颜色带（Task 17 报告 §4 记下的问题）。
   *
   * 这里做的事：按 alpha 通道量出"内容到底在哪一块"，只把那一块抠出来，
   * 再乘以**整数倍**放大。整数倍 + imageSmoothingEnabled=false 保证放大后
   * 还是原来那些像素方块，不会糊成一片。
   */

  const ALPHA_MIN = 8;   // 低于这个 alpha 当背景：抗锯齿边缘算不上内容

  /**
   * 内容包围盒；量不出来返回 null。
   *
   * 量不出来有两种：拿不到 2D context（Node 桩、被裁掉的构建）、或者
   * getImageData 抛（跨域污染的画布 —— generateTexture 产出的不会，但
   * 别处塞进来的 Image 会）。
   */
  function contentBox(img) {
    const w = img.width, h = img.height;
    const doc = global.document;
    if (!doc || typeof doc.createElement !== 'function') return null;
    const cv = doc.createElement('canvas');
    if (!cv || typeof cv.getContext !== 'function') return null;
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    if (!ctx) return null;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > ALPHA_MIN) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    // 一个像素都不亮：宁可退回整图（至少还是原来那张），也不要交一张空白出去。
    if (x1 < 0) return { x: 0, y: 0, w: w, h: h };
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  /** 真正干活的那一段；任何异常都由 fitUrl 收成 null。 */
  function buildFit(key, boxW, boxH) {
    const bw = Math.round(boxW), bh = Math.round(boxH);
    if (!bw || !bh || bw < 1 || bh < 1) return null;
    const game = global.__game;
    const tex = game && game.textures && game.textures.get(key);
    const img = tex && tex.source && tex.source[0] && tex.source[0].image;
    if (!img || !img.width || !img.height) return null;
    const box = contentBox(img);
    if (!box) return null;
    // 盒子按 CSS 写，屏幕是 @2x：内容放大到"CSS 尺寸的两倍"就够 1:1 了。
    // 取 floor 保证是整数倍（半倍会插出灰边，像素图就糊了）；至少 1 倍，
    // 因为把内容缩小回去等于白裁。
    const scale = Math.max(1, Math.floor(Math.min(bw * 2 / box.w, bh * 2 / box.h)));
    const outW = box.w * scale, outH = box.h * scale;
    const doc = global.document;
    if (!doc || typeof doc.createElement !== 'function') return null;
    const out = doc.createElement('canvas');
    if (!out || typeof out.getContext !== 'function') return null;
    out.width = outW; out.height = outH;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, outW, outH);
    ctx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, outW, outH);
    return out.toDataURL('image/png');
  }

  /**
   * 紧裁切 + 整数倍放大后的 dataURL；取不到返回 null。
   *
   * 缓存键要带上盒子尺寸：同一张贴图放进不同大小的盒子，倍数不同，位图也不同。
   * 和 url() 的 cache 分开存，两者互不覆盖。
   */
  function fitUrl(key, boxW, boxH) {
    if (!key || !boxW || !boxH) return null;
    const ck = key + '@' + boxW + 'x' + boxH;
    if (fitCache.has(ck)) return fitCache.get(ck);
    let out = null;
    try {
      out = buildFit(key, boxW, boxH);
    } catch (e) {
      out = null;   // 像素读不到 / 画布被污染：调用方退回 url()，不抛
    }
    if (out) fitCache.set(ck, out);
    return out;
  }

  /** 清空缓存（引擎重建 / 测试之间互不污染）。 */
  function clear() {
    cache.clear();
    fitCache.clear();
  }

  const API = { url: url, equipUrl: equipUrl, fitUrl: fitUrl, clear: clear };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.SpriteLib = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
