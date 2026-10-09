#!/usr/bin/env python3
"""Niri-backed Linux computer-use provider."""
import base64, json, os, shutil, subprocess, sys, uuid
from dataclasses import dataclass
MAX_SCREENSHOT_PNG_BYTES = 900_000
BLOCKED_APP_FRAGMENTS = ("1password", "bitwarden", "dashlane", "lastpass", "nordpass", "proton pass")
@dataclass(frozen=True)
class Window:
    id: int; title: str; app_id: str; pid: int; workspace_id: int|None; focused: bool; x: int; y: int; width: int; height: int
    @property
    def bounds(self): return {"x":self.x,"y":self.y,"width":self.width,"height":self.height}
def command(name): return os.environ.get(f"ORCA_COMPUTER_{name.upper()}_COMMAND") or shutil.which(name)
def run(args, input_text=None, check=True, timeout=5):
    try: result=subprocess.run(args,input=input_text,text=True,capture_output=True,timeout=timeout,check=False)
    except FileNotFoundError as exc: raise RuntimeError(f"missing command: {args[0]}") from exc
    if check and result.returncode: raise RuntimeError(result.stderr.strip() or result.stdout.strip() or f"{args[0]} failed")
    return result
def require_environment():
    if os.environ.get("XDG_SESSION_TYPE","wayland").lower() != "wayland": raise RuntimeError("unsupported capability: Linux computer use requires a Wayland Niri session")
    if not command("niri"): raise RuntimeError("missing command: niri")
    if not os.environ.get("XDG_RUNTIME_DIR"): raise RuntimeError("desktop session missing XDG_RUNTIME_DIR")
def niri(args): return run([command("niri"),"msg",*args])
def parse_windows(raw):
    try: payload=json.loads(raw)
    except json.JSONDecodeError as exc: raise RuntimeError(f"malformed Niri output: {exc}") from exc
    if not isinstance(payload,list): raise RuntimeError("malformed Niri output: expected a window array")
    result=[]
    for item in payload:
        try:
            geometry=item.get("geometry") or {}; pos=geometry.get("pos") or item.get("layout",{}).get("pos") or {}; size=geometry.get("size") or item.get("layout",{}).get("size") or {}
            result.append(Window(int(item["id"]),str(item.get("title") or ""),str(item.get("app_id") or ""),int(item.get("pid") or 0),int(item["workspace_id"]) if item.get("workspace_id") is not None else None,bool(item.get("is_focused")),int(pos.get("x",0)),int(pos.get("y",0)),int(size.get("width",0)),int(size.get("height",0))))
        except (KeyError,TypeError,ValueError) as exc: raise RuntimeError(f"malformed Niri window record: {exc}") from exc
    return result
def windows(): return parse_windows(niri(["-j","windows"]).stdout)
def blocked(window): return any(part in f"{window.app_id} {window.title}".lower() for part in BLOCKED_APP_FRAGMENTS)
def match(window, query):
    needle=str(query or "").strip().lower()
    if needle.startswith("pid:"): return needle[4:].isdigit() and window.pid==int(needle[4:])
    if needle.isdigit() and int(needle)>0: return window.pid==int(needle)
    return needle in window.app_id.lower() or needle in window.title.lower()
def select(query, window_id=None, window_index=None):
    matches=[w for w in windows() if not blocked(w) and match(w,query)]
    if window_id is not None: matches=[w for w in matches if w.id==int(window_id)]
    if not matches: raise RuntimeError(f'windowNotFound("{query}")')
    if window_index is not None:
        try: return matches[int(window_index)]
        except (IndexError,ValueError): raise RuntimeError(f'windowNotFound("{window_index}")')
    return next((w for w in matches if w.focused),matches[0])
def app_record(w): return {"name":w.app_id or w.title,"bundleIdentifier":w.app_id or w.title,"pid":w.pid}
def window_record(w,index): return {"index":index,"app":app_record(w),"id":w.id,"title":w.title,"x":w.x,"y":w.y,"width":w.width,"height":w.height,"isMinimized":False,"isOffscreen":False,"screenIndex":None,"platform":{"backend":"niri","workspaceId":w.workspace_id,"focused":w.focused}}
def screenshot(w):
    if not command("grim"): raise RuntimeError("missing command: grim")
    try:
        result=subprocess.run([command("grim"),"-g",f"{w.x},{w.y} {w.width}x{w.height}","-"],capture_output=True,timeout=10,check=False)
    except FileNotFoundError as exc: raise RuntimeError("missing command: grim") from exc
    if result.returncode: raise RuntimeError(result.stderr.decode(errors="replace").strip() or "grim failed")
    data=result.stdout
    if len(data)>MAX_SCREENSHOT_PNG_BYTES: return {"error":{"code":"screenshot_failed","message":"grim screenshot exceeds the computer-use payload cap"}}
    return {"base64":base64.b64encode(data).decode("ascii"),"width":w.width,"height":w.height,"scale":1}
def focus(w): niri(["action","focus-window","--id",str(w.id)])
def key_parts(raw):
    aliases={"cmdorctrl":"ctrl","commandorcontrol":"ctrl","return":"Return","enter":"Return","esc":"Escape","escape":"Escape","space":"space","tab":"Tab","backspace":"BackSpace","delete":"Delete","left":"Left","right":"Right","up":"Up","down":"Down"}
    return [aliases.get(p.lower(),p) for p in str(raw).split("+")]
def wtype_text(value):
    if not command("wtype"): raise RuntimeError("missing command: wtype")
    run([command("wtype"),"-"],input_text=str(value))
def wtype_key(value):
    parts=key_parts(value); args=[command("wtype")]; modifiers={"ctrl":"ctrl","shift":"shift","alt":"alt","super":"super","meta":"super"}
    for part in parts[:-1]: args.extend(["-M",modifiers.get(part.lower(),part.lower())])
    args.extend(["-k",parts[-1]]); run(args)
def ydotool(args):
    if not command("ydotool"): raise RuntimeError("missing command: ydotool")
    run([command("ydotool"),*args])
def pointer(op,w):
    x=w.x+int(float(op.get("x",0))); y=w.y+int(float(op.get("y",0))); button={"left":"0xC0","right":"0xC1","middle":"0xC2"}.get(str(op.get("mouse_button","left")).lower())
    if op["tool"]=="click":
        if not button: raise RuntimeError("unsupported mouse button")
        for _ in range(int(op.get("click_count",1))): ydotool(["mousemove","--absolute",str(x),str(y)]); ydotool(["click",button])
    elif op["tool"]=="scroll": ydotool(["mousemove","--absolute",str(x),str(y)]); ydotool(["wheel",str(max(1,int(float(op.get("pages",1)))) if op.get("direction")=="down" else -max(1,int(float(op.get("pages",1))))),"0"])
    elif op["tool"]=="drag":
        sx=w.x+int(float(op.get("from_x",0))); sy=w.y+int(float(op.get("from_y",0))); ex=w.x+int(float(op.get("to_x",0))); ey=w.y+int(float(op.get("to_y",0)))
        ydotool(["mousemove","--absolute",str(sx),str(sy)]); ydotool(["mousedown","1"]); ydotool(["mousemove","--absolute",str(ex),str(ey)]); ydotool(["mouseup","1"])
def capabilities():
    n=bool(command("niri")); g=bool(command("grim")); k=bool(command("wtype")); p=bool(command("ydotool"))
    return {"platform":"linux","provider":"orca-computer-use-linux","providerVersion":"2.0.0","protocolVersion":1,"supports":{"apps":{"list":True,"bundleIds":True,"pids":True},"windows":{"list":n,"targetById":n,"targetByIndex":n,"focus":n,"moveResize":False},"observation":{"screenshot":n and g,"annotatedScreenshot":False,"elementFrames":False,"ocr":False},"actions":{"click":n and p,"typeText":n and k,"pressKey":n and k,"hotkey":n and k,"pasteText":False,"scroll":n and p,"drag":n and p,"setValue":False,"performAction":False},"surfaces":{"menus":False,"dialogs":False,"dock":False,"menubar":False}}}
def snapshot(w,include):
    image=screenshot(w) if include else None
    return {"snapshotId":str(uuid.uuid4()),"app":app_record(w),"windowTitle":w.title,"windowId":w.id,"windowIndex":None,"windowBounds":w.bounds,"screenshotPngBase64":image.get("base64") if image else None,"screenshotWidth":image.get("width") if image else None,"screenshotHeight":image.get("height") if image else None,"screenshotScale":image.get("scale") if image else None,"screenshotError":image.get("error") if image else None,"coordinateSpace":"window","truncation":{"truncated":False,"maxNodes":0,"maxDepth":0,"maxDepthReached":False},"treeLines":[f"Window {w.id} {w.app_id} {w.title} ({w.width}x{w.height})"],"focusedSummary":"focused" if w.focused else None,"elements":[]}
def run_operation(op):
    require_environment(); tool=op.get("tool")
    if tool=="handshake": return {"ok":True,"capabilities":capabilities()}
    current=windows()
    if tool=="list_apps":
        seen={(w.app_id or w.title,w.pid):app_record(w) for w in current if not blocked(w)}; return {"ok":True,"apps":list(seen.values())}
    if tool=="list_windows":
        selected=[w for w in current if not blocked(w) and match(w,op.get("app",""))]
        if not selected: raise RuntimeError(f'appNotFound("{op.get("app","")}")')
        return {"ok":True,"app":app_record(selected[0]),"windows":[window_record(w,i) for i,w in enumerate(selected)]}
    w=select(op.get("app",""),op.get("windowId"),op.get("windowIndex"))
    if op.get("restoreWindow"): focus(w); w=select(op.get("app",""),op.get("windowId"),op.get("windowIndex"))
    include=not bool(op.get("noScreenshot"))
    if tool=="get_app_state": return {"ok":True,"snapshot":snapshot(w,include)}
    if op.get("element") or op.get("fromElement") or op.get("toElement") or tool in {"perform_secondary_action","set_value","paste_text"}: raise RuntimeError("unsupported capability: Niri does not expose semantic elements or clipboard actions")
    if tool=="type_text": wtype_text(op.get("text",""))
    elif tool in {"press_key","hotkey"}: wtype_key(op.get("key",""))
    elif tool in {"click","scroll","drag"}: pointer(op,w)
    else: raise RuntimeError("unsupported capability: operation requires semantic access")
    return {"ok":True,"action":{"path":"niri","actionName":tool,"fallbackReason":None,"verification":{"state":"unverified","reason":"compositor_input"}},"snapshot":snapshot(select(op.get("app",""),op.get("windowId"),op.get("windowIndex")),include)}
def main():
    try:
        with open(sys.argv[1],encoding="utf-8") as handle: print(json.dumps(run_operation(json.load(handle)),separators=(",",":")))
    except Exception as exc: print(json.dumps({"ok":False,"error":str(exc)},separators=(",",":")))
if __name__=="__main__": main()
