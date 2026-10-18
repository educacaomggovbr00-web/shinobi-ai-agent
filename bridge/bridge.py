#!/usr/bin/env python3
"""Shinobi: relay explicitly queued GitHub commands to your Codespaces Firefox."""
import base64
import datetime
import ipaddress
import json
import os
import pathlib
import re
import subprocess
import sys
import time
from urllib.parse import urlsplit

REPO = "educacaomggovbr00-web/shinobi-ai-agent"
COMMAND = "bridge/command.json"
RESULT = "bridge/result.json"
SCREENSHOT = "bridge/screenshot.jpg"
os.environ.setdefault("DISPLAY", ":1")

def shell(argv, stdin=None, timeout=25):
    proc = subprocess.run(argv, input=stdin, text=True, capture_output=True, timeout=timeout)
    if proc.returncode:
        raise RuntimeError((proc.stderr or proc.stdout or "command failed").strip()[:900])
    return proc.stdout.strip()

def get_file(path):
    proc = subprocess.run(["gh", "api", "repos/" + REPO + "/contents/" + path],
                          capture_output=True, text=True, timeout=25)
    if proc.returncode:
        if "HTTP 404" in proc.stderr or "Not Found" in proc.stderr:
            return None, None
        raise RuntimeError("GitHub read error: " + proc.stderr[:500])
    item = json.loads(proc.stdout)
    return base64.b64decode(item["content"].replace("\n", "")), item["sha"]

def put_file(path, contents, description):
    for attempt in range(3):
        _, sha = get_file(path)
        request = {"message": description,
                   "content": base64.b64encode(contents).decode("ascii"),
                   "branch": "main"}
        if sha:
            request["sha"] = sha
        try:
            shell(["gh", "api", "--method", "PUT",
                   "repos/" + REPO + "/contents/" + path, "--input", "-"],
                  stdin=json.dumps(request), timeout=40)
            return
        except RuntimeError:
            if attempt == 2: raise
            time.sleep(2)

def xdo(*args):
    return shell(["xdotool", *args], timeout=12)

def firefox_window():
    try:
        ids = shell(["xdotool", "search", "--onlyvisible", "--class", "firefox"])
        ids = [x for x in ids.splitlines() if x.strip().isdigit()]
        return ids[-1] if ids else None
    except RuntimeError:
        return None

def activate():
    window = firefox_window()
    if window is None:
        raise RuntimeError("Firefox not found. Open it in the graphical desktop.")
    xdo("windowactivate", "--sync", window)
    return window

def current_url():
    activate()
    xdo("key", "--clearmodifiers", "ctrl+l")
    xdo("key", "--clearmodifiers", "ctrl+c")
    time.sleep(0.3)
    value = shell(["xclip", "-selection", "clipboard", "-o"], timeout=5)
    xdo("key", "--clearmodifiers", "Escape")
    return value.strip()[:1500]

def checked_url(address):
    if not isinstance(address, str) or len(address) > 2000: raise ValueError("Invalid URL")
    u = urlsplit(address)
    if u.scheme != "https" or not u.hostname or u.username or u.password:
        raise ValueError("Only HTTPS URLs without user credentials are allowed")
    if u.hostname == "localhost" or u.hostname.endswith((".local", ".internal", ".localhost")):
        raise ValueError("Local network addresses are blocked")
    try:
        if not ipaddress.ip_address(u.hostname).is_global: raise ValueError("Private IP is blocked")
    except ValueError as exc:
        if "blocked" in str(exc): raise
    return address

def run(command):
    action = command.get("action")
    if action == "status":
        window = firefox_window()
        return {"connected": True, "display": os.getenv("DISPLAY"),
                "firefox_window": bool(window),
                "window_title": shell(["xdotool", "getwindowname", window])[:200] if window else None}
    if action == "open_url":
        url = checked_url(command.get("url"))
        activate()
        xdo("key", "--clearmodifiers", "ctrl+l")
        xdo("type", "--clearmodifiers", "--delay", "4", url)
        xdo("key", "--clearmodifiers", "Return")
        time.sleep(2)
        return {"requested_url": url, "current_url": current_url()}
    if action == "get_url":
        return {"current_url": current_url()}
    if action == "read_page_text":
        url = current_url()
        parsed = urlsplit(url)
        if parsed.hostname not in ("discord.com", "www.discord.com") or not parsed.path.startswith("/channels/1515877468299595919/"):
            raise ValueError("Text reading limited to accessible Naruto Project RP channels, not DMs or login pages")
        activate()
        xdo("key", "--clearmodifiers", "Escape")
        xdo("key", "--clearmodifiers", "ctrl+a")
        xdo("key", "--clearmodifiers", "ctrl+c")
        time.sleep(0.4)
        value = shell(["xclip", "-selection", "clipboard", "-o"], timeout=6)
        return {"current_url": url, "text": value.strip()[:4500],
                "note": "Copied selectable page text; virtualized posts may be omitted."}
    if action == "scroll":
        direction, amount = command.get("direction", "down"), int(command.get("amount", 3))
        if direction not in ("up", "down") or not 1 <= amount <= 8:
            raise ValueError("Invalid scroll request")
        activate()
        xdo("click", "--repeat", str(amount), "--delay", "100", "4" if direction == "up" else "5")
        return {"direction": direction, "amount": amount}
    if action == "click":
        x, y = int(command["x"]), int(command["y"])
        if not (0 <= x <= 2500 and 0 <= y <= 1800): raise ValueError("Invalid mouse position")
        activate()
        xdo("mousemove", "--sync", str(x), str(y))
        xdo("click", "1")
        return {"x": x, "y": y, "clicked": True}
    if action == "screenshot":
        activate()
        target = pathlib.Path("/tmp/shinobi-screenshot.jpg")
        shell(["scrot", "--quality", "45", "--overwrite", str(target)])
        contents = target.read_bytes()
        if len(contents) > 950000: raise ValueError("Screenshot too large")
        put_file(SCREENSHOT, contents, "Requested private desktop screenshot")
        return {"screenshot_file": SCREENSHOT, "bytes": len(contents)}
    raise ValueError("Unknown action. Allowed: status, open_url, get_url, read_page_text, click, scroll, screenshot")

def main():
    print("🍥 Shinobi bridge ready (GitHub command queue). Ctrl+C to stop.", flush=True)
    existing, _ = get_file(RESULT)
    try: last_id = json.loads(existing)["id"] if existing else None
    except (ValueError, KeyError, TypeError): last_id = None
    while True:
        try:
            data, _ = get_file(COMMAND)
            cmd = json.loads(data) if data else {}
            cmd_id = str(cmd.get("id", ""))
            if cmd_id and cmd_id != last_id:
                print("Processing", cmd_id, cmd.get("action"), flush=True)
                try:
                    response = {"id": cmd_id, "action": cmd.get("action"),
                                "ok": True, "data": run(cmd)}
                except Exception as exc:
                    response = {"id": cmd_id, "action": cmd.get("action"),
                                "ok": False, "error": str(exc)[:900]}
                response["finished_at_utc"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
                put_file(RESULT, json.dumps(response, ensure_ascii=False, indent=2).encode(),
                         "Shinobi browser response " + re.sub("[^a-zA-Z0-9_-]", "", cmd_id)[:60])
                last_id = cmd_id
                print("Saved result for", cmd_id, "ok", response["ok"], flush=True)
        except KeyboardInterrupt:
            print("Stopping bridge.", flush=True)
            return
        except Exception as exc:
            print("Bridge issue:", str(exc)[:500], file=sys.stderr, flush=True)
        time.sleep(8)

if __name__ == "__main__":
    main()
