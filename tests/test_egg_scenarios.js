/**
 * test_egg_scenarios.js — PM 描述的**两种顺序**的场景验证（Task 3.1）。
 *
 * 为什么单独一个文件，而不是并进 test_egg.js
 * -------------------------------------------
 * test_egg.js 测的是"函数对不对"（单元），本文件测的是
 * "PM 描述的那个体验走不走得通"（场景）。两者失败时的排查方向不同：
 *   test_egg 红了 → 去看 eggEligible / dropEgg
 *   本文件红了 → 去看触发点接得对不对、顺序有没有覆盖到
 *
 * PM 的原话（设计文档 D1）：
 *   "我先把熔炉关卡通过了，再去挑战地狱boss，把地狱boss打死的那一刻，
 *    才会掉落彩蛋；或者，我先打败了地狱boss（此时熔炉关卡是未首通的情况），
 *    再去打熔炉关卡，杀死最后一只怪物时掉落彩蛋"
 *
 * 两种顺序的落点不同（Boss 尸体 vs 最后一只怪），这是本文件的重点。
 *
 * ⚠️ 本文件的模拟方式：先手动置位"此前已达成的那一个成就"，
 * 再在触发点模拟"本局成就置位 + 掉蛋"这两步 —— 与 logic 里的真实顺序一致。
 * 不要在本局开始前就把两个成就都设上：那样测不出"第二个达成的那一刻"。
 */
const path = require('path');
const L = require(path.join('/Users/f1gment/Documents/7660','game','logic.js'));

function report(label, cond, detail) {
  console.log(`  ${cond ? '✅' : '❌'}  ${label}${detail ? '  — ' + detail : ''}`);
  return cond;
}
let allOk = true;

console.log('=== 顺序一：先通关熔炉 → 再打赢地狱 Boss ===');
{
  const s = L.createState();
  s.meta.clearedForge = true;            // 玩家此前已通关熔炉
  const run = L.startRun(s, 'forge');
  run.isBossRun = true;
  run.bossTier = 'hell';
  // 模拟 killEnemy 在 Boss 死时的动作：先置位本局成就，再尝试掉蛋
  s.meta.beatHellBoss = true;
  // 模拟 Boss 在 (420, 160) 被击杀
  const dropped = L.dropEgg(s, run, 420, 160);
  allOk &= report('彩蛋掉落', dropped === true);
  allOk &= report('落点 = Boss 尸体处 (420,160)',
                  run.egg && run.egg.x === 420 && run.egg.z === 160,
                  run.egg ? `(${run.egg.x},${run.egg.z})` : '无');
  allOk &= report('不在 pickups 里（免疫 collectAll）',
                  !(run.pickups||[]).some(p=>p.kind==='egg'));
  L.collectAll(s, run);
  allOk &= report('清波吸走后彩蛋仍在', !!run.egg && !run.egg.taken);
  allOk &= report('eggFound 已置位', s.meta.eggFound === true);
}

console.log('');
console.log('=== 顺序二：先打赢地狱 Boss → 再通关熔炉 ===');
{
  const s = L.createState();
  s.meta.beatHellBoss = true;            // 玩家此前已打赢地狱
  const run = L.startRun(s, 'forge');
  run.lastKillX = 300; run.lastKillZ = 90;   // 最后一只怪死在这
  // 模拟 stepWave 通关时的动作：先置位本局成就，再尝试掉蛋
  s.meta.clearedForge = true;
  const dropped = L.dropEgg(s, run, run.lastKillX, run.lastKillZ);
  allOk &= report('彩蛋掉落', dropped === true);
  allOk &= report('落点 = 最后一只怪处 (300,90)',
                  run.egg && run.egg.x === 300 && run.egg.z === 90,
                  run.egg ? `(${run.egg.x},${run.egg.z})` : '无');
}

console.log('');
console.log('=== 不该掉的情况 ===');
{
  const s = L.createState();
  const run = L.startRun(s, 'forge');
  allOk &= report('两个成就都没有 → 不掉', L.dropEgg(s, run, 100, 100) === false);

  s.meta.clearedForge = true;            // 只有一个
  const run2 = L.startRun(s, 'forge');
  allOk &= report('只有熔炉成就 → 不掉', L.dropEgg(s, run2, 100, 100) === false);

  s.meta.beatHellBoss = true;            // 两个都有
  const run3 = L.startRun(s, 'forge');
  allOk &= report('两个都有 → 掉', L.dropEgg(s, run3, 100, 100) === true);

  const run4 = L.startRun(s, 'forge');   // 已经掉过了
  allOk &= report('已掉过 → 不再掉（D3）', L.dropEgg(s, run4, 100, 100) === false);
}

console.log('');
console.log('=== 拾取与纸条 ===');
{
  const s = L.createState();
  s.meta.clearedForge = true; s.meta.beatHellBoss = true;
  const run = L.startRun(s, 'forge');
  L.dropEgg(s, run, 500, 100);
  run.player.x = 520; run.player.z = 110;   // 走近
  allOk &= report('走近后在可拾取范围', L.eggInReach(s, run) === true);
  run.player.x = 100;                        // 走远
  allOk &= report('走远后不在范围', L.eggInReach(s, run) === false);
  run.player.x = 500; run.player.z = 100;
  const r = L.takeEgg(s, run);
  allOk &= report('按 J 拾取成功', r.ok === true);
  allOk &= report('返回纸条文字', typeof r.text === 'string' && r.text.length > 0);
  console.log('');
  console.log('  纸条内容：');
  r.text.split('\n').forEach(l => console.log('    ' + l));
}

console.log('');
console.log(allOk ? '全部通过 ✓' : '有失败项 ✗');
process.exit(allOk ? 0 : 1);
