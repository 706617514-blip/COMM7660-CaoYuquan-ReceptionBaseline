/**
 * electron/preload.js — 当前故意是空的。
 *
 * 为什么留一个空文件
 * ------------------
 * 游戏跑在 contextIsolation: true 的渲染进程里，按这个架构，
 * 任何"页面要访问宿主能力"的需求都必须经过 preload 用 contextBridge
 * 显式暴露。现在游戏**一个这样的需求都没有**：
 *
 *   - 存档走 localStorage（profile.js 的注入式设计，把存储对象当参数传），
 *     在 Electron 里 localStorage 落到用户数据目录，重启仍在 —— 已满足
 *     验收判据 E3，不需要文件系统 API。
 *   - 游戏是纯静态资源，不需要读磁盘上的其他文件。
 *   - 不联网，不需要网络代理。
 *
 * 所以这里不暴露任何东西。留这个文件是为了：
 *   1. main.js 的 webPreferences 将来若加 preload 路径，文件已存在；
 *   2. 明确记录"当前没有任何宿主接口"这个事实，避免下一个人以为
 *      漏配了 preload 而顺手打开 nodeIntegration。
 *
 * 如果将来真要在存档层改用文件存储（把 profile.js 的注入对象从
 * localStorage 换成 IPC 到主进程），正确做法是**在这里**用
 * contextBridge.exposeInMainWorld 暴露一组收窄的读写方法，
 * 而不是打开 nodeIntegration。
 */

'use strict';

// 有意为空：见文件头的说明。
