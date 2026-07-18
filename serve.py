# ponytail: dev server = http.server + no-store so edits always ship; any static host works in prod
import http.server
import os


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


http.server.ThreadingHTTPServer(('', int(os.environ.get('PORT', 8437))), NoCacheHandler).serve_forever()
