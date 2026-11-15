"""Standalone local server for the lunar observatory."""

from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import webbrowser


ROOT = Path(__file__).resolve().parent


class LunarHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        path = urlsplit(self.path).path
        generated_tile = (
            path.startswith("/assets/maps/map60-tiles/") and path.endswith(".png")
            or path.startswith("/assets/dem30/") and path.endswith(".bin.gz")
        )
        # Revalidate generated assets before reuse so regenerated tiles stay fresh.
        self.send_header("Cache-Control", "private, no-cache" if generated_tile else "no-store")
        super().end_headers()


def main() -> None:
    parser = argparse.ArgumentParser(description="Open C'est Lunaire locally.")
    parser.add_argument("--port", type=int, default=0, help="Local port (0 = automatically choose a free port).")
    parser.add_argument("--no-browser", action="store_true", help="Do not open the browser.")
    args = parser.parse_args()

    handler = partial(LunarHandler, directory=str(ROOT))
    with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
        url = f"http://127.0.0.1:{server.server_port}/index.html"
        print(f"C'est Lunaire : {url}", flush=True)
        print("Keep this window open; press Ctrl+C to stop the server.", flush=True)
        if not args.no_browser:
            webbrowser.open(url)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.", flush=True)


if __name__ == "__main__":
    main()
