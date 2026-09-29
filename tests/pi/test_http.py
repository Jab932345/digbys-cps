import importlib.util, os, threading, http.server
os.environ['HOME'] = '/tmp/pitest-http'; os.makedirs('/tmp/pitest-http/.digbys', exist_ok=True)
spec = importlib.util.spec_from_file_location('v2', os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'pi', 'printserver.py'))
v2 = importlib.util.module_from_spec(spec); spec.loader.exec_module(v2)
class Debut(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(301); self.send_header('Location', '/general/status.html'); self.end_headers()
    def version_string(self): return 'debut/1.30'
    def log_message(self, *a): pass
class Star(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = b'<html><title>Star Micronics TSP100IIILAN</title></html>'
        self.send_response(200); self.send_header('Content-Type', 'text/html'); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
class BrotherPage(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = b'<html><title>Brother QL-820NWB</title></html>'
        self.send_response(200); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
for ip, h in [('127.0.0.41', Debut), ('127.0.0.42', Star), ('127.0.0.43', BrotherPage)]:
    srv = http.server.HTTPServer((ip, 80), h); threading.Thread(target=srv.serve_forever, daemon=True).start()
print('PASS Brother recognised by its web server (debut, redirect)' if v2.looks_like_brother('127.0.0.41') else 'FAIL debut')
print('PASS Star receipt printer not taken for the Brother' if not v2.looks_like_brother('127.0.0.42') else 'FAIL star')
print('PASS Brother recognised by its page' if v2.looks_like_brother('127.0.0.43') else 'FAIL page')
print('PASS nothing listening → not a Brother' if not v2.looks_like_brother('127.0.0.44') else 'FAIL none')
