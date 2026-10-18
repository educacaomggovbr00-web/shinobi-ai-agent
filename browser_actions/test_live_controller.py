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
        for action in ("type", "send_message", "post", "shell", "upload", "screenshot"):
            with self.subTest(action=action), self.assertRaises(ValueError):
                validate_command({"id": "test", "session_id": RUN, "action": action}, RUN)

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

if __name__ == "__main__":
    unittest.main()
