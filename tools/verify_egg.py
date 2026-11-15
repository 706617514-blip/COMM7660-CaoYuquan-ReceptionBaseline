#!/usr/bin/env python3
"""
verify_egg.py — 在真浏览器里验证彩蛋演出（Task 3.2）。

做法：建档进游戏 → 用调试钩子直接把玩家送进 RunScene →
注入彩蛋状态 → 截图捕捉三个演出阶段。

为什么必须真浏览器：演出是视觉效果，logic 层的测试证明不了
"光爆好看"或"纸条排得对不对"。这部分只能看。
"""
import base64, json, os, shutil, subprocess, sys, time, urllib.request

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT, PROFILE = 9224, "/tmp/cdp_egg"
OUT = "/tmp/eggshots"

# 复用 cdp_shot.py 的极简 WebSocket 实现
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cdp_shot as cdp

def main():
    os.makedirs(OUT, exist_ok=True)
    shutil.rmtree(PROFILE, ignore_errors=True)
    subprocess.run(["pkill","-f",f"remote-debugging-port={PORT}"],capture_output=True)
    time.sleep(0.5)
    subprocess.Popen([CHROME,f"--remote-debugging-port={PORT}",f"--user-data-dir={PROFILE}",
        "--headless=new","--no-first-run","--use-gl=swiftshader","--enable-unsafe-swiftshader",
        "--window-size=1200,760","about:blank"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    for _ in range(40):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version",timeout=1); break
        except Exception: time.sleep(0.25)
    url="http://127.0.0.1:8899/index.html"
    req=urllib.request.Request(f"http://127.0.0.1:{PORT}/json/new?{url}",method="PUT")
    tab=json.load(urllib.request.urlopen(req,timeout=10))
    s=cdp.ws_connect(tab["webSocketDebuggerUrl"])
    cid=[0]
    def cmd(m,p=None):
        cid[0]+=1; cdp.send(s,{"id":cid[0],"method":m,"params":p or {}})
        while True:
            r=cdp.recv(s)
            if r.get("id")==cid[0]: return r
    def ev(expr):
        r=cmd("Runtime.evaluate",{"expression":expr,"returnByValue":True})
        return r.get("result",{}).get("result",{}).get("value")
    def shot(name):
        r=cmd("Page.captureScreenshot",{"format":"png"})
        d=r.get("result",{}).get("data")
        if d:
            p=os.path.join(OUT,name+".png"); open(p,"wb").write(base64.b64decode(d))
            print("  SHOT", p); return p
        print("  SHOT FAILED", json.dumps(r)[:200]); return None

    cmd("Page.enable"); cmd("Runtime.enable"); time.sleep(3)
    ev("(()=>{var i=document.getElementById('newName'),b=document.getElementById('btnCreate');"
       "if(i&&b){i.value='__eggv';b.click();return 1}return 0})()")
    time.sleep(6)
    print("RENDERER:", ev("(()=>{var g=globalThis.__game;return g?('type='+g.renderer.type):'no game'})()"))

    # 钩子：把玩家放进 RunScene 并注入彩蛋
    # scene.start('Run') 只创建场景，不建 run 对象（run 由 startRun 创建）。
    # 走 HubScene.startRun 这条正规入口，它内部会调 L.startRun。
    inject = """(function(){
      var app = globalThis.EmberfieldApp;
      var g = globalThis.__game;
      if (!g) return 'no game';
      var st = app && app.__state;
      if (!st) return 'no state';
      st.meta.clearedForge = true;
      st.meta.beatHellBoss = true;
      st.meta.eggFound = false;
      var hub = g.scene.getScene('Hub');
      if (!hub || typeof hub.startRun !== 'function') return 'no Hub.startRun';
      hub.startRun('forge');
      return 'started';
    })()"""
    print("INJECT:", ev(inject))
    time.sleep(3)
    shot("01_run")

    # 掉蛋：直接调 logic
    drop = """(function(){
      var app = globalThis.EmberfieldApp, g = globalThis.__game;
      var st = app && app.__state;
      if (!st || !st.run) return 'no run';
      var L = globalThis.GameLogic;
      var r = L.dropEgg(st, st.run, st.run.player.x + 60, st.run.player.z);
      return 'dropped=' + r;
    })()"""
    print("DROP:", ev(drop))
    time.sleep(1.5)
    shot("02_egg_visible")

    # 走近并拾取
    take = """(function(){
      var app = globalThis.EmberfieldApp, g = globalThis.__game;
      var st = app && app.__state, L = globalThis.GameLogic;
      if (!st || !st.run || !st.run.egg) return 'no egg';
      // 清场 + 回满血：验证演出需要一段不被打断的时间。
      // 真机试玩不会这样 —— 见交付说明里"演出期间可否被打断"的待决问题。
      st.run.enemies.length = 0;
      st.run.spawnQueue.length = 0;
      st.run.player.hp = st.run.player.maxHp;
      st.run.player.x = st.run.egg.x; st.run.player.z = st.run.egg.z;
      var r = L.takeEgg(st, st.run);
      return 'taken=' + r.ok;
    })()"""
    print("TAKE:", ev(take))
    time.sleep(0.35)
    shot("03_burst_early")
    time.sleep(0.5)
    shot("04_burst_peak")
    time.sleep(1.4)
    shot("05_letter_fading")
    time.sleep(3.5)
    shot("06_letter_full")

    subprocess.run(["pkill","-f",f"remote-debugging-port={PORT}"],capture_output=True)

if __name__=="__main__":
    main()
