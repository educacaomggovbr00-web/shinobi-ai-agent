#!/usr/bin/env python3
"""Bushin Browser — Playwright on GitHub-hosted runners, no Codespaces."""
import argparse
import ipaddress
import json
from pathlib import Path
import sys
from urllib.parse import urlsplit

MAX_STEPS = 12
ALLOWED_ACTIONS = {"goto", "click", "fill", "press", "scroll", "wait", "extract", "screenshot"}

def check_url(url, main=True):
    if not isinstance(url, str) or len(url) > 1800:
        raise ValueError("URL inválida")
    parts = urlsplit(url)
    if (main and parts.scheme != "https") or (not main and parts.scheme not in ("https", "http")):
        raise ValueError("A URL principal exige HTTPS")
    host = parts.hostname
    if not host or parts.username or parts.password:
        raise ValueError("Host inválido ou credenciais na URL")
    if host.lower() == "localhost" or host.lower().endswith((".local", ".internal", ".localhost")):
        raise ValueError("Endereço interno bloqueado")
    try:
        ip = ipaddress.ip_address(host)
        if not ip.is_global:
            raise ValueError("Endereço IP privado/reservado bloqueado")
    except ValueError as exc:
        if "bloqueado" in str(exc):
            raise
    return url

def parse_steps(raw):
    steps = json.loads(raw)
    if not isinstance(steps, list) or len(steps) > MAX_STEPS:
        raise ValueError("Passos precisam ser lista com até 12 ações")
    for idx, step in enumerate(steps, 1):
        if not isinstance(step, dict) or step.get("action") not in ALLOWED_ACTIONS:
            raise ValueError("Ação inválida no passo %s" % idx)
        act = step["action"]
        if act == "goto":
            check_url(step.get("url"))
        if act in ("click", "fill", "extract"):
            sel = step.get("selector", "body" if act == "extract" else "")
            if not isinstance(sel, str) or not 0 < len(sel) < 300:
                raise ValueError("Seletor inválido no passo %s" % idx)
        if act == "fill" and (not isinstance(step.get("text"), str) or len(step["text"]) > 400):
            raise ValueError("Texto inválido no passo %s" % idx)
        if act == "press" and (not isinstance(step.get("key"), str) or len(step["key"]) > 30):
            raise ValueError("Tecla inválida")
        if act == "scroll" and (not isinstance(step.get("pixels", 500), int) or not -1800 <= step.get("pixels", 500) <= 1800):
            raise ValueError("Rolagem inválida")
        if act == "wait" and (not isinstance(step.get("ms", 500), int) or not 0 <= step.get("ms", 500) <= 5000):
            raise ValueError("Espera inválida")
    return steps

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--steps", default="[]")
    ap.add_argument("--out", default="bushin-output")
    args = ap.parse_args()
    check_url(args.url)
    steps = parse_steps(args.steps)
    out = Path(args.out)
    (out / "video").mkdir(parents=True, exist_ok=True)
    report = {"start_url": args.url, "steps_requested": len(steps), "actions": [], "ok": False}
    browser = context = page = None
    pw = None
    error = None
    try:
        from playwright.sync_api import sync_playwright
        pw = sync_playwright().start()
        browser = pw.chromium.launch(headless=True, args=["--no-sandbox"])
        context = browser.new_context(
            viewport={"width": 1365, "height": 768}, accept_downloads=False,
            record_video_dir=str(out / "video"),
            record_video_size={"width": 1365, "height": 768})
        page = context.new_page()
        page.set_default_timeout(8000)
        def guard(route):
            try:
                check_url(route.request.url, main=False)
                route.continue_()
            except ValueError:
                route.abort()
        page.route("**/*", guard)
        print("Bushin: abrindo navegador Chromium temporário", flush=True)
        page.goto(args.url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(1000)
        for idx, step in enumerate(steps, 1):
            action = step["action"]
            print("Passo %s/%s: %s" % (idx, len(steps), action), flush=True)
            if action == "goto":
                page.goto(step["url"], wait_until="domcontentloaded", timeout=30000)
            elif action == "click":
                page.locator(step["selector"]).first.click()
            elif action == "fill":
                target = page.locator(step["selector"]).first
                kind = (target.get_attribute("type") or "").lower()
                ac = (target.get_attribute("autocomplete") or "").lower()
                if kind in ("password", "hidden") or ac in ("one-time-code", "cc-number", "cc-csc"):
                    raise ValueError("Campo sensível bloqueado: não forneça credenciais no Actions")
                target.fill(step["text"])
            elif action == "press":
                if "selector" in step:
                    page.locator(step["selector"]).first.press(step["key"])
                else:
                    page.keyboard.press(step["key"])
            elif action == "scroll":
                page.mouse.wheel(0, step.get("pixels", 500))
            elif action == "wait":
                page.wait_for_timeout(step.get("ms", 500))
            elif action == "extract":
                value = page.locator(step.get("selector", "body")).first.inner_text(timeout=8000)
                (out / ("texto_passo_%s.txt" % idx)).write_text(value[:12000], encoding="utf-8")
            elif action == "screenshot":
                page.screenshot(path=str(out / ("passo_%s.png" % idx)), full_page=False)
            page.wait_for_timeout(350)
            if page.url.startswith(("http://", "https://")):
                check_url(page.url, main=False)
            elif page.url != "about:blank":
                raise ValueError("Redirecionamento para URL não permitida")
            report["actions"].append({"step": idx, "action": action, "ok": True, "url": page.url[:1600]})
        report["ok"] = True
        try:
            content = page.locator("body").inner_text(timeout=4500)
            (out / "pagina.txt").write_text(content[:12000], encoding="utf-8")
        except Exception:
            pass
    except Exception as exc:
        error = type(exc).__name__ + ": " + str(exc)[:700]
        report["error"] = error
        print("Falha na navegação: %s" % type(exc).__name__, file=sys.stderr)
    finally:
        if page is not None:
            try:
                report["final_url"] = page.url[:1800]
                report["title"] = page.title()[:300]
                page.screenshot(path=str(out / "final.png"), full_page=False, timeout=7000)
            except Exception:
                pass
        if context:
            try:
                context.close()
            except Exception:
                pass
        if browser:
            try:
                browser.close()
            except Exception:
                pass
        if pw:
            try:
                pw.stop()
            except Exception:
                pass
        (out / "relatorio.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print("Resultado:", json.dumps({"ok": report["ok"], "url": report.get("final_url"), "title": report.get("title"), "completed_steps": len(report["actions"]), "error": error}, ensure_ascii=False), flush=True)
    return 0 if report["ok"] else 1

if __name__ == "__main__":
    sys.exit(main())
