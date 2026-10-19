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
        for action in ("type", "send_message", "post", "shell", "upload"):
            with self.subTest(action=action), self.assertRaises(ValueError):
                validate_command({"id": "test", "session_id": RUN, "action": action}, RUN)

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
        for key in ("Enter", "Control+V", "Control+Shift+I", "Delete", "Space"):
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate_command({"id":"work3", "session_id":RUN, "action":"press", "key":key}, RUN)
        for text in ("", "x"*101, "hello\\nworld"):
            with self.subTest(search=text), self.assertRaises(ValueError):
                validate_command({"id":"work4", "session_id":RUN, "action":"type_search", "text":text}, RUN)

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

if __name__ == "__main__":
    unittest.main()
