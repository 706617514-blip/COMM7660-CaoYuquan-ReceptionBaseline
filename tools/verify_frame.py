#!/usr/bin/env python3
"""verify_frame.py — 验证基地相框：掉蛋后才出现，按 J 能看纸条。"""
import base64, json, os, shutil, subprocess, sys, time, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cdp_shot as cdp

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT, PROFILE, OUT = 9225, "/tmp/cdp_frame", "/tmp/frameshots"

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
        return r.get("result",{}).get("result",{}).get("value")
    def shot(n):
        r=cmd("Page.captureScreenshot",{"format":"png"})
        d=r.get("result",{}).get("data")
        if d:
            p=os.path.join(OUT,n+".png"); open(p,"wb").write(base64.b64decode(d)); print("  SHOT",p)

    cmd("Page.enable"); cmd("Runtime.enable"); time.sleep(3)
    ev("(()=>{var i=document.getElementById('newName'),b=document.getElementById('btnCreate');"
       "if(i&&b){i.value='__framev';b.click();return 1}return 0})()")
    time.sleep(6)

    # 1) 还没掉蛋：农场里不该有相框
    ev("(()=>{globalThis.__game.scene.getScene('Hub').scene.start('Farm');return 1})()")
    time.sleep(2.5)
    print("未掉蛋时 frameRect:", ev("(()=>{var f=globalThis.__game.scene.getScene('Farm');"
       "return JSON.stringify(f.frameRect())})()"))
    shot("01_no_frame")

    # 2) 掉蛋后：相框出现
    ev("(()=>{var app=globalThis.EmberfieldApp;app.__state.meta.eggFound=true;return 1})()")
    time.sleep(1.5)
    print("掉蛋后 frameRect:", ev("(()=>{var f=globalThis.__game.scene.getScene('Farm');"
       "return JSON.stringify(f.frameRect())})()"))
    shot("02_frame_visible")

    # 3) 按 J 打开纸条
    ev("(()=>{var f=globalThis.__game.scene.getScene('Farm');f.openLetter();return 1})()")
    time.sleep(1.0)
    shot("03_letter_open")
    print("纸条可见:", ev("(()=>{var e=document.getElementById('eggLetter');"
       "return e? e.style.display+' opacity='+e.style.opacity : 'no el'})()"))

    subprocess.run(["pkill","-f",f"remote-debugging-port={PORT}"],capture_output=True)

if __name__=="__main__": main()
