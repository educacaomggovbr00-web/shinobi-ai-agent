import unittest
from runner import check_url, parse_steps

class BushinBrowserTests(unittest.TestCase):
    def test_https_public_url(self):
        self.assertEqual(check_url("https://example.com"), "https://example.com")

    def test_block_unsafe_urls(self):
        for url in ("http://example.com", "https://localhost", "https://127.0.0.1",
                    "https://192.168.1.3", "https://10.0.0.1",
                    "https://metadata.google.internal", "file:///etc/passwd"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                check_url(url)

    def test_action_validation(self):
        valid = '[{"action":"scroll","pixels":300},{"action":"extract","selector":"body"}]'
        self.assertEqual(len(parse_steps(valid)), 2)
        with self.assertRaises(ValueError):
            parse_steps('[{"action":"shell","command":"whoami"}]')
        with self.assertRaises(ValueError):
            parse_steps('[{"action":"fill","selector":"#q","text":22}]')
        with self.assertRaises(ValueError):
            parse_steps('[{"action":"goto","url":"http://localhost"}]')

if __name__ == "__main__":
    unittest.main()
