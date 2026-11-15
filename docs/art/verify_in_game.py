#!/usr/bin/env python3
"""Verify in the real game that every piece of art actually renders.

Boots the game headless, creates a profile, then equips each item through the
debug hook (?debug=1) and screenshots the result. This is the test that matters:
a sprite can pass every offline check and still be invisible in game if the
texture key never reaches the sprite.

Requires:
    python3 -m http.server 8899 --directory game
    Chrome --headless=new --remote-debugging-port=9222
"""

import argparse, base64, json, os, re, socket, struct, sys, time, urllib.request


class WS:
    def __init__(self, url):
        m = re.match(r"ws://([^:/]+):(\d+)(/.*)", url)
        host, port, path = m.group(1), int(m.group(2)), m.group(3)
        self.s = socket.create_connection((host, port))
        key = base64.b64encode(os.urandom(16)).decode()
        req = (f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\n"
               f"Upgrade: websocket\r\nConnection: Upgrade\r\n"
               f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
        self.s.sendall(req.encode())
        self.s.recv(4096)

    def send(self, data):
        payload = data.encode(); n = len(payload)
        hdr = bytearray([0x81])
        if n < 126: hdr.append(0x80 | n)
        elif n < 65536:
            hdr.append(0x80 | 126); hdr += struct.pack(">H", n)
        else:
            hdr.append(0x80 | 127); hdr += struct.pack(">Q", n)
        mask = os.urandom(4); hdr += mask
        masked = bytearray(payload)
        for i in range(n): masked[i] ^= mask[i % 4]
        self.s.sendall(bytes(hdr) + bytes(masked))

    def recv(self, timeout=30):
        self.s.settimeout(timeout)
        b1 = self.s.recv(1)
        if not b1: return None
        b2 = self.s.recv(1)[0]; ln = b2 & 0x7F
        if ln == 126: ln = struct.unpack(">H", self.s.recv(2))[0]
        elif ln == 127: ln = struct.unpack(">Q", self.s.recv(8))[0]
        data = b""
        while len(data) < ln: data += self.s.recv(ln - len(data))
        return data.decode(errors="replace")


class CDP:
    def __init__(self, ws_url):
        self.ws = WS(ws_url); self.id = 0

    def call(self, method, params=None, timeout=30):
        self.id += 1; mid = self.id
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        deadline = time.time() + timeout
        while time.time() < deadline:
            msg = self.ws.recv(timeout=max(1, deadline - time.time()))
            if msg is None: return None
            try: obj = json.loads(msg)
            except json.JSONDecodeError: continue
            if obj.get("id") == mid: return obj
        return None

    def eval(self, expr, timeout=30):
        r = self.call("Runtime.evaluate",
                      {"expression": expr, "returnByValue": True, "awaitPromise": True},
                      timeout=timeout)
        if not r: return None
        res = r.get("result", {})
        if "exceptionDetails" in res:
            return {"__error": str(res["exceptionDetails"])[:300]}
        return res.get("result", {}).get("value")

    def shot(self, path):
        r = self.call("Page.captureScreenshot", {"format": "png"})
        if not r: return False
        data = r.get("result", {}).get("data")
        if not data: return False
        with open(path, "wb") as fh: fh.write(base64.b64decode(data))
        return True


def find_page(port):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/json") as fh:
        for t in json.load(fh):
            if t.get("type") == "page": return t["webSocketDebuggerUrl"]
    return None


EQUIPS = [
    (None, None), ("head", "ironHelm"), ("head", "thunderHelm"),
    ("torso", "chestPlate"), ("torso", "aegisPlate"), ("torso", "frostArmor"),
    ("back", "longCloak"), ("back", "runeCloak"),
    ("weapon", "broadSword"), ("weapon", "crystalStaff"),
    ("feet", "stoneBoots"), ("feet", "emberBoots"),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8899/index.html?debug=1")
    ap.add_argument("--out", default="docs/art/review/game")
    ap.add_argument("--port", type=int, default=9222)
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    ws_url = find_page(args.port)
    if not ws_url: sys.exit("no page target")

    cdp = CDP(ws_url)
    cdp.call("Page.enable"); cdp.call("Runtime.enable")
    cdp.call("Page.navigate", {"url": args.url})
    time.sleep(5)

    cdp.eval("""(() => {
      const inp = document.querySelector('input');
      if (!inp) return 'no input';
      inp.value = 'art-test';
      inp.dispatchEvent(new Event('input', {bubbles:true}));
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('新建'));
      if (btn) btn.click();
      return 'ok';
    })()""")
    time.sleep(4)

    print("debug hook:", cdp.eval("typeof window.__DBG__"))
    tex = cdp.eval("JSON.stringify(window.__DBG__ ? window.__DBG__.texturesAvailable() : [])")
    print("textures:", (tex or "")[:240])

    ok = 0
    for slot, eid in EQUIPS:
        if slot is None:
            r = cdp.eval("""(() => {
              const d = window.__DBG__; if (!d) return 'no hook';
              ['head','torso','back','weapon','feet'].forEach(s => d.equip(s, null));
              return 'stripped';
            })()""")
            name = "00_bare"
        else:
            r = cdp.eval(f"window.__DBG__ ? window.__DBG__.equip('{slot}','{eid}') : 'no hook'")
            name = f"{slot}_{eid}"
        time.sleep(0.7)
        if cdp.shot(os.path.join(args.out, f"{name}.png")): ok += 1
        print(f"  {name}: {r}")

    print(f"captured {ok} shots")
    return 0


if __name__ == "__main__":
    sys.exit(main())
