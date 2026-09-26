#!/usr/bin/env python3
"""Serve the brand reference on loopback, without exposing the repository."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
TYPES = {".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
         ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml",
         ".ttf": "font/ttf", ".txt": "text/plain; charset=utf-8"}
PAGES = {"/": "index.html", "/design/brand": "index.html",
         "/design/components": "components.html", "/design/dashboard": "dashboard.html",
         "/design/research": "research.html"}


def reference_files():
    """Only the reference and shared UI assets are addressable; no directory listing."""
    files = {route: ROOT / "docs/brand" / name for route, name in PAGES.items()}
    for directory, prefix in [(ROOT / "docs/brand", "/"), (ROOT / "internal/httpapi/ui", "/ui/")]:
        for path in directory.rglob("*"):
            if path.is_file() and path.suffix in TYPES and not path.is_symlink():
                files[prefix + path.relative_to(directory).as_posix()] = path
    return files


class ReferenceHandler(BaseHTTPRequestHandler):
    files = reference_files()

    def do_GET(self):
        self.serve(include_body=True)

    def do_HEAD(self):
        self.serve(include_body=False)

    def serve(self, include_body):
        path = self.files.get(unquote(urlsplit(self.path).path))
        if path is None:
            self.send_error(404)
            return
        try:
            data = path.read_bytes()
        except OSError:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", TYPES[path.suffix])
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
        self.end_headers()
        if include_body:
            self.wfile.write(data)

    def log_message(self, *_):
        pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8092)
    args = parser.parse_args()
    with ThreadingHTTPServer(("127.0.0.1", args.port), ReferenceHandler) as server:
        print(f"Design documentation: http://127.0.0.1:{args.port}/design/brand", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
