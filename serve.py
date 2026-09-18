#!/usr/bin/env python3
"""Serve SAE and discover games/ and bios/ without a build or dependencies."""
import argparse
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

APP = Path(__file__).resolve().parent
MAX_FILES = 10000


def library_files(root):
    result = []
    for category in ("games", "bios"):
        base = (root / category).resolve()
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*")):
            relative = path.relative_to(base)
            if any(part.startswith(".") for part in relative.parts):
                continue
            if not path.is_file() or not path.resolve().is_relative_to(base):
                continue
            name = category + "/" + relative.as_posix()
            result.append({"path": name, "name": path.name, "size": path.stat().st_size,
                           "url": "/library/" + quote(name, safe="/")})
            if len(result) >= MAX_FILES:
                raise ValueError("Library has more than 10,000 files. Choose a smaller library folder.")
    return result


def make_handler(root):
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(APP), **kwargs)

        def do_GET(self):
            path = unquote(urlsplit(self.path).path)
            if path == "/api/library":
                try:
                    payload = {"files": library_files(root), "source": "folders"}
                    self.send_response(200)
                except (OSError, ValueError) as error:
                    payload = {"error": str(error)}
                    self.send_response(400)
                data = json.dumps(payload).encode()
                self.send_header("Content-Type", "application/json")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            if path.startswith("/library/"):
                relative = Path(path[len("/library/"):])
                if not relative.parts or relative.parts[0] not in ("games", "bios"):
                    self.send_error(404)
                    return
                base = (root / relative.parts[0]).resolve()
                target = (root / relative).resolve()
                if not target.is_relative_to(base) or not target.is_file():
                    self.send_error(404)
                    return
                try:
                    with target.open("rb") as stream:
                        self.send_response(200)
                        self.send_header("Content-Type", self.guess_type(str(target)))
                        self.send_header("Content-Length", str(target.stat().st_size))
                        self.end_headers()
                        self.copyfile(stream, self.wfile)
                except OSError:
                    self.send_error(404)
                return
            if path == "/":
                self.path = "/index.htm"
            super().do_GET()

        def end_headers(self):
            self.send_header("X-Content-Type-Options", "nosniff")
            super().end_headers()
    return Handler


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--library", type=Path, default=APP,
                        help="Folder containing games/ and bios/ (default: beside this script)")
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(args.library.resolve()))
    print(f"Your Amiga is ready at http://localhost:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
