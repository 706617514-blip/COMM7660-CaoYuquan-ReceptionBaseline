#!/usr/bin/env python3
"""verify_crops.py — 验证作物：播种 → 成熟 → 收获 → 吃下去回血。"""
import base64, json, os, shutil, subprocess, sys, time, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cdp_shot as cdp

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT, PROFILE, OUT = 9226, "/tmp/cdp_crops", "/tmp/cropshots"

def main():
    os.makedirs(OUT, exist_ok=True)
    shutil.rmtree(PROFILE, ignore_errors=True)
    subprocess.run(["pkill","-f",f"remote-debugging-port={PORT}"],capture_output=True)
    time.sleep(0.5)
    subprocess.Popen([CHROME,f"--remote-debugging-port={PORT}",f"--user-data-dir={PROFILE}",
        "--headless=new","--no-first-run","--use-gl=swiftshader","--enable-unsafe-swiftshader",
        "--window-size=1200,760","about:blank"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    for _ in range(40):
        try: urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version",timeout=1); break
        except Exception: time.sleep(0.25)
    req=urllib.request.Request(f"http://127.0.0.1:{PORT}/json/new?http://127.0.0.1:8899/index.html",method="PUT")
    tab=json.load(urllib.request.urlopen(req,timeout=10))
    s=cdp.ws_connect(tab["webSocketDebuggerUrl"]); cid=[0]
    def cmd(m,p=None):
        cid[0]+=1; cdp.send(s,{"id":cid[0],"method":m,"params":p or {}})
        while True:
            r=cdp.recv(s)
            if r.get("id")==cid[0]: return r
    def ev(e):
        r=cmd("Runtime.evaluate",{"expression":e,"returnByValue":True})
        v=r.get("result",{}).get("result",{})
        return v.get("value") if v.get("value") is not None else v.get("description","?"+json.dumps(r)[:150])
    def shot(n):
        r=cmd("Page.captureScreenshot",{"format":"png"})
        d=r.get("result",{}).get("data")
        if d:
            p=os.path.join(OUT,n+".png"); open(p,"wb").write(base64.b64decode(d)); print("  SHOT",p)

    cmd("Page.enable"); cmd("Runtime.enable"); time.sleep(3)
    ev("(()=>{var i=document.getElementById('newName'),b=document.getElementById('btnCreate');"
       "if(i&&b){i.value='__cropv';b.click();return 1}return 0})()")
    time.sleep(6)

    # 给玩家作物种子
    print("给种子:", ev("""(()=>{
      var app=globalThis.EmberfieldApp, st=app.__state;
      st.meta.cropSeeds = { emberbloom: 3, thornfruit: 3, barkmelon: 3 };
      st.meta.seeds = 5;
      return JSON.stringify(st.meta.cropSeeds);
    })()"""))

    # 进农场
    ev("(()=>{globalThis.__game.scene.getScene('Hub').scene.start('Farm');return 1})()")
    time.sleep(2.5)
    shot("01_farm_with_crops")

    # 选中焰花并种下
    print("选中焰花:", ev("""(()=>{
      var f=globalThis.__game.scene.getScene('Farm');
      f.chosenCrop='emberbloom'; f.refreshHud();
      return f.chosenCrop;
    })()"""))
    time.sleep(0.6)
    shot("02_crop_selected")

    print("种下:", ev("""(()=>{
      var f=globalThis.__game.scene.getScene('Farm'), app=globalThis.EmberfieldApp;
      f.tryPlant(0);
      return 'plot0=' + app.__state.farm.plots[0].state + ' crop=' + app.__state.farm.plots[0].crop
           + ' seeds=' + JSON.stringify(app.__state.meta.cropSeeds);
    })()"""))
    time.sleep(0.8)
    shot("03_planted")

    # 推进两局让它成熟
    print("推进成熟:", ev("""(()=>{
      var app=globalThis.EmberfieldApp, st=app.__state, L=globalThis.GameLogic;
      for (var i=0;i<2;i++){ L.startRun(st,'grass'); L.endRun(st,false); }
      return 'plot0=' + st.farm.plots[0].state
           + ' harvest=' + JSON.stringify(st.meta.cropHarvest);
    })()"""))
    time.sleep(0.8)
    print("收获后 harvest:", ev("(()=>{var s=globalThis.EmberfieldApp.__state;"
       "return JSON.stringify(s.meta.cropHarvest)})()"))
    shot("04_harvested")

    # 进战斗吃下去回血
    print("吃下回血:", ev("""(()=>{
      var app=globalThis.EmberfieldApp, g=globalThis.__game;
      var st=app.__state, L=globalThis.GameLogic;
      // 把收获数量给足
      st.meta.cropHarvest.emberbloom = 2;
      var hub=g.scene.getScene('Hub'); hub.startRun('grass');
      return 'started';
    })()"""))
    time.sleep(2.5)
    print("血量变化:", ev("""(()=>{
      var app=globalThis.EmberfieldApp, st=app.__state, L=globalThis.GameLogic;
      st.run.player.hp = 20;
      var before = st.run.player.hp;
      var r = L.eatCrop(st, st.run, 'emberbloom');
      return 'before=' + before + ' after=' + st.run.player.hp + ' ok=' + r.ok
           + ' harvestLeft=' + JSON.stringify(st.meta.cropHarvest);
    })()"""))
    time.sleep(0.8)
    shot("05_ate_in_battle")

    subprocess.run(["pkill","-f",f"remote-debugging-port={PORT}"],capture_output=True)

if __name__=="__main__": main()
