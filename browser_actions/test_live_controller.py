import unittest

from live_controller import validate_url, validate_command

RUN = "39176481835"

class BushinRemoteTests(unittest.TestCase):
    def test_server_channel_allowed(self):
        url = "https://discord.com/channels/1515877468299595919/1520116350360617154"
        self.assertEqual(validate_url(url), url)

    def test_other_destinations_blocked(self):
        for url in (
            "https://discord.com/channels/@me/123456",
            "https://discord.com/channels/999999/1",
            "https://evil.test",
            "http://discord.com",
            "https://discord.com/settings",
            "https://discord.com/channels/1515877468299595919/1?token=abc",
            "https://discord.com@evil.test/channels/1515877468299595919/1",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError):
                validate_url(url)

    def test_session_binding(self):
        command = {"id": "check1", "session_id": RUN, "action": "status"}
        self.assertEqual(validate_command(command, RUN), "status")
        with self.assertRaises(ValueError):
            validate_command({**command, "session_id": "another-run"}, RUN)

    def test_no_posting_or_shell(self):
        for action in ("type", "post", "shell", "upload"):
            with self.subTest(action=action), self.assertRaises(ValueError):
                validate_command({"id": "test", "session_id": RUN, "action": action}, RUN)

    def test_message_commands_are_scoped_and_need_confirm(self):
        chan = "https://discord.com/channels/1515877468299595919/1520116350360617154"
        base = {"id": "outgoing1", "session_id": RUN,
                "channel_url": chan, "text": "Olá, estou disponível para treinar."}
        self.assertEqual(validate_command({**base, "action":"compose_message"}, RUN), "compose_message")
        with self.assertRaises(ValueError):
            validate_command({**base, "action":"send_message"}, RUN)
        self.assertEqual(validate_command({**base, "action":"send_message", "confirm":True}, RUN), "send_message")
        self.assertEqual(validate_command({**base, "action":"send_command", "text":"!status", "confirm":True}, RUN), "send_command")
        self.assertEqual(validate_command({**base, "action":"send_command", "text":"/ficha", "confirm":True}, RUN), "send_command")
        for target in (
            "https://discord.com/channels/@me/1520116350360617154",
            "https://discord.com/channels/999999999999999999/1520116350360617154",
            "https://discord.com/channels/1515877468299595919/1",
        ):
            with self.subTest(channel=target), self.assertRaises(ValueError):
                validate_command({**base, "channel_url":target, "action":"send_message", "confirm":True}, RUN)
        for content in ("", "bad\nline", "ping @everyone", "ola @here", "A"*501, " spaces "):
            with self.subTest(message=content[:25]), self.assertRaises(ValueError):
                validate_command({**base, "text":content, "action":"send_message", "confirm":True}, RUN)
        with self.assertRaises(ValueError):
            validate_command({**base, "action":"send_command", "text":"/", "confirm":True}, RUN)

    def test_explicit_screenshot_allowed(self):
        self.assertEqual(validate_command(
            {"id": "shot1", "session_id": RUN, "action": "screenshot"}, RUN
        ), "screenshot")

    def test_work_like_ui_actions(self):
        for action in ("inspect_ui", "click", "press", "type_search"):
            command = {"id": "work1", "session_id": RUN, "action": action}
            command.update({"x": 100, "y": 220} if action == "click" else {})
            command.update({"key": "Escape"} if action == "press" else {})
            command.update({"text": "Naruto"} if action == "type_search" else {})
            self.assertEqual(validate_command(command, RUN), action)

    def test_prevent_unsafe_ui_commands(self):
        for coords in ((-1,0), (1365,0), (0,768), ("5",5), (True,10)):
            with self.subTest(coords=coords), self.assertRaises(ValueError):
                validate_command({"id":"work2", "session_id":RUN, "action":"click", "x":coords[0], "y":coords[1]}, RUN)
        for key in ("Control+V", "Control+Shift+I", "Delete", "Space"):
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate_command({"id":"work3", "session_id":RUN, "action":"press", "key":key}, RUN)
        for text in ("", "x"*101, "hello\\nworld"):
            with self.subTest(search=text), self.assertRaises(ValueError):
                validate_command({"id":"work4", "session_id":RUN, "action":"type_search", "text":text}, RUN)

    def test_tabs_and_safe_enter(self):
        self.assertEqual(validate_command({"id":"tabs1","session_id":RUN,"action":"tabs"},RUN),"tabs")
        self.assertEqual(validate_command({"id":"tabs2","session_id":RUN,"action":"tabs","tab_index":1},RUN),"tabs")
        for bad in (-1,21,True,"1"):
            with self.assertRaises(ValueError):
                validate_command({"id":"tabs3","session_id":RUN,"action":"tabs","tab_index":bad},RUN)
        self.assertEqual(validate_command({"id":"key1","session_id":RUN,"action":"press","key":"Enter"},RUN),"press")

    def test_scroll_limits(self):
        for amount in (-1, 0, 9, 1.4, "3", True):
            with self.subTest(amount=amount), self.assertRaises(ValueError):
                validate_command({
                    "id": "test", "session_id": RUN,
                    "action": "scroll", "amount": amount
                }, RUN)
        self.assertEqual(
            validate_command({"id": "test", "session_id": RUN, "action": "scroll", "amount": 4}, RUN),
            "scroll"
        )

    def test_capture_gallery_authorized_channels_only(self):
        first = "https://discord.com/channels/1515877468299595919/1520116350360617154"
        second = "https://discord.com/channels/1515877468299595919/1544461080624111716"
        third = "https://discord.com/channels/1515877468299595919/1520114256740352061"
        command = {"id": "gallery1", "session_id": RUN,
                   "action": "capture_gallery", "urls": [first, second, third]}
        self.assertEqual(validate_command(command, RUN), "capture_gallery")
        forbidden = [
            [], [first], [first]*2, [first]*5,
            "not-an-array", [first, "https://discord.com/channels/@me/1000000000000000000"],
            [first, "https://discord.com/channels/9999999999999999999/1520114256740352061"],
            [first, "https://discord.com/login"],
            [first, "https://discord.com/channels/1515877468299595919/invalid"],
            [first, "https://discord.com/channels/1515877468299595919/1544461080624111716?token=x"],
        ]
        for urls in forbidden:
            with self.subTest(urls=urls), self.assertRaises(ValueError):
                validate_command({**command, "urls": urls}, RUN)

    def test_capture_gallery_session_binding(self):
        first = "https://discord.com/channels/1515877468299595919/1520116350360617154"
        second = "https://discord.com/channels/1515877468299595919/1544461080624111716"
        with self.assertRaises(ValueError):
            validate_command({"id":"gallery2", "session_id":"other-run",
                              "action":"capture_gallery", "urls":[first,second]}, RUN)

    def test_rpg_scout_safe_channels_and_session(self):
        first = "https://discord.com/channels/1515877468299595919/1520116350360617154"
        second = "https://discord.com/channels/1515877468299595919/1544461080624111716"
        third = "https://discord.com/channels/1515877468299595919/1520114256740352061"
        command = {"id": "rpgscout", "session_id": RUN,
                   "action": "rpg_scout", "urls": [first, second, third]}
        self.assertEqual(validate_command(command, RUN), "rpg_scout")
        self.assertEqual(validate_command(
            {"id": "rpgview", "session_id": RUN, "action": "rpg_view"}, RUN), "rpg_view")
        forbidden = [
            [], [first, first], [first]*5, "not-a-list",
            [first, "https://discord.com/channels/@me/123456789012345678"],
            [first, "https://discord.com/channels/999999999999999999/1520114256740352061"],
            [first, "https://discord.com/login"],
            [first, "https://discord.com/channels/1515877468299595919/invalid"],
            [first, second + "?tracking=1"],
        ]
        for urls in forbidden:
            with self.subTest(urls=urls), self.assertRaises(ValueError):
                validate_command({**command, "urls": urls}, RUN)
        with self.assertRaises(ValueError):
            validate_command({**command, "session_id":"different"}, RUN)

class BushinTabTests(unittest.IsolatedAsyncioTestCase):
    async def test_only_authorized_discord_rp_tabs_appear(self):
        from live_controller import safe_tabs
        class Page:
            def __init__(self,url):
                self.url=url;self.focused=False
            async def title(self):return "Tab"
            async def bring_to_front(self):self.focused=True
        pages=[
           Page("https://discord.com/channels/@me/123456789012345678"),
           Page("https://discord.com/channels/1515877468299595919/1520116350360617154"),
           Page("https://discord.com/channels/999999999999999999/1520116350360617154"),
           Page("https://discord.com/channels/1515877468299595919/1520114256740352061")
        ]
        class Context:pass
        c=Context();c.pages=pages
        class Browser:pass
        b=Browser();b.contexts=[c]
        result=await safe_tabs(b,1)
        self.assertEqual(result["count"],2)
        self.assertTrue(pages[3].focused)
        self.assertNotIn("@me",str(result))
        self.assertNotIn("/999999999999999999/",str(result))
        with self.assertRaises(ValueError):
            await safe_tabs(b,2)

class BushinScoutNavigationTests(unittest.IsolatedAsyncioTestCase):
    async def test_restores_channel_even_if_one_read_fails(self):
        from unittest.mock import AsyncMock, patch
        from live_controller import scout_rpg_channels
        original = "https://discord.com/channels/1515877468299595919/1520116350360617154"
        first = "https://discord.com/channels/1515877468299595919/1520114256740352061"
        second = "https://discord.com/channels/1515877468299595919/1544461080624111716"
        class FakePage:
            def __init__(self):
                self.url = original
                self.navigations = []
            async def goto(self, target, **kwargs):
                self.url = target
                self.navigations.append(target)
            async def wait_for_timeout(self, millis):
                pass
        page = FakePage()
        with patch("live_controller.extract_rpg_view", new=AsyncMock(side_effect=[
                {"url": first, "messages":[{"text":"treino"}], "topics":[]},
                RuntimeError("Discord temporarily unavailable")])):
            with self.assertRaises(RuntimeError):
                await scout_rpg_channels(page, [first, second])
        self.assertEqual(page.url, original)
        self.assertEqual(page.navigations, [first, second, original])

    async def test_collects_scoped_views_and_restores(self):
        from unittest.mock import AsyncMock, patch
        from live_controller import scout_rpg_channels
        original = "https://discord.com/channels/1515877468299595919/1520116350360617154"
        other = "https://discord.com/channels/1515877468299595919/1544461080624111716"
        class FakePage:
            url = original
            async def goto(self, dest, **kwargs):
                self.url = dest
            async def wait_for_timeout(self, millis):
                pass
        page = FakePage()
        with patch("live_controller.extract_rpg_view", new=AsyncMock(return_value={
                "url": other, "messages":[], "topics":["Guia de treino"]})):
            result = await scout_rpg_channels(page, [other])
        self.assertEqual(result["checked"], 1)
        self.assertEqual(result["channels"][0]["topics"], ["Guia de treino"])
        self.assertEqual(page.url, original)

if __name__ == "__main__":
    unittest.main()
