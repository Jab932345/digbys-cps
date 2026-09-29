import sys, json, time, os
TESTS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TESTS)
sys.path.insert(0, TESTS)
os.environ.setdefault('PLAYWRIGHT_BROWSERS_PATH', '/opt/pw-browsers')
from playwright.sync_api import sync_playwright
import mock

APP = 'http://127.0.0.1:8765/index.html'
import threading, http.server, socketserver, functools, socket as _sock
def _serve():
    try:
        with _sock.create_connection(('127.0.0.1', 8765), timeout=0.3): return
    except OSError: pass
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    class Q(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    handler = functools.partial(Q, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 8765), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
_serve()
CPS_URL = 'https://jaajrllkozknilvmdezt.supabase.co/rest/v1/'
KP_URL = 'https://qfnwyooipwtfzikukztz.supabase.co/rest/v1/'
PI_URL = 'https://palatable-shack-scallion.ngrok-free.dev/'
SHOTS = os.path.join(TESTS, 'shots')
os.makedirs(SHOTS, exist_ok=True)

class Env:
    def __init__(self, pw, width=1440, height=900, dark=False, ext=False, mobile=False):
        self.cps = mock.DB('cps', mock.cps_seed(), ext=ext)
        self.kp = mock.DB('kp', mock.kp_seed())
        self.pi = PI
        self.pi.mode = 'ok'; self.pi.payloads.clear()
        self.browser = pw.chromium.launch()
        self.ctx = self.browser.new_context(viewport={'width': width, 'height': height}, color_scheme='dark' if dark else 'light',
                                            device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile)
        self.page = self.ctx.new_page()
        self.errors = []
        self.page.on('console', lambda m: self.errors.append(m.text) if m.type == 'error' else None)
        self.page.on('pageerror', lambda e: self.errors.append('PAGEERROR ' + str(e)))
        self.page.route('https://fonts.googleapis.com/**', lambda r, q: r.fulfill(status=200, content_type='text/css', body=''))
        self.page.route('https://fonts.gstatic.com/**', lambda r, q: r.abort())
        mock.attach_db(self.page, CPS_URL, self.cps)
        mock.attach_db(self.page, KP_URL, self.kp)
        self.page.route(PI_URL + '**', self.pi.handle)
    def open(self, fresh=True):
        self.page.goto(APP)
        if fresh:
            self.page.evaluate('localStorage.clear()')
            self.page.goto(APP)
        return self.page
    def login(self, who='James Brierley', pin='1810'):
        p = self.page
        p.wait_for_selector('.staff-btn')
        p.click(f'.staff-btn:has-text("{who.split()[0]}")')
        for ch in pin:
            p.click(f'.key[data-v="{ch}"]')
        p.wait_for_selector('#app:not([hidden])')
        p.wait_for_timeout(400)
    def shot(self, name, full=False):
        self.page.screenshot(path=f'{SHOTS}/{name}.png', full_page=full)
    def close(self):
        self.browser.close()

PRINTER = mock.FakePrinter()
PI = mock.Pi()
PI.mod.find_printer()

RESULTS = []
def check(label, cond, detail=''):
    RESULTS.append((label, bool(cond)))
    print(('PASS ' if cond else 'FAIL ') + label + ('' if cond else '  <-- ' + str(detail)))
    return cond
def summary():
    bad = [l for l, ok in RESULTS if not ok]
    print(f"\n{len(RESULTS)-len(bad)}/{len(RESULTS)} passed")
    for l in bad: print('  FAILED:', l)
    return not bad
def last_pj(env):
    return env.cps.t['print_jobs'][-1]
def wait_payloads(env, n, timeout=6000):
    t = time.time()
    while len(env.pi.payloads) < n and (time.time() - t) * 1000 < timeout:
        env.page.wait_for_timeout(100)
    return len(env.pi.payloads) >= n
