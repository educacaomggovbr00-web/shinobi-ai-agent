"""Regression tests for the public-but-authenticated noVNC gateway."""

import importlib.util
import unittest

AIOHTTP_READY = importlib.util.find_spec("aiohttp") is not None


@unittest.skipUnless(AIOHTTP_READY, "aiohttp is installed after desktop setup")
class GatewayTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from aiohttp.test_utils import TestClient, TestServer
        from live_desktop import make_app

        self.secret = "temporary-test-key-not-a-production-secret"
        self.server = TestServer(make_app(self.secret))
        self.client = TestClient(self.server)
        await self.client.start_server()
        # A local test server uses localhost; production uses a Cloudflare domain.
        self.origin = "https://" + self.client.make_url("/").authority

    async def asyncTearDown(self):
        await self.client.close()

    async def test_public_gate_not_vnc(self):
        response = await self.client.get("/vnc.html?autoconnect=1&resize=scale")
        self.assertEqual(response.status, 200)
        content = await response.text()
        self.assertIn("Bushin Linux", content)
        self.assertIn('type="password"', content)
        self.assertNotIn(self.secret, content)
        self.assertEqual(response.headers.get("Cache-Control"), "no-store, private")

    async def test_no_guest_access_to_desktop_files(self):
        response = await self.client.get("/app/ui.js")
        self.assertEqual(response.status, 403)
        response = await self.client.get("/websockify")
        self.assertEqual(response.status, 403)

    async def test_private_link_sets_secure_cookie(self):
        response = await self.client.get("/connect", params={"key": self.secret},
                                         allow_redirects=False)
        self.assertEqual(response.status, 302)
        self.assertEqual(response.headers["Location"], "/vnc.html?autoconnect=1&resize=scale")
        cookie = response.headers["Set-Cookie"].lower()
        self.assertIn("secure", cookie)
        self.assertIn("httponly", cookie)
        self.assertIn("samesite=lax", cookie)

    async def test_password_login_requires_correct_origin_and_key(self):
        response = await self.client.post("/login", data={"access_key": self.secret},
                                          allow_redirects=False)
        self.assertEqual(response.status, 403)
        response = await self.client.post("/login", data={"access_key": "incorrect"},
                                          headers={"Origin": self.origin},
                                          allow_redirects=False)
        self.assertEqual(response.status, 403)
        response = await self.client.post("/login", data={"access_key": self.secret},
                                          headers={"Origin": self.origin},
                                          allow_redirects=False)
        self.assertEqual(response.status, 302)
        self.assertIn("bushin_session=", response.headers["Set-Cookie"])

    async def test_cloudflare_origin_with_local_backend_host(self):
        # Reverse proxies may set Host=localhost while browser Origin is the public tunnel.
        public_origin = "https://bushin-test.example.trycloudflare.com"
        self.server.app["public_origin"]["url"] = public_origin
        response = await self.client.post(
            "/login", data={"access_key": self.secret},
            headers={"Origin": public_origin}, allow_redirects=False)
        self.assertEqual(response.status, 302)
        response = await self.client.post(
            "/login", data={"access_key": self.secret},
            headers={"Origin": "https://malicious.example"}, allow_redirects=False)
        self.assertEqual(response.status, 403)


if __name__ == "__main__":
    unittest.main()
