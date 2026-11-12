/**
 * baghud.js — 背包 DOM 浮层（Task 7 骨架 / Task 8 交互）
 *
 * 为什么是 DOM 而不是 Phaser 里的 Graphics
 * ----------------------------------------
 * 背包要显示 35 件装备的贴图、每格一个等级小字、7 个页签，还要挂悬停浮层
 * 和出售按钮。这些用 Phaser 的 Graphics 画出来，每次开关都要重绘上百个矢量路径，
 * 且文字排版（中文换行、字数不定）几乎没法做 —— 那是把 DOM 已经解决的问题重做一遍。
 * 所以背包做成一张盖在画布上的 DOM 浮层，游戏本身继续跑在 canvas 里。
 *
 * 职责划分（Task 8 起）
 * --------------------
 * 本模块只负责**界面**：把 meta.bag / meta.equipment 画出来，把玩家的点击、
 * 悬停、右键翻译成 logic 层的一个调用，然后重画。所有规则（能不能卖、
 * 每 id 留一件、扩容价格、整理顺序）都在 logic.js 里，这里一行判定都不写 ——
 * 规则只写一遍，测试才只需要测一处。
 *
 * 三条约束，都是踩过的坑：
 *   1. Phaser 的 game 要**懒取**：本文件在 app.js 之前加载（index.html 的脚本顺序），
 *      脚本执行时 game 还不存在，只有第一次 open() 时才拿得到贴图。
 *   2. 空格子也必须渲染：格数随内容变化的话，玩家没法判断"还剩几格"，
 *      测试也没法断言网格尺寸。所以永远 35 个 .cell（翻页时也不变）。
 *   3. toDataURL 是同步且昂贵的：每件 × 每次刷新会把面板卡住，必须缓存。
 *
 * 关于「换装后主角要当场变」
 * -------------------------
 * Hub.update 首行是 if (this.panelOpen) return;（app.js:1529），背包一开就没有
 * 下一帧的 refreshHeroEquip。所以这里**主动回调宿主**（setHost 注册的 onChange），
 * 而不是指望下一帧顺手刷到 —— 那在一次都不跑的情况下是永远的旧贴图。
 */
(function (global) {
  'use strict';

  // 面板尺寸的唯一来源是 index.html 的 CSS：#bag 现在是
  // min(470px, 100vw - 24px) × min(500px, 100vh - 24px)（= 画布的 40.8%）。
  // 这两个常量只在 display:none、拿不到 offsetWidth/Height 时当兜底 ——
  // 兜底值错了，夹边就会算出一个不存在的范围，所以改 CSS 必须同步改这里。
  const PANEL_W = 470;
  const PANEL_H = 500;
  // 5 列 × 7 行 = 35 格（设计 §4.3）。这个数值只写在 config.js 的
  // BAG.cellsPerPage（它自己写着"数值只写这里"），logic.js 的 BAG_GRID_PER_PAGE
  // 也是从那里读的：这里再写一个字面量，就多一个会漂移的真相。
  const CELLS = (global.GameConfig && global.GameConfig.BAG &&
    global.GameConfig.BAG.cellsPerPage) || 35;

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

  // 五个装备位（与 C.EQUIP_SLOTS 同序）与格子里的单字标签。
  // 左右两列各画一遍：设计 §4.1 要求「5 个槽 × 2 侧 = 10 个框，左右各 5」，
  // 两列指向同一个装备位 —— 点任意一侧都是对同一个部位操作，不是十个独立格子。
  const SLOT_ORDER = ['head', 'torso', 'back', 'weapon', 'feet'];
  const SLOT_SHORT = { head: '头', torso: '躯', back: '背', weapon: '武', feet: '脚' };

  // 主角分层的叠放顺序（与 app.js:61 的 EQUIP_LAYER_ORDER 一致）。
  // 不能共用那个常量：它在 app.js 的闭包里，没有导出。改这里要同步改那边。
  const LAYER_ORDER = ['back', 'torso', 'feet', 'head', 'weapon'];

  // 左栏底部的四项数值（设计 §4.1：装备变化时立即更新）。
  const STAT_ROWS = [
    { key: 'maxHp', label: '生命上限' },
    { key: 'damage', label: '伤害' },
    { key: 'speed', label: '移速' },
    { key: 'hurtMul', label: '受伤' },
  ];

  /*
   * 贴图 dataURL 的转换与缓存在 sprites.js（SpriteLib）。
   *
   * 这里原本有一份自己的 Map。Task 17 让设施面板也要贴图之后，两份缓存就变成
   * 真的开销：背包里转过的那件装备，兵器架还得再 toDataURL 一次，而这个转换是
   * 同步的 PNG 编码 —— 一屏 35 行、每次切页签都重来一遍会把主线程按在那里。
   * 现在只有一处缓存，两个面板共享。
   */

  let ui = null;            // 懒建的 DOM 引用集合
  let opened = false;
  let state = null;
  let opts = {};
  let host = null;          // 宿主场景（setHost 注册）：{ onChange, onOpen, onClose }
  let equipSig = null;      // 上次通知过的装备签名，见 syncEquipChange
  let tab = 'all';
  let page = 0;             // 0 基页号
  let view = [];            // 当前页的 35 个条目（缺位是 null），与 ui.cells 一一对应
  let batch = null;         // null = 普通态；{ sel: { uid: true } } = 批量选择态
  let keptUids = {};        // 批量态里"每 id 会被保留的那件"（由 logic 的补集决定）
  let drag = null;          // { pointerId, dx, dy }
  let resizeBound = false;  // window 上的 resize 监听是否已注册（只注册一次）

  const doc = () => global.document;

  function cfg() { return global.GameConfig; }
  function logic() { return global.GameLogic; }
  /*
   * 音效（Task 12）：出售成功的"收银机叮"。
   *
   * audio.js 在 index.html 里先于本文件加载，但这里仍然要退回空实现：
   * 背包浮层被单独引用（例如某个测试只加载 baghud.js）时，一个未定义的
   * GameAudio 会让"出售"这个按钮直接抛异常 —— 那代价太大。
   */
  const GameAudio = global.GameAudio || { play: function () { return false; } };

  function equipmentOf() {
    return (state && state.meta && state.meta.equipment) || {};
  }

  function bagOf() {
    return (state && state.meta && state.meta.bag) || [];
  }

  // ---------------------------------------------------------------- 贴图
  /**
   * 把 app.js 已烘焙好的贴图转成 <img> 能用的 dataURL。
   *
   * 用 toDataURL 而不是 texture.getSourceImage().src：generateTexture 产出的
   * 是一张**离屏 canvas**，它没有 src 属性，直接塞给 <img> 是空的。
   * 转换结果必须缓存 —— 这个调用是同步的，35 件 × 每帧级别的刷新会把主线程钉住。
   */
  function spriteLib() {
    // 单独加载 baghud.js（某些测试只加载这一个文件）时 SpriteLib 可能不存在。
    // 退回空实现而不是抛：一格没图，比整个背包打不开轻得多。
    return global.SpriteLib || { url: function () { return null; },
      equipUrl: function () { return null; } };
  }

  function textureUrl(key) {
    if (!key) return null;
    return spriteLib().url(key);
  }

  function spriteUrl(slot, id) {
    if (!slot || !id) return null;
    return spriteLib().equipUrl(slot, id);
  }

  // ---------------------------------------------------------------- 数据
  function bagList() {
    const C = cfg();
    const L = logic();
    const bag = bagOf();
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

  function slotName(def) {
    const C = cfg();
    if (!def) return '—';
    return (C && C.EQUIP_SLOT_NAMES && C.EQUIP_SLOT_NAMES[def.slot]) || def.slot;
  }

  function sellValueOf(entry) {
    const L = logic();
    if (!entry || !L || typeof L.sellValue !== 'function') return 0;
    return L.sellValue(entry.id, entry.level || 1) || 0;
  }

  /** 这个 id 现在是不是正穿在身上（穿在身上的那份不在背包里）。 */
  function isWorn(id) {
    const eq = equipmentOf();
    for (let i = 0; i < SLOT_ORDER.length; i++) {
      const it = eq[SLOT_ORDER[i]];
      if (it && it.id === id) return true;
    }
    return false;
  }

  /** 背包里这个 id 有几件。 */
  function copiesOf(id) {
    let n = 0;
    bagOf().forEach(function (e) { if (e.id === id) n++; });
    return n;
  }

  function pagesOf() {
    const L = logic();
    const C = cfg();
    let cap = CELLS;
    if (L && typeof L.bagCapacity === 'function') cap = L.bagCapacity(state) || CELLS;
    const pages = Math.max(1, Math.round(cap / CELLS));
    const max = (C && C.BAG && C.BAG.maxPages) || 6;
    return Math.min(pages, max);
  }

  // ---------------------------------------------------------------- DOM 构建
  function el(tag, cls, text) {
    const n = doc().createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function makeSlot(slot) {
    const n = el('div', 'slot empty');
    n.dataset.slot = slot;
    n.appendChild(el('span', 'k', SLOT_SHORT[slot] || '?'));
    n.addEventListener('click', function () { onSlotClick(slot); });
    // 右键槽位 = 想卖身上这件。它不在背包里，必须给出原因而不是没反应（§4.6）。
    n.addEventListener('contextmenu', function (e) {
      if (e.preventDefault) e.preventDefault();
      const it = equipmentOf()[slot];
      if (it) notify('穿在身上的先卸下才能卖', false);
    });
    if (!ui.slots[slot]) ui.slots[slot] = [];
    ui.slots[slot].push(n);
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
      tools: root.querySelector('#bag-tools'),
      batchBar: root.querySelector('#bag-batchbar'),
      sum: root.querySelector('#bag-sum'),
      confirmOk: root.querySelector('.confirm-ok'),
      pageBar: root.querySelector('#bag-pagebar'),
      pageLabel: root.querySelector('#bag-page'),
      prev: root.querySelector('[data-page="prev"]'),
      next: root.querySelector('[data-page="next"]'),
      expand: root.querySelector('[data-act="expand"]'),
      wear: root.querySelector('#bag-wear'),
      stats: root.querySelector('#bag-stats'),
      tip: doc().getElementById('bag-tip'),
      slots: {},
      statRows: {},
      doll: null,
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
          page = 0;
          // 勾选态是"看得见的承诺"：换了页签，被勾的格子就不在眼前了。
          // 留着勾选，确认条上会挂着一堆玩家看不见的件，一点就卖掉（F2）。
          // 只清勾选、不退出批量态 —— 玩家还在批量流程里，只是从零开始挑。
          if (batch) batch.sel = {};
          refresh();
        });
        ui.tabs.appendChild(b);
      });
    }

    // 网格：一次建满 35 格，之后只更新内容。格子节点不重建，
    // 否则每次刷新都会丢掉挂在格子上的悬停 / 右键监听。
    if (ui.grid && !ui.cells.length) {
      for (let i = 0; i < CELLS; i++) {
        const c = el('div', 'cell empty');
        c.dataset.index = String(i);
        c.addEventListener('pointerover', onCellOver);
        c.addEventListener('pointerout', onCellOut);
        c.addEventListener('click', onCellClick);
        c.addEventListener('contextmenu', onCellContext);
        ui.grid.appendChild(c);
        ui.cells.push(c);
      }
    }

    // 左栏上半：左列 5 个槽 + 角色图 + 右列 5 个槽（设计 §4.1）
    if (ui.wear && !ui.wear.firstChild) {
      const left = el('div', 'col');
      SLOT_ORDER.forEach(function (s) { left.appendChild(makeSlot(s)); });
      const doll = el('div', 'doll');
      const right = el('div', 'col');
      SLOT_ORDER.forEach(function (s) { right.appendChild(makeSlot(s)); });
      ui.wear.appendChild(left);
      ui.wear.appendChild(doll);
      ui.wear.appendChild(right);
      ui.doll = doll;
    }

    // 左栏下半：四项当前数值
    if (ui.stats && !ui.stats.firstChild) {
      STAT_ROWS.forEach(function (row) {
        const line = el('div', 'row');
        line.appendChild(el('span', 'k', row.label));
        const v = el('b', null, '—');
        line.appendChild(v);
        ui.stats.appendChild(line);
        ui.statRows[row.key] = v;
      });
    }

    const x = root.querySelector('#bag-x');
    if (x) x.addEventListener('click', function () { close(); });

    bindAct('sort', doSort);
    bindAct('batch-sell', enterBatch);
    bindAct('pick-dups', function () { pickBy('dups'); });
    bindAct('pick-base', function () { pickBy('base'); });
    bindAct('toggle-all', function () { pickBy('all'); });
    bindAct('batch-cancel', exitBatch);
    bindAct('expand', expandPage);
    if (ui.confirmOk) ui.confirmOk.addEventListener('click', runConfirm);
    if (ui.prev) ui.prev.addEventListener('click', function () { goPage(page - 1); });
    if (ui.next) ui.next.addEventListener('click', function () { goPage(page + 1); });

    if (ui.bar) {
      ui.bar.addEventListener('pointerdown', onDown);
      ui.bar.addEventListener('pointermove', onMove);
      ui.bar.addEventListener('pointerup', onUp);
      ui.bar.addEventListener('pointercancel', onUp);
    }
    return ui;
  }

  function bindAct(act, fn) {
    const b = ui && ui.root ? ui.root.querySelector('[data-act="' + act + '"]') : null;
    if (b) b.addEventListener('click', fn);
  }

  // ---------------------------------------------------------------- 渲染
  function paintCell(cell, entry) {
    cell.textContent = '';
    cell.className = 'cell';
    cell.dataset.uid = '';
    if (!entry) {
      cell.classList.add('empty');
      cell.title = '';
      return;
    }
    cell.dataset.uid = entry.uid || '';
    const def = defOf(entry.id);
    const name = def ? def.name : entry.id;
    const url = spriteUrl(def && def.slot, entry.id);
    if (url) {
      const img = el('img');
      img.src = url;
      img.alt = name;
      img.draggable = false;
      cell.appendChild(img);
    } else {
      // 贴图缺失也要占住这一格：显示轮廓，而不是让格子塌成空的
      cell.classList.add('noart');
      cell.appendChild(el('span', 'ph', name.slice(0, 2)));
    }
    const lv = entry.level || 1;
    cell.appendChild(el('span', 'lv', 'Lv' + lv));
    if (def && def.kind === 'special') cell.classList.add('ult');
    cell.title = name + ' · Lv' + lv;

    if (batch) {
      const worn = isWorn(entry.id);
      const lastOne = copiesOf(entry.id) < 2;
      // 同 id 有多件时，逻辑层只卖等级低的那些，最高那件会留下 —— 它同样
      // 勾不动，得在格子上标出来（否则玩家勾两件、以为两件都没了）。
      const keptOne = !worn && !lastOne && !!keptUids[entry.uid];
      if (worn) {
        cell.classList.add('worn');
        cell.title = name + ' · 已穿戴，先卸下才能卖';
      } else if (lastOne) {
        cell.classList.add('keep');
        cell.title = name + ' · 每件至少留一件，批量出售不卖它';
      } else if (keptOne) {
        cell.classList.add('keep');
        cell.title = name + ' · Lv' + lv + '（同 id 里保留这件）';
      } else if (batch.sel[entry.uid]) {
        cell.classList.add('sel', 'pickable');
      } else {
        cell.classList.add('pickable');
      }
      cell.appendChild(el('div', 'pick', batch.sel[entry.uid] && !worn && !lastOne ? '✓' : ''));
    }
  }

  function paintSlots() {
    if (!ui || !ui.slots) return;
    const eq = equipmentOf();
    SLOT_ORDER.forEach(function (slot) {
      const it = eq[slot];
      const def = it ? defOf(it.id) : null;
      const name = def ? def.name : (it ? it.id : '');
      (ui.slots[slot] || []).forEach(function (n) {
        n.textContent = '';
        n.className = 'slot' + (it ? ' on' : ' empty');
        if (it) {
          const url = spriteUrl(slot, it.id);
          if (url) {
            const img = el('img');
            img.src = url;
            img.alt = name;
            img.draggable = false;
            n.appendChild(img);
          } else {
            n.appendChild(el('span', 'k', SLOT_SHORT[slot] || '?'));
          }
          n.appendChild(el('span', 'lv', 'Lv' + (it.level || 1)));
          n.title = slotName(defOf(it.id)) + '：' + name +
                    ' Lv' + (it.level || 1) + '（点击卸下）';
        } else {
          n.appendChild(el('span', 'k', SLOT_SHORT[slot] || '?'));
          n.title = '空着的' + SLOT_SHORT[slot] + '部位（点右边的装备穿上）';
        }
      });
    });
  }

  /**
   * 左栏的角色图：身体贴图 + 已穿戴的五层叠上去。
   *
   * 游戏里主角就是「hero + 五层装备」的 Container（app.js:62-80），
   * 这些层都是同一个 40×60 坐标系里的整幅贴图，所以这里按同样顺序
   * 绝对定位地叠起来，就是玩家在场景里看到的那个样子 ——
   * 不需要另画一张"角色图"，也就不会出现两套形象对不上。
   */
  function paintDoll() {
    const doll = ui && ui.doll;
    if (!doll) return;
    doll.textContent = '';
    const body = textureUrl('hero');
    if (body) {
      const b = el('img');
      b.src = body;
      b.alt = '角色';
      b.draggable = false;
      doll.appendChild(b);
    }
    const eq = equipmentOf();
    LAYER_ORDER.forEach(function (slot) {
      const it = eq[slot];
      if (!it) return;
      const url = spriteUrl(slot, it.id);
      if (!url) return;
      const def = defOf(it.id);
      const im = el('img');
      im.src = url;
      im.alt = def ? def.name : it.id;
      im.draggable = false;
      doll.appendChild(im);
    });
  }

  function paintStats() {
    if (!ui || !ui.statRows || !ui.statRows.maxHp) return;
    const L = logic();
    let st = null;
    try { st = L && typeof L.playerStats === 'function' ? L.playerStats(state) : null; }
    catch (e) { st = null; }
    if (!st) st = { maxHp: 0, damage: 0, speed: 0, hurtMul: 1 };
    ui.statRows.maxHp.textContent = String(Math.round(st.maxHp));
    ui.statRows.damage.textContent = String(Math.round(st.damage));
    ui.statRows.speed.textContent = String(Math.round(st.speed));
    ui.statRows.hurtMul.textContent = '×' + Number(st.hurtMul || 1).toFixed(2);
  }

  function refresh() {
    if (!ui || !state) return;
    const list = bagList();
    const pages = pagesOf();
    if (page > pages - 1) page = pages - 1;
    if (page < 0) page = 0;

    // 页签高亮
    if (ui.tabs) {
      const kids = ui.tabs.children;
      for (let i = 0; i < kids.length; i++) {
        kids[i].classList.toggle('on', kids[i].dataset.tab === tab);
      }
    }

    // 批量态：「每 id 保留的那一件」由 logic.duplicateUids（经 sellableUids）决定，
    // UI 只取补集，不自己比等级 —— 比法一旦和逻辑层分叉，标出来的件就会和真正
    // 留下的那件不是同一件，玩家按标记做决定反而亏。
    keptUids = {};
    if (batch) {
      const Lk = logic();
      const sellable = (Lk && typeof Lk.sellableUids === 'function')
        ? Lk.sellableUids(state) : [];
      const sellSet = {};
      sellable.forEach(function (u) { sellSet[u] = true; });
      bagOf().forEach(function (e) {
        if (sellSet[e.uid]) return;
        if (copiesOf(e.id) >= 2) keptUids[e.uid] = true;
      });
    }

    // 网格永远 35 格：这一页的内容不足 35 就补 null，翻页只换内容不换格数。
    // 这里**不要**换成 logic.js 的 pageSlice：那个按整个背包的下标切页，
    // 而 UI 的分页基准是"当前页签筛选后的列表"（切到「武器」页签时第一页
    // 就该是前 35 件武器）。两套语义混用会翻出空页 —— 筛选后只剩 3 件，
    // pageSlice 却按整包第 36 件开始。
    const start = page * CELLS;
    view = [];
    for (let i = 0; i < CELLS; i++) view.push(start + i < list.length ? list[start + i] : null);
    for (let i = 0; i < CELLS; i++) paintCell(ui.cells[i], view[i]);

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

    if (ui.pageLabel) ui.pageLabel.textContent = '第 ' + (page + 1) + ' / ' + pages + ' 页';
    if (ui.prev) ui.prev.disabled = page <= 0;
    if (ui.next) ui.next.disabled = page >= pages - 1;
    if (ui.expand) ui.expand.disabled = pages >= 6;

    paintSlots();
    paintDoll();
    paintStats();
    paintBatch();
    syncEquipChange();
  }

  // ---------------------------------------------------------------- 悬停浮层（§4.3）
  function entryOf(cell) {
    if (!cell || !cell.dataset) return null;
    const i = Number(cell.dataset.index);
    return i >= 0 ? (view[i] || null) : null;
  }

  function onCellOver(e) {
    const cell = e.currentTarget || e.target;
    const entry = entryOf(cell);
    if (entry) showTip(cell, entry);
  }

  function onCellOut() {
    hideTip();
  }

  function showTip(cell, entry) {
    const tip = ui && ui.tip;
    if (!tip || !entry) return;
    const def = defOf(entry.id);
    const lv = entry.level || 1;
    tip.textContent = '';
    tip.appendChild(el('div', 'n', def ? def.name : entry.id));
    tip.appendChild(el('div', 'r', '槽位：' + slotName(def) + ' · 等级 Lv' + lv));
    if (def && def.desc) tip.appendChild(el('div', 'r', '效果：' + def.desc));
    tip.appendChild(el('div', 'r', '售价：' + sellValueOf(entry) + ' 铜币'));
    if (batch) {
      if (isWorn(entry.id)) tip.appendChild(el('div', 'r', '已穿戴，先卸下才能卖'));
      else if (copiesOf(entry.id) < 2) tip.appendChild(el('div', 'r', '每件至少留一件，批量出售不卖它'));
    }
    tip.classList.add('on');
    placeTip(cell);
  }

  function placeTip(cell) {
    const tip = ui.tip;
    if (!tip || typeof cell.getBoundingClientRect !== 'function') return;
    const r = cell.getBoundingClientRect();
    const w = tip.offsetWidth || 200;
    const h = tip.offsetHeight || 80;
    const vw = global.innerWidth || 800;
    const vh = global.innerHeight || 600;
    let left = r.right + 10;
    let top = r.top - 4;
    if (left + w > vw - 8) left = Math.max(8, r.left - w - 10);
    if (top + h > vh - 8) top = Math.max(8, vh - h - 8);
    if (top < 8) top = 8;
    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(top) + 'px';
  }

  function hideTip() {
    if (!ui || !ui.tip) return;
    ui.tip.classList.remove('on');
  }

  // ---------------------------------------------------------------- 交互动作
  function notify(msg, good) {
    if (opts && typeof opts.toast === 'function') { opts.toast(msg, good); return; }
    const uiApi = global.EmberfieldUI;
    if (uiApi && typeof uiApi.toast === 'function') uiApi.toast(msg, good);
  }

  /**
   * 改完状态就落盘。背包的所有动作（穿、脱、卖、扩、整理）都会改 meta，
   * 而 Hub.update 开着面板时是早退的 —— 那条路径上的自动保存同样不会跑到，
   * 所以这里显式存一次，不能指望"关面板的时候顺手存"。
   */
  function persist() {
    const uiApi = global.EmberfieldUI;
    if (uiApi && typeof uiApi.save === 'function') uiApi.save(state);
  }

  function onCellClick(e) {
    const cell = e.currentTarget || e.target;
    const entry = entryOf(cell);
    if (!entry) return;
    if (batch) {
      toggleSel(entry);
      return;
    }
    equipEntry(entry);
  }

  function onCellContext(e) {
    if (e.preventDefault) e.preventDefault();
    const cell = e.currentTarget || e.target;
    const entry = entryOf(cell);
    if (!entry) return;
    if (batch) {
      notify('选择态里请用格子上的勾选框', false);
      return;
    }
    sellEntry(entry);
  }

  function onSlotClick(slot) {
    const it = equipmentOf()[slot];
    if (!it) {
      notify('这一格还空着，点右边的装备就能穿上', false);
      return;
    }
    const L = logic();
    const res = L && typeof L.unequipSlot === 'function'
      ? L.unequipSlot(state, slot) : null;
    if (res && res.ok) {
      const def = defOf(res.id || it.id);
      notify('卸下 ' + (def ? def.name : it.id), true);
    } else {
      notify((res && res.reason) || '卸不下来', false);
    }
    hideTip();
    persist();
    refresh();
  }

  function equipEntry(entry) {
    const L = logic();
    const def = defOf(entry.id);
    const name = def ? def.name : entry.id;
    const res = L && typeof L.equipItem === 'function'
      ? L.equipItem(state, entry.id, entry.uid) : null;
    if (res && res.ok) notify('穿上 ' + name, true);
    else notify((res && res.reason) || '穿不上', false);
    hideTip();
    persist();
    refresh();
  }

  function sellEntry(entry) {
    const L = logic();
    const def = defOf(entry.id);
    const name = def ? def.name : entry.id;
    const res = L && typeof L.sellItem === 'function'
      ? L.sellItem(state, entry.uid) : null;
    if (res && res.ok) {
      // 只有真的卖掉才响（"卖不掉"是拒绝，不该有成交音）
      GameAudio.play('sell');
      notify('卖掉 ' + name + ' · +' + res.value + ' 铜币', true);
    } else notify((res && res.reason) || '卖不掉', false);
    hideTip();
    persist();
    refresh();
  }

  function doSort() {
    const L = logic();
    if (L && typeof L.sortBag === 'function') L.sortBag(state);
    page = 0;
    notify('已整理', true);
    persist();
    refresh();
  }

  // ---------------------------------------------------------------- 分页（§4.7）
  function goPage(next) {
    const pages = pagesOf();
    const p = Math.max(0, Math.min(pages - 1, next));
    if (p === page) return;
    page = p;
    // 同页签：翻页后勾的件已经不在眼前，留着它等于默许卖掉看不见的东西（F2）。
    if (batch) batch.sel = {};
    hideTip();
    refresh();
  }

  function expandPage() {
    const L = logic();
    const res = L && typeof L.buyBagPage === 'function'
      ? L.buyBagPage(state) : null;
    if (res && res.ok) notify('背包扩到 ' + res.pages + ' 页 · 花了 ' + res.cost + ' 铜币', true);
    else notify((res && res.reason) || '扩不了', false);
    persist();
    refresh();
  }

  // ---------------------------------------------------------------- 批量出售（§4.6.1）
  function enterBatch() {
    batch = { sel: {} };
    hideTip();
    refresh();
  }

  function exitBatch() {
    batch = null;
    hideTip();
    refresh();
  }

  /**
   * 真正会被卖掉的 uid 列表 = 玩家勾的 ∩ 逻辑层允许的（duplicateUids）。
   *
   * 「每件至少留 1 件」这条约束由 logic.sellBatch 强制，这里**也算一遍**，
   * 只为了让确认条上的件数与总价和实际结算一致 —— 显示 12 件却只扣 9 件，
   * 玩家会以为钱算错了。
   */
  function effectiveSelection() {
    const L = logic();
    if (!batch) return [];
    const allowed = (L && typeof L.sellableUids === 'function')
      ? L.sellableUids(state) : [];
    const allow = {};
    allowed.forEach(function (u) { allow[u] = true; });
    const out = [];
    bagOf().forEach(function (e) {
      if (batch.sel[e.uid] && allow[e.uid] && !isWorn(e.id)) out.push(e.uid);
    });
    return out;
  }

  function batchTotals() {
    const uids = effectiveSelection();
    let total = 0;
    const bag = bagOf();
    const byUid = {};
    bag.forEach(function (e) { byUid[e.uid] = e; });
    uids.forEach(function (u) {
      const e = byUid[u];
      if (e) total += sellValueOf(e);
    });
    return { count: uids.length, total: total, uids: uids };
  }

  function toggleSel(entry) {
    if (!batch) return;
    if (isWorn(entry.id)) {
      notify('穿在身上的先卸下才能卖', false);
      return;
    }
    if (copiesOf(entry.id) < 2) {
      notify('每件至少留一件：这是最后一个 ' +
             ((defOf(entry.id) || {}).name || entry.id), false);
      return;
    }
    if (batch.sel[entry.uid]) delete batch.sel[entry.uid];
    else batch.sel[entry.uid] = true;
    refresh();
  }

  function pickBy(kind) {
    if (!batch) return;
    const L = logic();
    const sel = {};
    if (kind === 'all') {
      const all = bagOf();
      const allOn = all.length > 0 && all.every(function (e) {
        return batch.sel[e.uid] || isWorn(e.id) || copiesOf(e.id) < 2;
      });
      if (!allOn) {
        all.forEach(function (e) {
          if (!isWorn(e.id) && copiesOf(e.id) >= 2) sel[e.uid] = true;
        });
      }
      batch.sel = sel;
    } else if (kind === 'dups') {
      // 「勾选全部重复件」：逻辑层已经算好"每 id 留等级最高的一件"，直接用
      const uids = (L && typeof L.sellableUids === 'function')
        ? L.sellableUids(state) : [];
      const bag = bagOf();
      const byUid = {};
      bag.forEach(function (e) { byUid[e.uid] = e; });
      uids.forEach(function (u) {
        const e = byUid[u];
        if (!e || isWorn(e.id)) return;
        sel[u] = true;
      });
      batch.sel = sel;
    } else {
      // 「勾选全部未穿戴基础件」：基础装备、没穿着的，且不是该 id 的最后一件
      bagOf().forEach(function (e) {
        const def = defOf(e.id);
        if (!def || def.kind !== 'base') return;
        if (isWorn(e.id) || copiesOf(e.id) < 2) return;
        sel[e.uid] = true;
      });
      batch.sel = sel;
    }
    refresh();
  }

  function runConfirm() {
    if (!batch) return;
    const totals = batchTotals();
    const L = logic();
    if (!totals.count) {
      notify('没有勾选可出售的装备', false);
      return;
    }
    const res = L && typeof L.sellBatch === 'function'
      ? L.sellBatch(state, totals.uids) : null;
    if (res && res.ok) {
      // 批量出售同样给成交音；数量写在 toast 里，声音只负责"成了"
      GameAudio.play('sell');
      notify('出售 ' + res.count + ' 件 · +' + res.total + ' 铜币', true);
    } else {
      notify((res && res.reason) || '没有可出售的装备', false);
    }
    batch = null;
    hideTip();
    persist();
    refresh();
  }

  function paintBatch() {
    if (!ui) return;
    const on = !!batch;
    if (ui.tools) ui.tools.classList.toggle('off', on);
    if (ui.batchBar) ui.batchBar.classList.toggle('on', on);
    if (ui.pageBar) ui.pageBar.classList.toggle('off', on);
    if (!on) return;
    const totals = batchTotals();
    if (ui.sum) {
      if (!bagOf().length) ui.sum.textContent = '背包是空的';
      else if (!totals.count) ui.sum.textContent = '未勾选可卖的装备';
      else ui.sum.textContent = '出售 ' + totals.count + ' 件 · 共 ' + totals.total + ' 铜币';
    }
    if (ui.confirmOk) ui.confirmOk.disabled = totals.count === 0;
  }

  // ---------------------------------------------------------------- 宿主回调
  /**
   * 装备签名：五个部位各是「id:等级」或「-」。
   * 用它判断"这次刷新是否伴随装备变化"，变了才回调宿主。
   */
  function equipSignature() {
    const eq = equipmentOf();
    return SLOT_ORDER.map(function (slot) {
      const it = eq[slot];
      return it && it.id ? it.id + ':' + (it.level || 1) : '-';
    }).join('|');
  }

  function syncEquipChange() {
    const sig = equipSignature();
    if (sig === equipSig) return;
    equipSig = sig;
    if (host && typeof host.onChange === 'function') host.onChange();
  }

  // ---------------------------------------------------------------- 位置
  /**
   * 夹边：left ∈ [0, viewW - w]、top ∈ [0, viewH - h]。
   *
   * 两个角都要夹。只夹左上角的话，窗口右下方向照样能把面板拖出屏幕 ——
   * 玩家拖出去一次就再也找不回来了。
   * 面板比可视区还大时 max 会算成负数，此时用 max(0, ...) 保证不越界到负坐标。
   */
  /**
   * resize 监听：面板**打开期间**窗口被缩小，必须重新夹边。
   *
   * 为什么必须：clamp() 原本只在 open() 与拖动时被调用，#bag 是 position:fixed，
   * left/top 一旦写成具体像素就跟着视口走。实测 1100 宽时开面板 left = 554，
   * 把窗口缩到 520 后矩形仍是 left 554 / right 1024 —— 面板整块落在视口外，
   * 玩家既看不到也点不到，只能再按一次 Tab 重开。（旧版同样如此，不是回归。）
   *
   * 为什么 close() 不解绑：解绑要写"只在真的关掉时移除"的条件分支，漏一次
   * 就是一个再也不夹边的面板；而每次重开都会再进 open()，所以注册一次就够。
   * 回调里必须判打开态：关闭时 #bag 是 display:none，offsetWidth 读到 0，
   * 那时 clamp() 会把 left/top 算到 0 —— 在看不见的面板上写一套错位坐标没有意义。
   */
  function onResize() {
    if (!opened) return;
    clamp();
  }

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
    // 标题栏上的按钮（关闭/整理/批量出售）不算把手，否则点按钮会顺手把面板拖两像素
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
  /**
   * 宿主场景注册回调（Task 8）。app.js 的 HubScene 用它把背包接到渲染层：
   *   onChange —— 装备变了，重刷主角图层（面板开着时 update 是早退的）
   *   onOpen / onClose —— 面板开合时冻结 / 恢复 update
   */
  function setHost(next) {
    host = next || null;
    // 换了宿主（场景重启）就当签名失效，下一次刷新重新通知一次
    equipSig = null;
  }

  function open(nextState, nextOpts) {
    if (nextState) state = nextState;
    if (nextOpts) opts = nextOpts;
    if (!ui && !build()) return false;
    // 窗口缩放要在开面板之后才管：注册一次，close() 不解绑（见 onResize）
    if (!resizeBound) {
      resizeBound = true;
      if (global.addEventListener) global.addEventListener('resize', onResize);
    }
    // 宿主只关心「关 -> 开」这一跳。重复 open() 是幂等的（只重置位置和分页），
    // 再通知一次 onOpen 会让宿主把已经被置成 true 的面板状态当成"打开前"，
    // 关背包时永远恢复成 true —— update() 从此早退，角色再也不动
    // （实测：连开两次 + 关一次，Hub 里按 D 位移 0px；只开一次则 150px）。
    const wasOpen = opened;
    opened = true;
    ui.root.classList.add('on');
    ui.root.setAttribute('aria-hidden', 'false');
    // 顺序要紧：先显示再量尺寸，display:none 的元素 offsetWidth 是 0。
    // 每次打开都回到默认位置（设计 §4.2：位置不持久化）—— 玩家拖到边角的
    // 位置一旦被记下来，窗口缩小后就会落在界外；夹边能救回来，但"打开就在
    // 一个奇怪的地方"不如"每次都在同一个地方"。
    placeDefault();
    page = 0;
    tab = 'all';
    batch = null;
    if (!wasOpen && host && typeof host.onOpen === 'function') host.onOpen();
    refresh();
    return true;
  }

  function close() {
    // 同理：只有真的从开到关才通知 onClose。已经关着再 close() 不该让宿主
    // 恢复一次面板状态，也不该触发一次 resume。
    const wasOpen = opened;
    opened = false;
    batch = null;
    hideTip();
    if (ui && ui.root) {
      ui.root.classList.remove('on');
      ui.root.setAttribute('aria-hidden', 'true');
    }
    // 拖到一半关闭：抓取光标必须撤掉，pointer capture 也必须释放 ——
    // 否则指针形状永久停在 grabbing，后续 pointermove 还在往标题栏喂。
    // 沿用 onUp 的 try/catch：capture 可能已经被浏览器自己释放了。
    if (ui && ui.bar) {
      ui.bar.classList.remove('grabbing');
      if (drag && drag.id !== undefined && ui.bar.releasePointerCapture) {
        try { ui.bar.releasePointerCapture(drag.id); } catch (err) { /* 已释放 */ }
      }
    }
    drag = null;
    if (wasOpen && host && typeof host.onClose === 'function') host.onClose();
    return true;
  }

  function isOpen() { return opened; }

  global.BagHud = {
    open: open,
    close: close,
    refresh: function () { refresh(); },
    isOpen: isOpen,
    clamp: clamp,
    setHost: setHost,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
