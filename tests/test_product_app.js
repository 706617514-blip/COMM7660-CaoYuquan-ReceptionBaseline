#!/usr/bin/env node
/**
 * test_product_app.js — 对 product/index.html 的页面逻辑做功能测试。
 *
 * 为什么需要它
 * ------------
 * 百分位算法可以用 Node 单独验，但页面还有一半逻辑在 DOM 接线里：
 * 事件绑定、错误分支、重置、图表绘制。Quick Look 之类的静态渲染器**不执行 JS**，
 * 所以从截图看不出这些有没有坏。这里用一个最小 DOM 替身真正跑一遍页面脚本，
 * 断言渲染结果，把"逻辑对"和"接线对"一起验证。
 *
 * 不依赖任何 npm 包。运行：
 *   node tests/test_product_app.js
 * 退出码 0 = 全部通过。
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const HTML_PATH = path.join(ROOT, "product", "index.html");
const DATA_PATH = path.join(ROOT, "product", "reference-data.js");

let failures = 0;
let checks = 0;

function ok(cond, label, detail) {
  checks++;
  if (cond) {
    console.log("  PASS  " + label);
  } else {
    failures++;
    console.log("  FAIL  " + label + (detail ? "  -> " + detail : ""));
  }
}

/* ---------------------------------------------------------------- DOM 替身 */

function makeElement(id) {
  const el = {
    id: id,
    value: "",
    style: {},
    _listeners: {},
    _classes: new Set(),
    classList: {
      add: function (c) { el._classes.add(c); },
      remove: function (c) { el._classes.delete(c); },
      contains: function (c) { return el._classes.has(c); },
    },
    addEventListener: function (ev, fn) {
      (el._listeners[ev] = el._listeners[ev] || []).push(fn);
    },
    focus: function () { el._focused = true; },
    fire: function (ev) {
      (el._listeners[ev] || []).forEach(function (fn) { fn(); });
    },
  };

  // 浏览器里 innerHTML 与 textContent 是联动的：写入 innerHTML 后读 textContent
  // 会得到去标签后的文本。替身若把两者做成互不相干的普通属性，
  // 用 innerHTML 写入的文案在断言里就是空的，会把产品缺陷误报出来。
  let html = "", text = "";
  Object.defineProperty(el, "innerHTML", {
    get: function () { return html; },
    set: function (v) { html = String(v); },
    enumerable: true,
  });
  Object.defineProperty(el, "textContent", {
    get: function () {
      return html ? html.replace(/<[^>]*>/g, "") : text;
    },
    set: function (v) { text = String(v); html = ""; },
    enumerable: true,
  });
  return el;
}

function installDom(html) {
  const ids = new Set();
  const re = /\sid="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) ids.add(m[1]);

  const els = {};
  ids.forEach(function (id) {
    els[id] = makeElement(id);
  });

  // 模仿浏览器：把 <input value="75"> 的初始值填进替身。
  // 少了这一步，页面脚本首次渲染会读到空值，测试就会把环境缺陷误报成产品缺陷。
  const inputRe = /<input\b([^>]*)>/g;
  let im;
  while ((im = inputRe.exec(html))) {
    const attrs = im[1];
    const idMatch = /\sid="([^"]+)"/.exec(attrs);
    if (!idMatch) continue;
    const el = els[idMatch[1]];
    if (!el) continue;
    const val = /\svalue="([^"]*)"/.exec(attrs);
    if (val) el.value = val[1];
    const type = /\stype="([^"]+)"/.exec(attrs);
    el.type = type ? type[1] : "text";
  }

  globalThis.document = {
    getElementById: function (id) {
      if (!els[id]) throw new Error("页面脚本访问了不存在的元素 id: " + id);
      return els[id];
    },
    body: { innerHTML: "" },
  };
  return els;
}

/* ------------------------------------------------------------------ 加载 */

const html = fs.readFileSync(HTML_PATH, "utf8");
const els = installDom(html);

globalThis.window = globalThis;
// 数据文件写的是 window.REFERENCE_DATA
eval(fs.readFileSync(DATA_PATH, "utf8"));
if (!globalThis.REFERENCE_DATA) {
  console.error("数据文件未定义 window.REFERENCE_DATA");
  process.exit(1);
}

// 取出页面里最后一段内联脚本（即应用本身）并执行
const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  .map(function (m) { return m[1]; })
  .filter(function (s) { return s.trim().length > 200; });

if (inline.length !== 1) {
  console.error("期望恰好 1 段内联应用脚本，实际 " + inline.length + " 段");
  process.exit(1);
}

console.log("=== 1. 页面脚本执行 ===");
try {
  eval(inline[0]);
  ok(true, "应用脚本无异常执行完毕");
} catch (e) {
  ok(false, "应用脚本执行", e.message);
  console.log("\n检查未通过：" + failures + " 项失败");
  process.exit(1);
}

/* ------------------------------------------------------- 2. 首次渲染 */

console.log("\n=== 2. 打开即渲染默认值 ===");
const p0Text = els.pctNum.textContent;
const p0 = Number(p0Text);
ok(els.pctNum.textContent !== "" && isFinite(p0), "百分位已渲染", els.pctNum.textContent);
ok(els.pctSuffix.textContent === "百分位", "百分位单位已渲染");
ok(p0 > 0 && p0 < 100, "默认 75% 的百分位在开区间内", String(p0));
ok(/低于市场多数作品/.test(els.verdict.textContent) ||
   /略低于市场中位数/.test(els.verdict.textContent),
   "解读文案已渲染", els.verdict.textContent.slice(0, 40));
ok(/159/.test(els.countline.textContent), "参照集数量已渲染", els.countline.textContent);
ok(/款低于你的预期/.test(els.countline.textContent), "低于计数已渲染");
ok(els.chart.innerHTML.indexOf("<rect") >= 0, "直方图已绘制柱形");
ok(els.chart.innerHTML.indexOf("<line") >= 0, "已绘制轴上标记线");
ok(els.chart.innerHTML.indexOf("你 ") >= 0, "已标注用户位置");
ok(/市场均值/.test(els.stats.innerHTML), "分布统计已渲染");
ok(els.refdesc.textContent.length > 0, "页脚参照集描述已填充");
ok(els.srcpath.textContent === globalThis.REFERENCE_DATA.source.dataset,
   "页脚数据集路径已填充");
ok(/…$/.test(els.srchash.textContent), "页脚 sha256 已截断显示");
ok(els.err.textContent === "" && !els.err._classes.has("on"), "初始无错误提示");

/* --------------------------------------------- 3. 单调性（走真实输入路径） */

console.log("\n=== 3. 通过输入事件验证严格单调 ===");
let prev = -1, drops = 0, emptyAt = null;
for (let v = 0; v <= 100; v++) {
  els.num.value = String(v);
  els.num.fire("input");
  const p = Number(els.pctNum.textContent);
  if (!isFinite(p)) { emptyAt = v; break; }
  if (p < prev) drops++;
  prev = p;
}
ok(emptyAt === null, "0–100 每个整数都返回了百分位", emptyAt === null ? "" : "在 " + emptyAt + " 处为空");
ok(drops === 0, "百分位随输入单调不减", drops + " 处下降");
ok(Number(els.pctNum.textContent) === 100, "输入 100 时百分位为 100", els.pctNum.textContent);

/* -------------------------------------------------- 4. 错误分支 */

console.log("\n=== 4. 超范围与非法输入必须报错，而非静默失败 ===");
function expectError(value, label) {
  els.num.value = value;
  els.num.fire("input");
  const on = els.err._classes.has("on");
  const hasMsg = els.err.textContent.length > 0;
  const cleared = els.pctNum.textContent === "—" && els.chart.innerHTML === "";
  ok(on && hasMsg && cleared, label,
     "class=" + on + " msg=" + JSON.stringify(els.err.textContent) +
     " cleared=" + cleared);
}
expectError("150", "输入 150 报错并清空结果");
expectError("-5", "输入 -5 报错并清空结果");
expectError("abc", "输入非数字报错并清空结果");
expectError("", "输入空值报错并清空结果");

els.num.value = "80";
els.num.fire("input");
ok(!els.err._classes.has("on") && els.err.textContent === "", "恢复合法输入后错误被清除");
ok(els.pctNum.textContent !== "—", "恢复合法输入后结果重新渲染");

/* --------------------------------------------------------- 5. 重置 */

console.log("\n=== 5. 重置 ===");
els.num.value = "12";
els.num.fire("input");
const beforeReset = els.pctNum.textContent;
els.reset.fire("click");
ok(els.num.value === "75", "重置把输入恢复为 75", els.num.value);
ok(els.rng.value === "75", "重置把滑杆恢复为 75", els.rng.value);
ok(els.pctNum.textContent !== beforeReset, "重置后结果确实变化");
ok(els.num._focused === true, "重置后焦点回到数字输入框");
ok(els.pctNum.textContent === p0Text, "重置后的结果与首次打开一致",
   els.pctNum.textContent + " vs " + p0Text);

/* --------------------------------------------- 6. 滑杆与数字框同步 */

console.log("\n=== 6. 滑杆与数字输入同步 ===");
els.rng.value = "40";
els.rng.fire("input");
ok(els.num.value === "40", "拖动滑杆同步数字框", els.num.value);
els.num.value = "60";
els.num.fire("input");
ok(els.rng.value === "60", "输入数字同步滑杆", els.rng.value);

/* ------------------------------------------------ 7. 无持久化 */

console.log("\n=== 7. 刷新必须回到初始状态 ===");
ok(!/\blocalStorage\b/.test(html.replace(/\/\*[\s\S]*?\*\//g, "")),
   "代码中没有 localStorage（注释除外）");
ok(!/\bsessionStorage\b/.test(html.replace(/\/\*[\s\S]*?\*\//g, "")),
   "代码中没有 sessionStorage");

/* -------------------------------------------- 8. 界面无分类输入 */

console.log("\n=== 8. 界面不含条件筛选输入 ===");
// 只检查**输入控件**，不扫正文用词：披露段落里本来就写着
// "本工具不按品类或付费模式分类"，按关键词扫正文会把这句正确的话误判成违规。
const bodyNoScript = html.replace(/<script[\s\S]*?<\/script>/g, "");
const countOf = function (re) { return (bodyNoScript.match(re) || []).length; };

// 断言从"没有任何下拉控件"改为"下拉控件只用于视图选项"。
// 原来的断言是在产品还没有视图选项时写的；真正要防的风险从来不是"有没有 select"，
// 而是"有没有一个会改变答案的属性输入"。所以直接检查每个 select 的选项语义。
ok(countOf(/<select\b/gi) === 2, "下拉控件恰好 2 个（显示数量 + 评论数下界）",
   "实际 " + countOf(/<select\b/gi));
ok(countOf(/type="checkbox"/gi) === 0, "没有复选框");
ok(countOf(/type="radio"/gi) === 0, "没有单选框");
ok(countOf(/<input\b/gi) === 2, "输入控件恰好 2 个（滑杆 + 数字框）",
   "实际 " + countOf(/<input\b/gi));
ok(countOf(/type="range"/gi) === 1, "其中 1 个是滑杆");
ok(countOf(/type="number"/gi) === 1, "其中 1 个是数字框");
ok(countOf(/<button\b/gi) === 1, "按钮恰好 1 个（重置）");

// 每个 <select> 的 <option> 值都不许是品类/商业模式/年龄
const selectBlocks = bodyNoScript.match(/<select\b[\s\S]*?<\/select>/gi) || [];
const badOptions = selectBlocks.filter(function (blk) {
  return /genre|categor|品类|action|indie|rpg|strategy|simulation|adventure|racing|sports|casual|is_free|free[_-]?to[_-]?play|付费|免费|age|上线时长|发行年龄/i
    .test(blk.replace(/id="[^"]*"/g, ""));
});
ok(badOptions.length === 0, "下拉选项里没有品类/商业模式/年龄语义（只允许数量与评论数下界）",
   badOptions.join(" | ").slice(0, 120));

const inputTags = bodyNoScript.match(/<input\b[^>]*>/gi) || [];
const suspect = inputTags.filter(function (t) {
  return /genre|categor|品类|is_free|free[_-]?to[_-]?play|business|model/i.test(t);
});
ok(suspect.length === 0, "输入控件的属性里没有品类/商业模式语义", suspect.join(" | "));

const headerEnd = bodyNoScript.indexOf("</header>");
const firstInput = bodyNoScript.search(/<input\b/i);
const disclIdx = bodyNoScript.indexOf("本工具不按品类或付费模式分类");
ok(disclIdx >= 0, "非条件化披露文案存在");
ok(disclIdx >= 0 && disclIdx < headerEnd, "披露位于 <header> 内");
ok(disclIdx >= 0 && disclIdx < firstInput, "披露先于任何输入控件出现");

/* ------------------------------------------------ 9. 媒体发现面板 */

console.log("\n=== 9. 同类作品发现（media discovery）===");
els.num.value = "75";
els.num.fire("input");
const listHtml = els.cmpListHtml = els["cmp-list"].innerHTML;
const liCount = (listHtml.match(/<li>/g) || []).length;
ok(liCount === 10, "列出 10 款作品", "实际 " + liCount);
ok(els["cmp-hint"].textContent.length > 0, "列表说明文案已渲染");
ok((listHtml.match(/store\.steampowered\.com\/app\//g) || []).length === 10,
   "每款作品都链到自己的 Steam 商店页");
ok(/target="_blank"/.test(listHtml), "链接在新标签打开");
ok(/rel="noopener noreferrer"/.test(listHtml), "外部链接带 noopener（防 window.opener 攻击）");

// 列表必须按"离用户预期最近"排序
const D = globalThis.REFERENCE_DATA;
const want = D.titles.slice()
  .sort(function (a, b) {
    return Math.abs(a.positive_rate - 0.75) - Math.abs(b.positive_rate - 0.75);
  })
  .slice(0, 10)
  .map(function (t) { return t.appid; });
const got = [...listHtml.matchAll(/store\.steampowered\.com\/app\/(\d+)\//g)]
  .map(function (m) { return m[1]; });
ok(JSON.stringify(got) === JSON.stringify(want),
   "排序为'离输入值最近'而非随机", "got " + got.join(",") + " want " + want.join(","));

// 换输入必须换列表
els.num.value = "95";
els.num.fire("input");
const listHtml2 = els["cmp-list"].innerHTML;
ok(listHtml2 !== listHtml, "改变输入后列表随之变化");

/* ------------------------ 10. 视图选项不得改变"答案" ------------------------ */

console.log("\n=== 10. 视图选项只动列表，不动百分位 ===");
els.num.value = "75";
els.num.fire("input");
const pctBefore = els.pctNum.textContent;

// 改"显示数量"：9 个组合，百分位必须一次都不变
let pctDrift = 0, listSawCount = {};
[5, 10, 20].forEach(function (c) {
  els["count"].value = String(c);
  els["count"].fire("change");
  if (els.pctNum.textContent !== pctBefore) pctDrift++;
  listSawCount[c] = (els["cmp-list"].innerHTML.match(/<li>/g) || []).length;
});
ok(pctDrift === 0, "改显示数量：百分位保持不变", "漂移 " + pctDrift + " 次");
ok(listSawCount[5] === 5 && listSawCount[10] === 10 && listSawCount[20] === 20,
   "改显示数量：列表条数随之变化", JSON.stringify(listSawCount));

// 改"评论数下界"：百分位同样必须不变
let pctDrift2 = 0, filters = {};
[50, 200, 500, 1000].forEach(function (f) {
  els["minrev"].value = String(f);
  els["minrev"].fire("change");
  if (els.pctNum.textContent !== pctBefore) pctDrift2++;
  const pool = D.titles.filter(function (t) { return t.total_reviews >= f; });
  const html = els["cmp-list"].innerHTML;
  const ids = [...html.matchAll(/store\.steampowered\.com\/app\/(\d+)\//g)]
    .map(function (m) { return m[1]; });
  // 列表里每一款都必须真的满足该下界
  const byId = {};
  D.titles.forEach(function (t) { byId[String(t.appid)] = t; });
  filters[f] = {
    pool: pool.length,
    allMeetFloor: ids.every(function (id) { return byId[id].total_reviews >= f; }),
    hasShiftNotice: els["cmp-shift"].innerHTML.length > 0
  };
});
ok(pctDrift2 === 0, "改评论数下界：百分位保持不变", "漂移 " + pctDrift2 + " 次");
ok(Object.keys(filters).every(function (f) { return filters[f].allMeetFloor; }),
   "列表里每款作品都满足所选评论数下界", JSON.stringify(filters));
ok(!filters[50].hasShiftNotice, "下界为不限时不显示过滤偏移提示");
ok(filters[500].hasShiftNotice, "下界为 ≥500 时显示过滤偏移提示");
ok(/不是中性的筛选/.test(els["cmp-shift"].innerHTML),
   "偏移提示明确说明这**不是中性筛选**");

// 过滤后的池子必须真的比整体更乐观（否则那段提示就是错的）
const meanOfPool = function (f) {
  const p = D.titles.filter(function (t) { return t.total_reviews >= f; });
  return p.reduce(function (a, t) { return a + t.positive_rate; }, 0) / p.length;
};
ok(meanOfPool(500) > meanOfPool(50),
   "≥500 的均值确实高于全体（提示里的方向是对的）",
   meanOfPool(500).toFixed(4) + " vs " + meanOfPool(50).toFixed(4));

// 重置必须把两个视图选项也复位
els["count"].value = "20";
els["minrev"].value = "1000";
els.reset.fire("click");
ok(els["count"].value === "10" && els["minrev"].value === "50",
   "重置把视图选项复位为默认",
   els["count"].value + " / " + els["minrev"].value);

// 标题必须转义，不能把原始文本当 HTML 注入
ok(!/<script/i.test(listHtml) && !/onerror=/i.test(listHtml),
   "列表内容经 HTML 转义（无注入）");

/* ------------------------------------------------------------- 汇总 */

console.log("\n" + "=".repeat(48));
if (failures === 0) {
  console.log("全部通过：" + checks + " 项断言");
  process.exit(0);
}
console.log("失败 " + failures + " / " + checks + " 项断言");
process.exit(1);
