#!/usr/bin/env python3
"""Temporary Bushin desktop on a GitHub Actions runner. The link is a secret."""
import asyncio
import hmac
import os
import re
import secrets
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import quote

from aiohttp import web, ClientSession, ClientTimeout, WSMsgType

DISPLAY = ":99"
PORT = 8787
BACKEND = "http://127.0.0.1:6081"
VNC_DIR = "/usr/share/novnc"
LOGIN_URL = "https://discord.com/login?redirect_to=%2Fstore"
MAX_SECONDS = 345 * 60

def safe_equal(left, right):
    return isinstance(left, str) and hmac.compare_digest(left.encode(), right.encode())

def make_app(secret):
    app = web.Application(client_max_size=1024 * 1024)
    app["secret"] = secret

    async def handler(request):
        if request.path == "/connect":
            supplied = request.query.get("key", "")
            if not safe_equal(supplied, secret):
                return web.Response(status=403, text="Acesso negado")
            response = web.HTTPFound("/vnc.html?autoconnect=1&resize=scale")
            response.set_cookie(
                "bushin_session", secret, max_age=MAX_SECONDS,
                secure=True, httponly=True, samesite="Lax", path="/")
            return response

        if not safe_equal(request.cookies.get("bushin_session", ""), secret):
            return web.Response(status=403, text="Use o link privado da execucao no GitHub Actions.")

        if request.path == "/":
            raise web.HTTPFound("/vnc.html?autoconnect=1&resize=scale")

        if request.headers.get("Upgrade", "").lower() == "websocket":
            frontend = web.WebSocketResponse(heartbeat=25, max_msg_size=16 * 1024 * 1024)
            await frontend.prepare(request)
            upstream_url = BACKEND.replace("http://", "ws://") + str(request.rel_url)
            try:
                async with ClientSession() as session:
                    async with session.ws_connect(upstream_url, heartbeat=25, max_msg_size=16 * 1024 * 1024) as backend:
                        async def forward_front():
                            async for message in frontend:
                                if message.type == WSMsgType.BINARY:
                                    await backend.send_bytes(message.data)
                                elif message.type == WSMsgType.TEXT:
                                    await backend.send_str(message.data)
                                else:
                                    break
                        async def forward_back():
                            async for message in backend:
                                if message.type == WSMsgType.BINARY:
                                    await frontend.send_bytes(message.data)
                                elif message.type == WSMsgType.TEXT:
                                    await frontend.send_str(message.data)
                                else:
                                    break
                        tasks = [asyncio.create_task(forward_front()), asyncio.create_task(forward_back())]
                        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                        for task in tasks:
                            task.cancel()
                        await asyncio.gather(*tasks, return_exceptions=True)
                        for task in done:
                            if not task.cancelled() and task.exception() is not None:
                                raise task.exception()
            except Exception:
                pass
            await frontend.close()
            return frontend

        if request.method != "GET":
            return web.Response(status=405, text="Metodo nao permitido")
        async with ClientSession(timeout=ClientTimeout(total=30), auto_decompress=False) as session:
            async with session.get(BACKEND + str(request.rel_url), allow_redirects=False) as upstream:
                payload = await upstream.read()
                response = web.Response(body=payload, status=upstream.status)
                for key in ("Content-Type", "Content-Encoding", "Cache-Control"):
                    if upstream.headers.get(key):
                        response.headers[key] = upstream.headers[key]
                return response

    app.router.add_route("*", "/{tail:.*}", handler)
    return app

def process(*args, env=None):
    return subprocess.Popen(
        list(args), env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        start_new_session=True)

async def start():
    secret = secrets.token_urlsafe(40)
    env = os.environ.copy()
    env["DISPLAY"] = DISPLAY
    processes = []
    browser_profile = Path("/tmp/bushin-private-discord-profile")
    browser_profile.mkdir(mode=0o700, parents=True, exist_ok=True)

    try:
        if not Path(VNC_DIR, "vnc.html").is_file():
            raise RuntimeError("Arquivos noVNC nao encontrados")
        processes.append(process("Xvfb", DISPLAY, "-screen", "0", "1365x768x24", "-nolisten", "tcp"))
        await asyncio.sleep(2)
        processes.append(process("openbox", env=env))
        processes.append(process(
            "x11vnc", "-display", DISPLAY, "-localhost", "-forever",
            "-shared", "-nopw", "-rfbport", "5900", "-quiet", env=env))
        processes.append(process(
            "websockify", "--web", VNC_DIR, "127.0.0.1:6081", "127.0.0.1:5900"))

        # Chromium binary installed by the Playwright setup step.
        from playwright.async_api import async_playwright
        pw = await async_playwright().start()
        chromium_bin = pw.chromium.executable_path
        await pw.stop()
        processes.append(process(
            chromium_bin, "--no-sandbox", "--disable-dev-shm-usage",
            "--no-first-run", "--disable-default-apps", "--disable-features=MediaRouter",
            "--user-data-dir=" + str(browser_profile), "--window-size=1300,720",
            LOGIN_URL, env=env))
        await asyncio.sleep(4)
        if any(p.poll() is not None for p in processes):
            raise RuntimeError("Um processo do desktop terminou antes de iniciar")

        gateway = web.AppRunner(make_app(secret), access_log=None)
        await gateway.setup()
        site = web.TCPSite(gateway, "127.0.0.1", PORT)
        await site.start()
        tunnel_bin = os.environ.get("CLOUDFLARED_BIN", "/tmp/cloudflared")
        tunnel = subprocess.Popen(
            [tunnel_bin, "tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:" + str(PORT)],
            text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            bufsize=1, start_new_session=True)
        processes.append(tunnel)

        loop = asyncio.get_running_loop()
        url_queue = asyncio.Queue()
        def read_tunnel():
            for line in tunnel.stdout:
                found = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", line)
                if found:
                    loop.call_soon_threadsafe(url_queue.put_nowait, found.group(0))
        import threading
        threading.Thread(target=read_tunnel, daemon=True).start()

        print("🍥 Bushin Linux iniciou; aguardando endereco HTTPS privado...", flush=True)
        try:
            base_url = await asyncio.wait_for(url_queue.get(), timeout=100)
        except asyncio.TimeoutError:
            raise RuntimeError("Cloudflare nao retornou endereco HTTPS em 100 segundos")

        user_url = base_url.rstrip("/") + "/connect?key=" + quote(secret)
        summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
        summary = (
            "## 🍥 Bushin Discord — desktop AO VIVO\n\n"
            "**Acesso privado (nao compartilhe):**\n\n"
            f"[Abrir navegador Linux para fazer login no Discord]({user_url})\n\n"
            "A janela do navegador abre o site do Discord. Entre e confirme 2FA apenas nela.\n\n"
            "**Seguranca:** link temporario autenticado, HTTPS, navegador sem gravacao "
            "ou exportacao de cookies. Quem tiver acesso ao link podera controlar a sessao.\n\n"
            "**Limite:** runner temporario, ate 5h45min depois do inicio do desktop; "
            "o GitHub encerra todo o job em ate 6h, incluindo instalacao. Ao desligar, o login se perde.\n")
        if summary_path:
            Path(summary_path).open("a", encoding="utf-8").write(summary)
        print("========================================================", flush=True)
        print("🍥 LINK PRIVADO - ABRA PARA FAZER LOGIN", flush=True)
        print(user_url, flush=True)
        print("========================================================", flush=True)
        print("NAO compartilhe este link. Ele controla a tela do Linux com acesso ao Discord.", flush=True)
        print("O desktop nao sera salvo nem tera suas senhas enviadas ao repositorio.", flush=True)

        started = time.monotonic()
        while time.monotonic() - started < MAX_SECONDS:
            await asyncio.sleep(30)
            if tunnel.poll() is not None:
                raise RuntimeError("Tunel seguro foi encerrado")
            if any(p.poll() is not None for p in processes[:4]):
                raise RuntimeError("Desktop ou servidor VNC parou")
            minutes = int((time.monotonic() - started) / 60)
            if minutes % 5 == 0:
                print("🍥 Linux online - %s min decorridos" % minutes, flush=True)
        print("Limite da sessao encerrado. Fechando navegador.", flush=True)
    finally:
        for p in reversed(processes):
            if p.poll() is None:
                try:
                    p.terminate()
                except OSError:
                    pass

if __name__ == "__main__":
    try:
        asyncio.run(start())
    except Exception as exc:
        print("Bushin live falhou: " + str(exc)[:300], file=sys.stderr, flush=True)
        sys.exit(1)
