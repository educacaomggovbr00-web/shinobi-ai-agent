#!/usr/bin/env python3
"""Bushin private GitHub Actions command bridge for the live Chromium window.

Only commands from this private repository, scoped to the active Actions run.
Never accepts Discord passwords, login codes, Discord API tokens or chat posting.
Do not store screenshots/cookies in GitHub.
"""
import asyncio
import base64
import datetime
import ipaddress
import json
import os
import re
import subprocess
import time
from urllib.parse import urlsplit

REPO = "educacaomggovbr00-web/shinobi-ai-agent"
COMMAND_FILE = "browser_actions/live_command.json"
RESULT_FILE = "browser_actions/live_result.json"
GUILD_ID = "1515877468299595919"

def validate_url(url):
    if not isinstance(url, str) or len(url) > 1200:
        raise ValueError("Invalid HTTPS URL")
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname not in ("discord.com", "www.discord.com"):
        raise ValueError("Navigation restricted to discord.com")
    if parsed.username or parsed.password or parsed.fragment:
        raise ValueError("URL credentials and fragments not allowed")
    path = parsed.path
    if path not in ("/login", "/app", "/channels/@me") and not (
        path == "/channels/" + GUILD_ID or path.startswith("/channels/" + GUILD_ID + "/")
    ):
        raise ValueError("Navigation restricted to Discord login and the Naruto Project RP server")
    if parsed.query and path != "/login":
        raise ValueError("Unexpected query string")
    if len(parsed.query) > 160:
        raise ValueError("Query string too long")
    return url

def validate_command(command, run_id):
    if not isinstance(command, dict):
        raise ValueError("Command must be a JSON object")
    if str(command.get("session_id", "")) != str(run_id):
        raise ValueError("Command must target the active GitHub Actions run")
    ident = command.get("id")
    if not isinstance(ident, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", ident):
        raise ValueError("Invalid command id")
    action = command.get("action")
    if action not in ("status", "open_url", "read_page_text", "scroll", "click_navigation"):
        raise ValueError("Unsupported action: use status, open_url, read_page_text, scroll or click_navigation")
    if action == "open_url":
        validate_url(command.get("url"))
    if action == "scroll":
        if command.get("direction", "down") not in ("up", "down"):
            raise ValueError("Invalid scroll direction")
        amount = command.get("amount", 3)
        if type(amount) is not int or not 1 <= amount <= 8:
            raise ValueError("Scroll amount must be 1..8")
    if action == "click_navigation":
        url = command.get("url")
        validate_url(url)
        if "/channels/" + GUILD_ID not in url:
            raise ValueError("Navigation clicks limited to RP server channels")
    return action

def gh_get(path):
    proc = subprocess.run(
        ["gh", "api", "repos/" + REPO + "/contents/" + path],
        capture_output=True, text=True, timeout=24)
    if proc.returncode:
        raise RuntimeError("GitHub read failed (check actions contents permissions)")
    data = json.loads(proc.stdout)
    return json.loads(base64.b64decode(data["content"]).decode("utf-8")), data["sha"]

def gh_put(path, payload):
    raw = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    encoded = base64.b64encode(raw).decode("ascii")
    for attempt in range(3):
        _, sha = gh_get(path)
        params = {
            "message": "Bushin live command result " + str(payload.get("id", "unknown"))[:50],
            "branch": "main", "sha": sha, "content": encoded
        }
        proc = subprocess.run(
            ["gh", "api", "--method", "PUT", "repos/" + REPO + "/contents/" + path, "--input", "-"],
            input=json.dumps(params), text=True, capture_output=True, timeout=35)
        if proc.returncode == 0:
            return
        time.sleep(2)
    raise RuntimeError("Could not publish result to private GitHub repository")

async def get_page(browser):
    contexts = browser.contexts
    if not contexts or not contexts[0].pages:
        raise RuntimeError("No open browser page")
    return contexts[0].pages[0]

def redacted_page_url(url):
    parsed = urlsplit(url)
    if parsed.hostname not in ("discord.com", "www.discord.com"):
        return "outside discord.com"
    return parsed.scheme + "://" + parsed.hostname + parsed.path[:250]

async def perform(action, command):
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        browser = await pw.chromium.connect_over_cdp("http://127.0.0.1:9222", timeout=9000)
        try:
            page = await get_page(browser)
            current_url = redacted_page_url(page.url)
            if action == "status":
                return {"online": True, "url": current_url, "title": (await page.title())[:180]}
            if action == "open_url":
                address = validate_url(command["url"])
                await page.goto(address, wait_until="domcontentloaded", timeout=22000)
                return {"url": redacted_page_url(page.url), "title": (await page.title())[:180]}
            if action == "scroll":
                pixels = int(command.get("amount", 3)) * 170
                if command.get("direction", "down") == "up":
                    pixels = -pixels
                await page.mouse.wheel(0, pixels)
                await page.wait_for_timeout(400)
                return {"scroll_pixels": pixels, "url": redacted_page_url(page.url)}
            if action == "read_page_text":
                url = page.url
                allowed = urlsplit(url).hostname in ("discord.com", "www.discord.com") and (
                    urlsplit(url).path.startswith("/channels/" + GUILD_ID + "/")
                )
                if not allowed:
                    raise ValueError("Reading only allowed inside the requested Naruto Project RP server")
                value = (await page.locator("body").inner_text(timeout=9000))[-3500:]
                return {"url": redacted_page_url(page.url), "text": value, "note":
                        "Only text presently rendered on page; results are written in private repository history."}
            if action == "click_navigation":
                address = validate_url(command["url"])
                # A URL-based navigation is safer than arbitrary mouse clicks on private accounts.
                await page.goto(address, wait_until="domcontentloaded", timeout=22000)
                return {"url": redacted_page_url(page.url), "title": (await page.title())[:180]}
            raise ValueError("Unsupported action")
        finally:
            # Disconnecting the CDP client must not shut down the user's Chromium window.
            pass

async def listen_commands():
    run_id = os.environ.get("GITHUB_RUN_ID")
    if not run_id or not os.environ.get("GH_TOKEN"):
        print("Bushin control disabled: Actions run or scoped token missing", flush=True)
        return
    try:
        previous, _ = await asyncio.to_thread(gh_get, RESULT_FILE)
        last_id = previous.get("id") if isinstance(previous, dict) else None
    except Exception:
        last_id = None
    print("🍥 Bushin control ready: commands through private GitHub repository, run " + run_id, flush=True)
    while True:
        try:
            command, _ = await asyncio.to_thread(gh_get, COMMAND_FILE)
            current_id = command.get("id") if isinstance(command, dict) else None
            if (current_id and current_id != last_id
                    and str(command.get("session_id", "")) == str(run_id)):
                try:
                    action = validate_command(command, run_id)
                    value = await perform(action, command)
                    result = {"id": current_id, "session_id": run_id,
                              "action": action, "ok": True, "data": value}
                except Exception as exc:
                    result = {"id": current_id, "session_id": run_id,
                              "action": str(command.get("action", ""))[:30],
                              "ok": False, "error": str(exc)[:300]}
                result["finished_at_utc"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
                await asyncio.to_thread(gh_put, RESULT_FILE, result)
                last_id = current_id
                print("🍥 Bushin command processed:", current_id, "ok", result["ok"], flush=True)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            print("🍥 Bushin control transport temporarily unavailable:", type(exc).__name__, flush=True)
        await asyncio.sleep(8)
