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

  /** 清空缓存（引擎重建 / 测试之间互不污染）。 */
  function clear() {
    cache.clear();
  }

  const API = { url: url, equipUrl: equipUrl, clear: clear };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.SpriteLib = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
