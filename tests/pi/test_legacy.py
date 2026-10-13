"""Routes from the Pi's previous server keep working under the new one, pointed
at the printer the new one found; printer discovery finds a printer that moved."""
import importlib.util, os, socket, sys, threading, time, json

HOME = '/tmp/pitest-legacy-home'
os.makedirs(HOME + '/.digbys', exist_ok=True)
for f in ('printer_ip',):
    try: os.remove(HOME + '/.digbys/' + f)
    except OSError: pass
os.environ['HOME'] = HOME

# A stand-in printer: listens on 127.0.0.5:9100 and counts bytes received.
got = {'bytes': 0, 'jobs': 0}
srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(('127.0.0.5', 9100)); srv.listen(8)
def accept():
    while True:
        try: c, _ = srv.accept()
        except OSError: return
        n = 0
        while True:
            b = c.recv(65536)
            if not b: break
            n += len(b)
        if n: got['bytes'] += n; got['jobs'] += 1
        c.close()
threading.Thread(target=accept, daemon=True).start()

# The previous server, as a stand-in: its own /print, a receipt route and a
# butchery route that prints with its own hard-coded (now wrong) printer address.
open(HOME + '/.digbys/legacy_printserver.py', 'w').write('''
from flask import Flask, request, jsonify
from flask_cors import CORS
from brother_ql.raster import BrotherQLRaster
from brother_ql.backends.helpers import send
from brother_ql.conversion import convert
from PIL import Image, ImageDraw
app = Flask(__name__)
CORS(app)
PRINTER_IP = 'tcp://10.9.9.9'
@app.route('/print', methods=['POST'])
def print_label():
    return jsonify({'success': False, 'error': 'old print route must not be used'}), 500
@app.route('/receipt', methods=['POST'])
def receipt():
    d = request.json or {}
    return jsonify({'success': True, 'title': d.get('title')})
@app.route('/butchery/label', methods=['POST'])
def butchery():
    img = Image.new('RGB', (696, 200), 'white')
    ImageDraw.Draw(img).rectangle([0, 0, 696, 60], fill='black')
    qlr = BrotherQLRaster('QL-820NWB')
    ins = convert(qlr=qlr, images=[img], label='62', rotate='0', threshold=70.0, dither=False, compress=False, red=True, dpi_600=False, hq=True, cut=True)
    send(instructions=ins, printer_identifier=PRINTER_IP, backend_identifier='network', blocking=True)
    return jsonify({'success': True})
if __name__ == '__main__':
    app.run(port=3000)
''')

spec = importlib.util.spec_from_file_location('v2', os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'pi', 'printserver.py'))
v2 = importlib.util.module_from_spec(spec); spec.loader.exec_module(v2)
v2.KNOWN_PRINTER_IPS[:] = []                 # nothing known: must be found by scanning
v2.pi_ip = lambda: '127.0.0.1'               # scan 127.0.0.0/24 → finds 127.0.0.5
v2.looks_like_brother = lambda ip: ip == '127.0.0.5'   # its web page says Brother
c = v2.app.test_client()
ok = True
def check(label, cond, detail=''):
    global ok
    print(('PASS ' if cond else 'FAIL ') + label + ('' if cond else '  <-- ' + str(detail))); ok = ok and bool(cond)

check('legacy routes carried over', set(v2.LEGACY['routes']) == {'/receipt', '/butchery/label'} and v2.LEGACY['error'] is None)
t = time.time(); ip = v2.find_printer(); dt = time.time() - t
check('scan finds the printer (%.1fs)' % dt, ip == '127.0.0.5')
check('address remembered for next time', open(HOME + '/.digbys/printer_ip').read() == '127.0.0.5')
r = c.get('/status'); st = r.get_json()
check('status reports version, printer and routes', st['version'] == v2.VERSION and st['printer'] is True and st['printer_ip'] == '127.0.0.5' and st['receipt'] is True)
r = c.post('/print', json={'product_name': 'Plain Scones', 'date_prepped': '2026-09-28', 'date_useby': '2026-09-30', 'staff_name': 'James', 'printed_at': '09:00', 'quantity': 2})
time.sleep(0.4)
check('new /print used, job reaches printer', r.get_json().get('success') and got['jobs'] == 1 and got['bytes'] > 1000)
r = c.post('/butchery/label', json={})
time.sleep(0.4)
check('old butchery route prints to the found printer, not its stale address', r.get_json().get('success') and got['jobs'] == 2)
r = c.post('/receipt', json={'title': 'Shopping'})
check('old receipt route answers', r.get_json() == {'success': True, 'title': 'Shopping'})
r = c.open('/receipt', method='OPTIONS', headers={'Origin': 'https://digbys-cps.vercel.app', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,ngrok-skip-browser-warning'})
check('CORS allowed on carried-over routes', r.headers.get('Access-Control-Allow-Origin') in ('*', 'https://digbys-cps.vercel.app'))
r = c.post('/print', json={'storage': True, 'product_name': 'Plain Flour', 'date_prepped': '2026-09-28', 'contains': 'Gluten', 'printed_at': 'x', 'quantity': 'lots'})
time.sleep(0.4)
check('bad quantity falls back to one label', r.get_json().get('success') and got['jobs'] == 3)
# a run has the printer: a butchery label (Kitchen Prep waits 8 s) is told "busy", not printed late
v2._send_lock.acquire()
threading.Timer(6.0, v2._send_lock.release).start()
t = time.time(); r = c.post('/butchery/label', json={}); dt = time.time() - t
time.sleep(0.3)
check('butchery label while the printer is busy: "busy" in %.1fs, said in words, nothing printed' % dt, r.status_code == 503 and r.data.decode().startswith('The printer is busy') and dt < 6 and got['jobs'] == 3, (r.status_code, r.data[:120]))
time.sleep(1.0)
r = c.post('/butchery/label', json={}); time.sleep(0.4)
check('and prints when asked again', r.get_json().get('success') and got['jobs'] == 4)
# printer moves: stop answering on the remembered address → print fails cleanly with a plain reason
srv.shutdown(socket.SHUT_RDWR); srv.close(); time.sleep(0.2)
v2.pi_ip = lambda: '127.0.0.1'
r = c.post('/print', json={'product_name': 'X', 'printed_at': '1'})
j = r.get_json()
check('printer gone → clear error, no crash', r.status_code == 500 and 'not found' in j.get('error', '').lower())
r = c.post('/update')
check('/update refuses until installed once over SSH', r.status_code == 409)
print('ALL PASS' if ok else 'SOME FAILED'); sys.exit(0 if ok else 1)
