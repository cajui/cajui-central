"""The optional reference server must not expose configuration or product APIs."""
import importlib.util
from pathlib import Path
import threading
import unittest
import urllib.error
import urllib.request

spec = importlib.util.spec_from_file_location("brand_server", Path(__file__).parents[1] / "scripts/serve_brand.py")
brand = importlib.util.module_from_spec(spec)
spec.loader.exec_module(brand)


class BrandServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = brand.ThreadingHTTPServer(("127.0.0.1", 0), brand.ReferenceHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def test_reference_and_shared_assets(self):
        for path in ["/design/brand", "/design/components", "/design/dashboard", "/design/research", "/ui/components.mjs", "/ui/tokens.css"]:
            with self.subTest(path=path), urllib.request.urlopen(self.base + path) as response:
                self.assertEqual(response.status, 200)
                self.assertIn("script-src 'self'", response.headers["Content-Security-Policy"])
                self.assertGreater(len(response.read()), 0)

    def test_repository_and_traversal_are_not_exposed(self):
        for path in ["/.env", "/.en", "/README.md", "/api/v1/readings", "/ui/", "/docs/", "/../.env", "/%2e%2e/.env", "/ui/%2e%2e/server.go", "/ui/%252e%252e/server.go"]:
            with self.subTest(path=path), self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(self.base + path)
            self.assertEqual(error.exception.code, 404)

    def test_head_has_no_body(self):
        request = urllib.request.Request(self.base + "/design/brand", method="HEAD")
        with urllib.request.urlopen(request) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.read(), b"")
