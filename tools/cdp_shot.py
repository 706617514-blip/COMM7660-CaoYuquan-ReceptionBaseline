#!/usr/bin/env python3
"""
cdp_shot.py — 用 Chrome DevTools Protocol 截图并读取渲染器信息。

用途：Task 2 闸门二 —— 切 WebGL 后逐一目视核对 8 处 BlendModes.ADD
（app.js:1723/1751/1753/1755/1769/1789/2696/3964，全是火星与光晕效果）。

为什么不用 tests/browser/ 里那套
--------------------------------
那套走 Electron 起无头浏览器，而本机 Electron 被 ELECTRON_RUN_AS_NODE
污染（见 electron/main.js 的注释），起不来。Chrome 的 CDP 没有这个问题，
且能直接读 renderer.type 判断究竟是 WebGL 还是 Canvas —— 这正是
本任务要证明的事。
"""

import json
import subprocess
import sys
import time
import urllib.request
import base64
import os

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT = 9222
PROFILE = "/tmp/cdp_profile_ktv"


def start_chrome():
    subprocess.run(["pkill", "-f", f"remote-debugging-port={PORT}"],
                   capture_output=True)
    time.sleep(0.5)
    # 清空 profile：否则上次跑留下的 localStorage 里已有同名档案，
    # 点"新建"会撞重名卡在列表页，截图就不是游戏画面（踩过两次）。
    import shutil
    shutil.rmtree(PROFILE, ignore_errors=True)
    subprocess.Popen([
        CHROME,
        f"--remote-debugging-port={PORT}",
        f"--user-data-dir={PROFILE}",
        "--headless=new",
        "--no-first-run",
        "--disable-gpu-sandbox",
        "--use-gl=swiftshader",          # 无头下要有 WebGL，得给个软渲染后端
        "--enable-unsafe-swiftshader",
        "--window-size=1200,760",
        "about:blank",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    for _ in range(40):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version",
                                        timeout=1) as r:
                json.load(r)
                return True
        except Exception:
            time.sleep(0.25)
    return False


def ws_connect(url):
    """极简 WebSocket 客户端（只做文本帧，够 CDP 用）。"""
    import socket
    from urllib.parse import urlparse
    import struct
    import hashlib

    u = urlparse(url)
    s = socket.create_connection((u.hostname, u.port), timeout=30)
    key = base64.b64encode(os.urandom(16)).decode()
    req = (f"GET {u.path} HTTP/1.1\r\nHost: {u.hostname}:{u.port}\r\n"
           "Upgrade: websocket\r\nConnection: Upgrade\r\n"
           f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
    s.sendall(req.encode())
    buf = b""
    while b"\r\n\r\n" not in buf:
        buf += s.recv(4096)
    return s


def send(s, obj):
    import struct
    data = json.dumps(obj).encode()
    mask = os.urandom(4)
    n = len(data)
    header = b"\x81"
    if n < 126:
        header += bytes([0x80 | n])
    elif n < 65536:
        header += bytes([0x80 | 126]) + struct.pack(">H", n)
    else:
        header += bytes([0x80 | 127]) + struct.pack(">Q", n)
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
    s.sendall(header + mask + masked)


def recv(s):
    import struct
    def rd(n):
        b = b""
        while len(b) < n:
            c = s.recv(n - len(b))
            if not c:
                raise EOFError
            b += c
        return b
    h = rd(2)
    ln = h[1] & 0x7F
    if ln == 126:
        ln = struct.unpack(">H", rd(2))[0]
    elif ln == 127:
        ln = struct.unpack(">Q", rd(8))[0]
    return json.loads(rd(ln).decode())


def main():
    target_url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8899/index.html"
    outdir = sys.argv[2] if len(sys.argv) > 2 else "/tmp/shots"
    tag = sys.argv[3] if len(sys.argv) > 3 else "shot"
    os.makedirs(outdir, exist_ok=True)

    if not start_chrome():
        print("FAIL: Chrome 起不来")
        return 1

    # 新建标签页。新版 Chrome 要求 PUT 才能建标签（GET 返回 405）。
    req = urllib.request.Request(
        f"http://127.0.0.1:{PORT}/json/new?{target_url}", method="PUT")
    with urllib.request.urlopen(req, timeout=10) as r:
        tab = json.load(r)

    s = ws_connect(tab["webSocketDebuggerUrl"])
    cid = [0]

    def cmd(method, params=None):
        cid[0] += 1
        send(s, {"id": cid[0], "method": method, "params": params or {}})
        while True:
            m = recv(s)
            if m.get("id") == cid[0]:
                return m

    cmd("Page.enable")
    cmd("Runtime.enable")
    time.sleep(3)

    # 游戏在"建档"之前不创建 Phaser.Game（见 profile.js 的多档案设计），
    # 所以要先自动建档，否则 __game 永远不存在、渲染器读不到。
    boot = """(function(){
      var inp = document.getElementById('newName');
      var btn = document.getElementById('btnCreate');
      if (inp && btn) {
        inp.value = '__ab';
        btn.click();
        return 'clicked';
      }
      return 'no-ui:' + (inp?'has-inp':'no-inp') + ',' + (btn?'has-btn':'no-btn');
    })()"""
    rb = cmd("Runtime.evaluate", {"expression": boot, "returnByValue": True})
    print("BOOT:", rb.get("result", {}).get("result", {}).get("value"))
    time.sleep(6)   # 等游戏 boot 完成（BootScene 要生成纹理）

    # ---- 读渲染器信息（本任务的核心证据）----
    expr = """(function(){
      var g = globalThis.__game;
      if (!g) return JSON.stringify({err:'no __game'});
      var r = g.renderer;
      // Phaser: type 1 = CANVAS, 2 = WEBGL
      var names = {1:'CANVAS',2:'WEBGL'};
      var gl = null;
      try { gl = r.gl; } catch(e){}
      var exts = [];
      if (gl && gl.getSupportedExtensions) {
        var all = gl.getSupportedExtensions() || [];
        ['EXT_blend_minmax','OES_standard_derivatives','WEBGL_multi_draw']
          .forEach(function(n){ if (all.indexOf(n)>=0) exts.push(n); });
      }
      return JSON.stringify({
        type: r.type,
        renderer: names[r.type] || ('unknown:'+r.type),
        isWebGL: r.type === 2,
        width: r.width, height: r.height,
        glVersion: gl ? gl.getParameter(gl.VERSION) : null,
        blendCapable: !!gl
      });
    })()"""
    r = cmd("Runtime.evaluate", {"expression": expr, "returnByValue": True})
    val = r.get("result", {}).get("result", {}).get("value")
    print("RENDERER:", val)

    # ---- 截图 ----
    shot = cmd("Page.captureScreenshot", {"format": "png"})
    data = shot.get("result", {}).get("data")
    if data:
        p = os.path.join(outdir, f"{tag}.png")
        with open(p, "wb") as f:
            f.write(base64.b64decode(data))
        print("SHOT:", p)
    else:
        print("SHOT FAILED:", json.dumps(shot)[:300])
        return 1

    subprocess.run(["pkill", "-f", f"remote-debugging-port={PORT}"],
                   capture_output=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
