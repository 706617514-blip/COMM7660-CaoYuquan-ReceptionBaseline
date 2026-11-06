/**
 * profile.js — 每个玩家各自独立的游戏数据。
 *
 * 为什么这样做
 * -----------
 * 这是一个纯静态页面，没有服务器，所以"每个玩家有自己的数据"只能落在浏览器本地。
 * 做法是**多档案 + 可导出的存档码**：
 *   - 同一台电脑上，不同玩家各自一个档案，互不覆盖
 *   - 换设备时用一段存档码搬移进度（不需要账号，也不需要后端）
 *
 * 必须说清的边界：没有后端，就无法做到"同一账号在任意设备自动同步"，
 * 也无法防止玩家改自己的本地存档。这是静态站点的固有限制，不是偷懒。
 *
 * 纯模块：不碰 DOM、不碰 localStorage，存储对象由调用方注入，因此可测。
 */
(function (global) {
  'use strict';

  const NS = 'emberfield';
  const INDEX_KEY = NS + '.profiles';
  const keyFor = (name) => NS + '.profile.' + name;

  /** 档案名做最小规整：去空格、限制长度、不允许分隔符，避免键名冲突。 */
  function normalize(name) {
    return String(name || '').trim().replace(/[\s.]+/g, '_').slice(0, 20);
  }

  function listProfiles(storage) {
    try {
      const raw = storage.getItem(INDEX_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter((n) => typeof n === 'string') : [];
    } catch (e) {
      return [];
    }
  }

  function saveIndex(storage, names) {
    storage.setItem(INDEX_KEY, JSON.stringify(names.slice(0, 20)));
  }

  function exists(storage, name) {
    const n = normalize(name);
    return !!n && listProfiles(storage).indexOf(n) >= 0;
  }

  /** 新建档案。重名直接拒绝，避免静默覆盖别人的进度。 */
  function createProfile(storage, name) {
    const n = normalize(name);
    if (!n) return { ok: false, reason: '名字不能为空' };
    if (exists(storage, n)) return { ok: false, reason: '这个名字已存在，换一个' };
    const names = listProfiles(storage);
    names.push(n);
    saveIndex(storage, names);
    return { ok: true, name: n };
  }

  function loadRaw(storage, name) {
    const n = normalize(name);
    if (!n) return null;
    try { return storage.getItem(keyFor(n)); } catch (e) { return null; }
  }

  function saveRaw(storage, name, json) {
    const n = normalize(name);
    if (!n) return { ok: false, reason: '无效的档案名' };
    try {
      storage.setItem(keyFor(n), json);
      const names = listProfiles(storage);
      if (names.indexOf(n) < 0) { names.push(n); saveIndex(storage, names); }
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: '写入失败（浏览器可能禁用了本地存储）' };
    }
  }

  function deleteProfile(storage, name) {
    const n = normalize(name);
    storage.removeItem(keyFor(n));
    saveIndex(storage, listProfiles(storage).filter((x) => x !== n));
    return { ok: true };
  }

  /**
   * 导出存档码：`名称|base64(JSON)`。
   * 用 base64 而不是明文，纯粹是为了让它在聊天里是一行、不会被换行截断；
   * 它**不是加密**，任何拿到的人都能读出来。
   */
  function exportCode(name, json) {
    const n = normalize(name);
    let b64;
    if (typeof btoa === 'function') {
      b64 = btoa(unescape(encodeURIComponent(json)));
    } else {
      b64 = Buffer.from(json, 'utf-8').toString('base64');
    }
    return n + '|' + b64;
  }

  function importCode(code) {
    try {
      const idx = String(code || '').indexOf('|');
      if (idx < 0) return { ok: false, reason: '存档码格式不对' };
      const name = normalize(code.slice(0, idx));
      const b64 = code.slice(idx + 1).trim();
      let json;
      if (typeof atob === 'function') {
        json = decodeURIComponent(escape(atob(b64)));
      } else {
        json = Buffer.from(b64, 'base64').toString('utf-8');
      }
      JSON.parse(json);                    // 先验证是合法 JSON 再返回
      return { ok: true, name: name, json: json };
    } catch (e) {
      return { ok: false, reason: '存档码无法解析' };
    }
  }

  const API = {
    normalize, listProfiles, exists, createProfile, deleteProfile,
    loadRaw, saveRaw, exportCode, importCode, keyFor, INDEX_KEY,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.GameProfile = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
