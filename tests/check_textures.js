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

const made = new Set([...src.matchAll(/generateTexture\(\s*'([a-zA-Z]+)'/g)].map((m) => m[1]));
// 引擎内建纹理，不需要我们自己生成
const BUILTIN = new Set(['__DEFAULT', '__MISSING', '__WHITE']);

const used = new Map();
const record = (key, where) => {
  if (BUILTIN.has(key)) return;
  if (!used.has(key)) used.set(key, where);
};
for (const m of src.matchAll(/\.add\.(?:image|sprite)\([^)]*?'([a-zA-Z]+)'/g)) record(m[1], 'add.image');
for (const m of src.matchAll(/add\.particles\([^)]*?'([a-zA-Z]+)'/g)) record(m[1], 'add.particles');
for (const m of src.matchAll(/setTexture\('([a-zA-Z]+)'\)/g)) record(m[1], 'setTexture');
// 纹理 key 也常通过变量传递（例如 `let key = 'bladeA'; add.image(x, 0, key)`）。
// 只扫字面量会把这些误报成"未被引用"，所以把字符串赋值也算进来。
for (const m of src.matchAll(/(?:key|tex|texture)\s*=\s*'([a-zA-Z]+)'/g)) record(m[1], 'assignment');
// 敌人种类来自 config，其 kind 值即纹理 key
for (const m of src.matchAll(/kind:\s*'([a-zA-Z]+)'/g)) record(m[1], 'enemy kind');
for (const m of src.matchAll(/\{\s*[a-z]+:\s*\{[^}]*?name:[^}]*?\}/g)) { /* noop */ }

const missing = [...used.keys()].filter((k) => !made.has(k));

console.log(`  已生成纹理: ${made.size}`);
console.log(`  被引用纹理: ${used.size}`);
console.log(`  未被引用（可清理）: ${[...made].filter((k) => !used.has(k)).join(', ') || '无'}`);

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
