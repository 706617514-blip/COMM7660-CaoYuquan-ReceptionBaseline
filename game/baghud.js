/**
 * baghud.js — 背包 DOM 浮层（Task 7：布局 / 网格 / 页签 / 拖动夹边）
 *
 * 为什么是 DOM 而不是 Phaser 里的 Graphics
 * ----------------------------------------
 * 背包要显示 35 件装备的贴图、每格一个等级小字、7 个页签，后面还要挂悬停浮层
 * 和出售按钮。这些用 Phaser 的 Graphics 画出来，每次开关都要重绘上百个矢量路径，
 * 且文字排版（中文换行、字数不定）几乎没法做 —— 那是把 DOM 已经解决的问题重做一遍。
 * 所以背包做成一张盖在画布上的 DOM 浮层，游戏本身继续跑在 canvas 里。
 *
 * 本模块只负责**骨架**：标题栏、左右两栏、7 个页签、5×7 网格、拖动夹边。
 * 装备槽 / 悬停浮层 / 出售按钮 / 分页由 Task 8 在这套骨架上补。
 *
 * 三条约束，都是踩过的坑：
 *   1. Phaser 的 game 要**懒取**：本文件在 app.js 之前加载（index.html 的脚本顺序），
 *      脚本执行时 game 还不存在，只有第一次 open() 时才拿得到贴图。
 *   2. 空格子也必须渲染：格数随内容变化的话，玩家没法判断"还剩几格"，
 *      测试也没法断言网格尺寸。所以永远 35 个 .cell。
 *   3. toDataURL 是同步且昂贵的：35 件 × 每次刷新会把面板卡住，必须缓存。
 */
(function (global) {
  'use strict';

  const PANEL_W = 620;      // 设计 §4.1：620 × 540，约占 960×600 画布的 40%
  const PANEL_H = 540;
  const CELLS = 35;         // 5 列 × 7 行（设计 §4.3）

  // 页签：全部 + 五个槽位 + 特殊（设计 §4.4）。
  // 判据只能是 kind === 'special' —— config.js 里没有 ultimate 这个字段，
  // hub.js 那个同名变量里装的是 def.kind === 'special' 的结果。
  const TABS = [
    { id: 'all', label: '全部' },
    { id: 'head', label: '头部' },
    { id: 'torso', label: '躯干' },
    { id: 'back', label: '背部' },
    { id: 'weapon', label: '武器' },
    { id: 'feet', label: '脚部' },
    { id: 'special', label: '特殊' },
  ];

  /** 贴图 dataURL 缓存。成功才写：失败留空，下次 refresh 还能重试。 */
  const spriteCache = new Map();

  let ui = null;            // 懒建的 DOM 引用集合
  let opened = false;
  let state = null;
  let opts = {};
  let tab = 'all';
  let drag = null;          // { pointerId, dx, dy }

  const doc = () => global.document;

  function cfg() { return global.GameConfig; }
  function logic() { return global.GameLogic; }

  // ---------------------------------------------------------------- 贴图
  /**
   * 把 app.js 已烘焙好的 40×60 贴图转成 <img> 能用的 dataURL。
   *
   * 用 toDataURL 而不是 texture.getSourceImage().src：generateTexture 产出的
   * 是一张**离屏 canvas**，它没有 src 属性，直接塞给 <img> 是空的。
   * 转换结果必须缓存 —— 这个调用是同步的，35 件 × 每帧级别的刷新会把主线程钉住。
   */
  function spriteUrl(slot, id) {
    if (!slot || !id) return null;
    const key = 'eq-' + slot + '-' + id;
    if (spriteCache.has(key)) return spriteCache.get(key);
    let url = null;
    try {
      const game = global.__game;
      const tex = game && game.textures && game.textures.get(key);
      const img = tex && tex.source && tex.source[0] && tex.source[0].image;
      if (img && typeof img.toDataURL === 'function') {
        url = img.toDataURL('image/png');
      }
    } catch (e) {
      url = null;   // 贴图还没烘好 / 键不存在：这一格退化成占位，不抛
    }
    if (url) spriteCache.set(key, url);
    return url;
  }

  // ---------------------------------------------------------------- 数据
  function bagList() {
    const C = cfg();
    const L = logic();
    const bag = (state && state.meta && state.meta.bag) || [];
    if (L && typeof L.bagFilter === 'function') return L.bagFilter(bag, tab);
    // 逻辑层没加载时的兜底：行为与 L.bagFilter 一致，避免面板整片空白
    if (tab === 'all') return bag.slice();
    return bag.filter(function (e) {
      const def = C && typeof C.equipDef === 'function' ? C.equipDef(e.id) : null;
      if (!def) return false;
      return tab === 'special' ? def.kind === 'special' : def.slot === tab;
    });
  }

  function defOf(id) {
    const C = cfg();
    return C && typeof C.equipDef === 'function' ? C.equipDef(id) : null;
  }

  // ---------------------------------------------------------------- DOM 构建
  function el(tag, cls, text) {
    const n = doc().createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function build() {
    const root = doc().getElementById('bag');
    if (!root) return null;   // 页面没这个容器（比如别的宿主页面）就什么都不做

    ui = {
      root: root,
      bar: root.querySelector('#bag-bar'),
      count: root.querySelector('#bag-count'),
      grid: root.querySelector('#bag-grid'),
      empty: root.querySelector('#bag-empty'),
      tabs: root.querySelector('#bag-tabs'),
      cells: [],
    };

    // 页签：只响应点击。数字键 1/2/3 已被药水占用（app.js），不能拿来切页。
    if (ui.tabs && !ui.tabs.firstChild) {
      TABS.forEach(function (t) {
        const b = el('button', 'tab', t.label);
        b.type = 'button';
        b.dataset.tab = t.id;
        b.addEventListener('click', function () {
          if (tab === t.id) return;
          tab = t.id;
          refresh();
        });
        ui.tabs.appendChild(b);
      });
    }

    // 网格：一次建满 35 格，之后只更新内容。格子节点不重建，
    // 否则每次刷新都会丢掉 Task 8 要挂的悬停监听。
    if (ui.grid && !ui.cells.length) {
      for (let i = 0; i < CELLS; i++) {
        const c = el('div', 'cell empty');
        c.dataset.index = String(i);
        ui.grid.appendChild(c);
        ui.cells.push(c);
      }
    }

    const x = root.querySelector('#bag-x');
    if (x) x.addEventListener('click', function () { close(); });

    if (ui.bar) {
      ui.bar.addEventListener('pointerdown', onDown);
      ui.bar.addEventListener('pointermove', onMove);
      ui.bar.addEventListener('pointerup', onUp);
      ui.bar.addEventListener('pointercancel', onUp);
    }
    return ui;
  }

  // ---------------------------------------------------------------- 渲染
  function paintCell(cell, entry) {
    cell.textContent = '';
    cell.className = 'cell';
    if (!entry) {
      cell.classList.add('empty');
      return;
    }
    const def = defOf(entry.id);
    const url = spriteUrl(def && def.slot, entry.id);
    if (url) {
      const img = el('img');
      img.src = url;
      img.alt = def ? def.name : entry.id;
      img.draggable = false;
      cell.appendChild(img);
    } else {
      // 贴图缺失也要占住这一格：显示轮廓，而不是让格子塌成空的
      cell.classList.add('noart');
      cell.appendChild(el('span', 'ph', def ? def.name.slice(0, 2) : '?'));
    }
    const lv = entry.level || 1;
    cell.appendChild(el('span', 'lv', 'Lv' + lv));
    if (def && def.kind === 'special') cell.classList.add('ult');
    cell.title = (def ? def.name : entry.id) + ' · Lv' + lv;
  }

  function refresh() {
    if (!ui) return;
    const list = bagList();

    // 页签高亮
    if (ui.tabs) {
      const kids = ui.tabs.children;
      for (let i = 0; i < kids.length; i++) {
        kids[i].classList.toggle('on', kids[i].dataset.tab === tab);
      }
    }

    // 网格永远 35 格：不足补 null，超出截断（分页 UI 是 Task 8 的事，
    // 本任务只渲染当前页的第一屏，但仍然保持 5×7 的骨架）
    for (let i = 0; i < CELLS; i++) paintCell(ui.cells[i], list[i] || null);

    // 计数：已用 / 容量。容量来自已解锁页数，不是"本页 35 格"。
    if (ui.count) {
      const L = logic();
      let used = list.length;
      let cap = CELLS;
      if (L && typeof L.bagCount === 'function') used = L.bagCount(state);
      if (L && typeof L.bagCapacity === 'function') cap = L.bagCapacity(state);
      ui.count.textContent = used + ' / ' + cap;
    }

    // 空分类要有话说（设计 §4.4），而不是让玩家面对 35 个空槽猜自己是不是点错了
    if (ui.empty) {
      const none = list.length === 0;
      ui.empty.classList.toggle('on', none);
      if (none) ui.empty.textContent = tab === 'all' ? '背包还是空的' : '这一类还没有装备';
    }
  }

  // ---------------------------------------------------------------- 位置
  /**
   * 夹边：left ∈ [0, viewW - w]、top ∈ [0, viewH - h]。
   *
   * 两个角都要夹。只夹左上角的话，窗口右下方向照样能把面板拖出屏幕 ——
   * 玩家拖出去一次就再也找不回来了。
   * 面板比可视区还大时 max 会算成负数，此时用 max(0, ...) 保证不越界到负坐标。
   */
  function clamp() {
    if (!ui || !ui.root) return;
    const root = ui.root;
    const w = root.offsetWidth || PANEL_W;
    const h = root.offsetHeight || PANEL_H;
    let left = parseFloat(root.style.left);
    let top = parseFloat(root.style.top);
    // 样式没写过（或调用方直接改了别的定位）时，用当前实际位置做起点
    if (!isFinite(left)) left = root.offsetLeft || 0;
    if (!isFinite(top)) top = root.offsetTop || 0;
    const maxL = Math.max(0, (global.innerWidth || PANEL_W) - w);
    const maxT = Math.max(0, (global.innerHeight || PANEL_H) - h);
    left = Math.min(Math.max(0, left), maxL);
    top = Math.min(Math.max(0, top), maxT);
    root.style.left = Math.round(left) + 'px';
    root.style.top = Math.round(top) + 'px';
  }

  /**
   * 默认位置：画布右下角附近，离边 16px。
   * 不放在正中是因为角色就在画面中央 —— 面板一开就糊在脸上，玩家第一眼
   * 看到的是"我被挡住了"。（设计 §4.2 写的是"居中偏左"，但那条与画布上方
   * HUD、下方技能栏都会打架，这里按任务要求取右下。）
   */
  function placeDefault() {
    const root = ui && ui.root;
    if (!root) return;
    const w = root.offsetWidth || PANEL_W;
    const h = root.offsetHeight || PANEL_H;
    let right = global.innerWidth || 0;
    let bottom = global.innerHeight || 0;
    const frame = doc() && doc().getElementById('frame');
    if (frame && typeof frame.getBoundingClientRect === 'function') {
      const r = frame.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) { right = r.right; bottom = r.bottom; }
    }
    root.style.left = Math.round(right - w - 16) + 'px';
    root.style.top = Math.round(bottom - h - 16) + 'px';
    clamp();
  }

  // ---------------------------------------------------------------- 拖动
  function onDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    // 标题栏上的按钮（关闭）不算把手，否则点 ✕ 会顺手把面板拖两像素
    if (e.target && e.target.closest && e.target.closest('button')) return;
    const root = ui.root;
    const r = root.getBoundingClientRect();
    drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
    ui.bar.classList.add('grabbing');
    if (ui.bar.setPointerCapture) {
      try { ui.bar.setPointerCapture(e.pointerId); } catch (err) { /* 老浏览器忽略 */ }
    }
    if (e.preventDefault) e.preventDefault();
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    ui.root.style.left = (e.clientX - drag.dx) + 'px';
    ui.root.style.top = (e.clientY - drag.dy) + 'px';
    // 边拖边夹：松手才夹的话，中途会有一段完全在屏幕外，手感像是掉了
    clamp();
  }

  function onUp(e) {
    if (!drag || (e.pointerId !== undefined && e.pointerId !== drag.id)) return;
    drag = null;
    if (ui.bar) {
      ui.bar.classList.remove('grabbing');
      if (ui.bar.releasePointerCapture && e.pointerId !== undefined) {
        try { ui.bar.releasePointerCapture(e.pointerId); } catch (err) { /* 已释放 */ }
      }
    }
    clamp();
  }

  // ---------------------------------------------------------------- 公开 API
  // opts.onChange 是 Task 8 的钩子（筛选/整理后同步面板外的 UI）。
  // 这里只保存不调用：调用时机由真正会改背包的那个模块决定，不是刷新时。
  function open(nextState, nextOpts) {
    if (nextState) state = nextState;
    if (nextOpts) opts = nextOpts;
    if (!ui && !build()) return false;
    opened = true;
    ui.root.classList.add('on');
    ui.root.setAttribute('aria-hidden', 'false');
    // 顺序要紧：先显示再量尺寸，display:none 的元素 offsetWidth 是 0。
    // 每次打开都回到默认位置（设计 §4.2：位置不持久化）—— 玩家拖到边角的
    // 位置一旦被记下来，窗口缩小后就会落在界外；夹边能救回来，但"打开就在
    // 一个奇怪的地方"不如"每次都在同一个地方"。
    placeDefault();
    refresh();
    return true;
  }

  function close() {
    opened = false;
    if (ui && ui.root) {
      ui.root.classList.remove('on');
      ui.root.setAttribute('aria-hidden', 'true');
    }
    drag = null;
    return true;
  }

  function isOpen() { return opened; }

  global.BagHud = {
    open: open,
    close: close,
    refresh: function () { refresh(); },
    isOpen: isOpen,
    clamp: clamp,
    // 测试用：清掉贴图缓存（贴图在任何时候都可能被重烘，缓存必须可失效）
    _clearSpriteCache: function () { spriteCache.clear(); },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
