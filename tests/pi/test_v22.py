"""Print server 2.2: whole queues in one request, status checks that don't
disturb a print, and CPS served on the kitchen Wi-Fi."""
import importlib.util, os, shutil, threading, time
HOME = '/tmp/pitest-v22'; shutil.rmtree(HOME, ignore_errors=True); os.makedirs(HOME + '/.digbys')
os.environ['HOME'] = HOME; os.environ['PRINTER_IP'] = '127.0.0.14'
spec = importlib.util.spec_from_file_location('v2', os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'pi', 'printserver.py'))
v2 = importlib.util.module_from_spec(spec); spec.loader.exec_module(v2)
v2.KNOWN_PRINTER_IPS[:] = []
ok = True
def check(label, cond, detail=''):
    global ok
    print(('PASS ' if cond else 'FAIL ') + label + ('' if cond else '  <-- ' + str(detail))); ok = ok and bool(cond)
sends, knocks = [], []
slow = [0.0]
def fake_net(ip, data, labels):
    sends.append(labels); time.sleep(slow[0]); return True
v2.send_network = fake_net
v2.usb_printer = lambda fresh=False: None
def fake_port(ip, port=9100, timeout=0.6):
    knocks.append(time.time()); return ip == '127.0.0.14'
v2.port_open = fake_port
c = v2.app.test_client()
lab = lambda i, **k: dict(plate=True, guest_name='Guest %d' % i, table='1', position=str(i), dietary='Nuts', urgency='allergy', printed_at='12:00', job_id='j%d' % i, **k)

r = c.post('/print', json={'jobs': [lab(i) for i in range(13)]}); d = r.get_json()
check('13 labels in one request: one send to the printer', r.status_code == 200 and d['success'] and len(sends) == 1 and d['printed'] == 13, d)
r = c.post('/print', json={'jobs': [lab(i) for i in range(13)] + [lab(99)]}); d = r.get_json()
check('resent queue: only the new label prints', d['success'] and d['printed'] == 1 and sum(1 for x in d['results'] if x.get('duplicate')) == 13, d)
r = c.post('/print', json={'jobs': [lab(100, quantity=50), lab(101, quantity=20)]})
check('more than 60 labels refused whole — nothing half-printed', r.status_code == 400 and len(sends) == 2)
v2.render_orig = v2.render
def bad_render(dct):
    if dct.get('guest_name') == 'Broken': raise ValueError('bad')
    return v2.render_orig(dct)
v2.render = bad_render
r = c.post('/print', json={'jobs': [lab(200), dict(lab(201), guest_name='Broken'), lab(202)]}); d = r.get_json()
check('one label that can’t be drawn: the others print, it’s reported', d['printed'] == 2 and [x['success'] for x in d['results']] == [True, False, True], d)
v2.render = v2.render_orig
def boom(images): raise RuntimeError('Printer not found on the network')
real = v2.print_images; v2.print_images = boom
r = c.post('/print', json={'jobs': [lab(300), lab(301)]}); d = r.get_json()
check('printer fails: every job reported not printed, error given', r.status_code == 500 and not any(x['success'] for x in d['results']) and 'not found' in d['error'])
v2.print_images = real
r = c.post('/print', json={'jobs': [lab(300), lab(301)]})
check('and they print on retry (not marked done by the failure)', r.get_json()['printed'] == 2)

# status while printing: reports busy, doesn't knock on the printer's port
slow[0] = 1.5; knocks.clear()
t = threading.Thread(target=lambda: c.post('/print', json=lab(400))); t.start(); time.sleep(0.3)
k0 = len(knocks); st = c.get('/status').get_json(); during = len(knocks) - k0; t.join()
check('during a print: status says busy and ready, printer left alone', st['busy'] and st['printer'] and during == 0, (st, during))
slow[0] = 0
v2._live['checked'] = 0; knocks.clear()
for _ in range(10): c.get('/status')
check('10 status checks in a row knock on the printer once', len(knocks) == 1, len(knocks))

# CPS on the kitchen Wi-Fi
app_dir = os.path.join(HOME, '.digbys', 'app')
v2._download = lambda path, limit=0: (_ for _ in ()).throw(OSError('offline'))
v2._appdl.update(at=0, running=False)
r = c.get('/')
check('not downloaded yet and offline: a clear message, not a crash', r.status_code == 503 and b'internet once' in r.data)
page = b"<!DOCTYPE html>\n<html lang=\"en-GB\">\n<head><title>Digby's CPS</title></head><body>" + b'x' * 120000 + b"</body>\n</html>\n"
files = {'': page, 'pi/VERSION': b'2.2.0\n'}
v2._download = lambda path, limit=0: files.get(path, b'icon')
v2._appdl.update(at=0, running=False)
r = c.get('/', environ_base={'REMOTE_ADDR': '192.168.7.50'})
check('downloads CPS and serves it marked as opened from the Pi', r.status_code == 200 and b'<html data-pi="1" lang="en-GB">' in r.data, r.data[:80])
check('the latest print server version is served too', c.get('/pi/VERSION').data.strip() == b'2.2.0')
files[''] = b"<html><title>Something else</title>"
v2.refresh_app()
check('a broken download never replaces the good copy', b"Digby's CPS" in c.get('/').data)
v2._download = lambda path, limit=0: (_ for _ in ()).throw(OSError('offline'))
v2._appdl.update(at=0, running=False)
check('internet down: the Pi still serves its copy', c.get('/').status_code == 200)
check('other paths aren’t served', c.get('/icons/../../x').status_code == 404 and c.get('/secret').status_code == 404)
st = c.get('/status').get_json()
check('status says it can batch and serve the app', st['batch'] and st['lan_app'] and 'usb_support' in st)
# part of a run printed: what's known printed is done, the rest isn't
v2.print_images = real
def part_usb(images):
    raise v2.PartPrinted('USB stopped after 5 of %d labels' % len(images), printed=5)
v2.print_images = part_usb
r = c.post('/print', json={'jobs': [lab(500, quantity=3), lab(501, quantity=2), lab(502, quantity=4)]}); d = r.get_json()
check('USB stops after 5 of 9: the first two jobs (3+2) are done, the third isn’t', [x['success'] for x in d['results']] == [True, True, False], d)
v2.print_images = real
r = c.post('/print', json={'jobs': [lab(500, quantity=3), lab(501, quantity=2), lab(502, quantity=4)]}).get_json()
check('retry prints only the unfinished job', r['printed'] == 4 and sum(1 for x in r['results'] if x.get('duplicate')) == 2, r)
v2.send_network = lambda ip, data, labels: 1234
r = c.post('/print', json={'jobs': [lab(600), lab(601)]}); d = r.get_json()
check('Wi-Fi drops part-way: reported as may have printed, nothing marked done', d.get('uncertain') and not any(x['success'] for x in d['results']), d)
r = c.post('/print', json=lab(602)); d = r.get_json()
check('same for a single run', r.status_code == 500 and d.get('uncertain'), d)
v2.send_network = fake_net
# the page reached through the tunnel isn't marked as the kitchen Wi-Fi route
r = c.get('/', headers={'X-Forwarded-For': '1.2.3.4'})
check('through the tunnel: not marked as opened on the kitchen Wi-Fi', b'data-pi' not in r.data)
r = c.get('/', environ_base={'REMOTE_ADDR': '192.168.7.50'})
check('on the kitchen Wi-Fi: marked', b'data-pi="1"' in r.data)
print('ALL PASS' if ok else 'SOME FAILED')
