/**
 * tests/check_textures.js — 静态检查：场景引用的每个纹理都必须被生成过。
 *
 * 为什么需要它
 * ------------
 * 重做贴图时我删掉了 glow 与 acid 两个纹理，但场景仍在引用它们。
 * Phaser 对未知 key 不报错，而是渲染默认的 missing-texture ——
 * 画面上表现为四个绿色方框盖在设施下面。
 * 控制台零错误、测试全绿，只有看图才能发现。
 *
 * 这类问题不该靠人眼兜底。纯静态扫描即可抓住。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'game', 'app.js'), 'utf-8');

// 纹理 key 允许小写字母、数字与短横线 —— 装备层用 'eq-<slot>-<id>' 命名，
// 只匹配 [a-zA-Z]+ 的话这 35 张贴图**完全不进入检查范围**，
// 而它们恰恰是最容易拼错的（key 是运行时用 slot 与 id 拼出来的）。
const KEY_RE = "[A-Za-z0-9_-]+";
const made = new Set(
  [...src.matchAll(new RegExp(`generateTexture\\(\\s*'(${KEY_RE})'`, 'g'))].map((m) => m[1]));
// 引擎内建纹理，不需要我们自己生成
const BUILTIN = new Set(['__DEFAULT', '__MISSING', '__WHITE']);

const used = new Map();
const record = (key, where) => {
  if (BUILTIN.has(key)) return;
  if (!used.has(key)) used.set(key, where);
};
for (const m of src.matchAll(new RegExp(`\\.add\\.(?:image|sprite)\\([^)]*?'(${KEY_RE})'`, 'g'))) record(m[1], 'add.image');
for (const m of src.matchAll(new RegExp(`add\\.particles\\([^)]*?'(${KEY_RE})'`, 'g'))) record(m[1], 'add.particles');
for (const m of src.matchAll(new RegExp(`setTexture\\('(${KEY_RE})'`, 'g'))) record(m[1], 'setTexture');
// 纹理 key 也常通过变量传递（例如 `let key = 'bladeA'; add.image(x, 0, key)`）。
// 只扫字面量会把这些误报成"未被引用"，所以把字符串赋值也算进来。
for (const m of src.matchAll(new RegExp(`(?:key|tex|texture)\\s*=\\s*'(${KEY_RE})'`, 'g'))) record(m[1], 'assignment');
// 敌人种类来自 config，其 kind 值即纹理 key
for (const m of src.matchAll(/kind:\s*'([a-zA-Z]+)'/g)) record(m[1], 'enemy kind');

// Boss 贴图是从 PNG **加载**的（load.image），不是 generateTexture 生成的，
// 而 key 同样在运行时拼出来（'boss_' + tier + '_' + dir）。
// 所以这里把它们登记为"已提供"，否则会报成缺失。
const loaded = new Set();
for (const m of src.matchAll(new RegExp(`load\\.image\\(\\s*[^,]+,\\s*'([^']+)'`, 'g'))) {
  loaded.add(m[1]);
}
// 运行时拼接的 boss key：显式按同样的规则展开，避免"正则匹配到半个 key"。
['normal', 'hard', 'hell'].forEach((t) => {
  ['right', 'left'].forEach((d) => loaded.add('boss_' + t + '_' + d));
});
loaded.forEach((k) => made.add(k));
// 拼接过半截 key 的匹配（'boss_'、'boss_normal_'）不是真实纹理 key，剔除
for (const k of [...used.keys()]) {
  if (k.endsWith('_') && [...used.keys()].some((o) => o !== k && o.startsWith(k))) used.delete(k);
}
for (const m of src.matchAll(/\{\s*[a-z]+:\s*\{[^}]*?name:[^}]*?\}/g)) { /* noop */ }

// ---- 装备分层贴图：key 是运行时拼的，静态正则扫不到 ----
// equipLayer('eq-...') 里 generateTexture 收到的是**变量**，所以上面的
// generateTexture 字面量扫描看不到这些 key —— 必须单独把 equipLayer
// 的调用点抓出来，否则 35 件装备全部会被误报成"缺少贴图"。
for (const m of src.matchAll(new RegExp(`equipLayer\\('(${KEY_RE})'`, 'g'))) made.add(m[1]);
// refreshHeroEquip 里生成 'eq-<slot>-<id>'，所以必须按配置逐件展开比对。
// 不做这一步的话，把某件装备的贴图名打错（或漏画一件）会完全静默：
// 玩家穿上那件装备后什么都不显示，控制台零报错，正是这个测试要防的故障。
const cfgSrc = fs.readFileSync(path.join(__dirname, '..', 'game', 'config.js'), 'utf-8');
const equipKeys = [];
{
  // 从 config 里取 EQUIPMENT 与 EQUIP_FX 两张表里的 id 与 slot。
  // 用 eval 太脆，这里用一个极小的沙箱 require。
  const C = require(path.join(__dirname, '..', 'game', 'config.js'));
  Object.keys(C.ALL_EQUIPMENT).forEach((id) => {
    const def = C.equipDef(id);
    equipKeys.push({ id: id, slot: def.slot, key: 'eq-' + def.slot + '-' + id });
  });
}
const equipMissing = equipKeys.filter((e) => !made.has(e.key));
// 这些 key 是被 refreshHeroEquip 动态引用的，登记为"已引用"，
// 否则会把 35 件装备全刷进"可清理"列表，报告噪声盖过真正的信号。
equipKeys.forEach((e) => { if (!used.has(e.key)) used.set(e.key, 'refreshHeroEquip'); });

const missing = [...used.keys()].filter((k) => !made.has(k));

if (equipMissing.length) {
  console.log('');
  equipMissing.forEach((e) => {
    console.log(`  FAIL  装备 ${e.id}（${e.slot}）没有对应的分层贴图 '${e.key}'`);
    console.log(`         穿上后该部位不会显示任何东西，且 Phaser 不会报错。`);
  });
  console.log('');
  console.log(`失败：${equipMissing.length} 件装备缺少贴图`);
  process.exit(1);
}
console.log(`  装备分层贴图: ${equipKeys.length} 件全部有对应贴图 ✓`);

// generated 与 loaded 分开统计：loaded（PNG）本来就不会出现在 used 里，
// 混在一起会把"可清理"列表刷满 boss 贴图，报告就没法读了。
const generated = new Set([...made].filter((k) => !loaded.has(k)));
console.log(`  已生成纹理: ${generated.size}`);
console.log(`  已加载纹理: ${loaded.size}`);
console.log(`  被引用纹理: ${used.size}`);
console.log(`  未被引用（可清理）: ${[...generated].filter((k) => !used.has(k)).join(', ') || '无'}`);

if (missing.length) {
  console.log('');
  for (const k of missing) {
    console.log(`  FAIL  引用了未生成的纹理 '${k}'（${used.get(k)}）`);
    console.log(`         Phaser 会渲染 missing-texture —— 画面上是绿色/白色方框，控制台不报错。`);
  }
  console.log('');
  console.log(`失败：${missing.length} 个纹理缺失`);
  process.exit(1);
}
console.log('');
console.log('全部纹理都已生成 ✓');
