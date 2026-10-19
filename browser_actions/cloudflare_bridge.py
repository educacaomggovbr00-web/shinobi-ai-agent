#!/usr/bin/env python3
"""Bushin visual bridge from a GitHub Actions Chromium job to the owner's D1 queue.

Identifies the runner via signed GitHub Actions OIDC, not a saved PAT.
No Discord credentials/cookies, GitHub tokens, or OIDC JWT go into the
repository, the Cloudflare database, console logs, or user-facing output.
"""
import asyncio
import json
import os
import re
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

BASE = "https://bushin-discord-direct.henrique-silva081106.workers.dev"
AUDIENCE = "bushin-cloudflare-visual-v1"
RUN_ID = os.environ.get("GITHUB_RUN_ID", "")
MAX_RESULT_CHARS = 11500


def send(path, method="GET", data=None, secret=None, timeout=15):
    if method not in ("GET", "POST"):
        raise ValueError("Unsupported HTTP method")
    headers = {"Accept": "application/json", "User-Agent": "Bushin-Visual-GitHub-Actions/1.0"}
    if secret:
        headers["Authorization"] = "Bearer " + secret
    payload = None if data is None else json.dumps(data, ensure_ascii=False).encode()
    if payload is not None:
        headers["Content-Type"] = "application/json"
    request = Request(BASE + path, data=payload, method=method, headers=headers)
    with urlopen(request, timeout=timeout) as response:
        raw = response.read(18000)
        return json.loads(raw.decode("utf-8"))


def id_token():
    request_url = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL", "")
    request_token = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN", "")
    if not request_url.startswith("https://") or not request_token:
        raise RuntimeError("GitHub Actions OIDC permission unavailable")
    separator = "&" if "?" in request_url else "?"
    url = request_url + separator + urlencode({"audience": AUDIENCE})
    req = Request(url, headers={"Authorization": "Bearer " + request_token})
    with urlopen(req, timeout=12) as response:
        data = json.loads(response.read(12000))
    token = data.get("value", "")
    if not isinstance(token, str) or len(token) < 150:
        raise RuntimeError("GitHub did not issue a valid OIDC token")
    return token


def register_runner():
    jwt = id_token()
    try:
        registered = send("/bridge/runner/register", "POST", {}, jwt)
    finally:
        del jwt
    if not registered.get("registered") or registered.get("run_id") != RUN_ID:
        raise RuntimeError("Bushin Cloudflare refused runner enrollment")
    secret = registered.get("runner_token")
    if not isinstance(secret, str) or len(secret) < 45:
        raise RuntimeError("Bushin returned no ephemeral runner token")
    return secret


async def run_bridge():
    if not re.fullmatch(r"[0-9]{8,20}", RUN_ID):
        raise RuntimeError("Missing GITHUB_RUN_ID")
    runner_token = await asyncio.to_thread(register_runner)
    print("🍥 Bushin visual bridge: verified by GitHub OIDC, ready for mobile commands", flush=True)
    from live_controller import validate_command, perform
    pending_failures = 0
    while True:
        try:
            result = await asyncio.to_thread(send, "/bridge/runner/poll?run_id=" + RUN_ID, "GET", None, runner_token)
            command = result.get("command")
            if command is not None:
                command_id = str(command.get("id", ""))
                action = str(command.get("action", ""))
                if not re.fullmatch(r"visual_[a-f0-9]{32}", command_id):
                    raise ValueError("Unexpected visual command identifier")
                try:
                    validate_command(command, RUN_ID)
                    data = await perform(action, command)
                    text = json.dumps(data, ensure_ascii=False, default=str)
                    if len(text) > MAX_RESULT_CHARS:
                        data = {"truncated": True, "preview": text[:MAX_RESULT_CHARS - 300]}
                    payload = {"id": command_id, "ok": True, "data": data}
                except Exception as error:
                    # Errors are deliberately bounded; never serialize browser
                    # cookies, HTTP Authorization values, or exception stacks.
                    payload = {"id": command_id, "ok": False,
                               "error": type(error).__name__ + ": " + str(error)[:300]}
                await asyncio.to_thread(send, "/bridge/runner/result?run_id=" + RUN_ID,
                                        "POST", payload, runner_token)
                print("🍥 Visual action:", action, "ok" if payload["ok"] else "failed", flush=True)
            pending_failures = 0
        except asyncio.CancelledError:
            raise
        except (HTTPError, URLError, TimeoutError, OSError, RuntimeError, ValueError) as error:
            pending_failures += 1
            if pending_failures in (1, 5, 12):
                print("🍥 Visual bridge connection unavailable:", type(error).__name__,
                      "retry", pending_failures, flush=True)
        await asyncio.sleep(4 if pending_failures == 0 else min(30, 4 * pending_failures))


if __name__ == "__main__":
    asyncio.run(run_bridge())
