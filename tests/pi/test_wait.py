"""While a long run has the printer, other prints wait a bounded time and then
answer "busy" — nothing printed, so a retry can't print twice. Kitchen Prep's
labels carry no job_id and Kitchen Prep stops waiting after 15 s: when a long
run outlasts that and its Retry sends the same labels again, they're answered
"printed" rather than printed a second time — once."""
import importlib.util, os, shutil, threading, time
HOME = '/tmp/pitest-wait'; shutil.rmtree(HOME, ignore_errors=True); os.makedirs(HOME + '/.digbys')
os.environ['HOME'] = HOME; os.environ['PRINTER_IP'] = '127.0.0.16'
spec = importlib.util.spec_from_file_location('v2', os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'pi', 'printserver.py'))
v2 = importlib.util.module_from_spec(spec); spec.loader.exec_module(v2)
v2.KNOWN_PRINTER_IPS[:] = []
ok = True
def check(label, cond, detail=''):
    global ok
    print(('PASS ' if cond else 'FAIL ') + label + ('' if cond else '  <-- ' + str(detail))); ok = ok and bool(cond)

sends = []
slow = [0.0]
def fake_net(ip, data, labels):
    time.sleep(slow[0]); sends.append(labels); return True
v2.send_network = fake_net
v2.usb_printer = lambda fresh=False: None
v2.port_open = lambda ip, port=9100, timeout=0.6: ip == '127.0.0.16'
v2.JOB_WAIT, v2.NO_ID_WAIT, v2.KP_GIVES_UP = 1.0, 1.0, 0.6     # seconds, shortened for the test
c = v2.app.test_client()
kp = lambda name, **k: {**dict(product_name=name, staff_name='Ellie', date_prepped='2026-10-13', date_useby='2026-10-16', quantity=2, printed_at='10:00'), **k}
cps = lambda i: dict(plate=True, guest_name='Guest %d' % i, table='1', position=str(i), dietary='Nuts', urgency='allergy', printed_at='12:00', job_id='w%d' % i)

def in_background(fn):
    out = {}
    t = threading.Thread(target=lambda: out.update(r=fn())); t.start()
    return t, out

# a long CPS run has the printer
slow[0] = 3.0
t, long_run = in_background(lambda: c.post('/print', json={'jobs': [cps(i) for i in range(12)]}))
time.sleep(0.3)
t0 = time.time(); r = c.post('/print', json=kp('Brioche')); dt = time.time() - t0
check('Kitchen Prep label during a long run: "busy" in %.1fs, not printed late' % dt, r.status_code == 503 and r.get_json()['busy'] and dt < 1.6 and not sends, r.get_json())
t0 = time.time(); r = c.post('/print', json=cps(50)); dt = time.time() - t0
check('CPS label during a long run: waits, then "busy" (%.1fs)' % dt, r.status_code == 503 and r.get_json()['busy'] and 0.8 < dt < 1.8, r.get_json())
r = c.post('/print', json={'jobs': [cps(51), cps(52)]}); d = r.get_json()
check('a queue during a long run: "busy", each job said not printed', r.status_code == 503 and d['busy'] and all(x['busy'] and not x['success'] for x in d['results']), d)
t.join()
check('the long run itself printed', long_run['r'].status_code == 200 and sends == [12], (long_run['r'].get_json(), sends))
slow[0] = 0.0
r = c.post('/print', json=cps(50))
check('after "busy" the same job prints (it wasn’t marked done)', r.get_json()['success'] and not r.get_json().get('duplicate') and sends == [12, 1], (r.get_json(), sends))
r = c.post('/print', json=kp('Brioche'))
check('and the Kitchen Prep label prints when asked again', r.get_json()['success'] and sends[-1] == 2, sends)

# Kitchen Prep gives up on a long run, then its Retry sends the same labels
sends.clear(); slow[0] = 0.8
r1 = c.post('/print', json=kp('Short Rib')).get_json()
r2 = c.post('/print', json=kp('Short Rib', **{'printed_at': '10:01'})).get_json()
check('Retry after a run Kitchen Prep gave up on: answered printed, not printed twice', r1['success'] and r2['success'] and r2.get('duplicate') and sends == [2], (r2, sends))
r3 = c.post('/print', json=kp('Short Rib', **{'printed_at': '10:03'})).get_json()
check('asked again after that: on purpose, so it prints', r3['success'] and not r3.get('duplicate') and sends == [2, 2], sends)
r4 = c.post('/print', json=dict(kp('Short Rib'), quantity=3)).get_json()
check('a different count is a different print', r4['success'] and sends[-1] == 3, sends)

# a quick run: Kitchen Prep had its answer, so the same labels again are on purpose
sends.clear(); slow[0] = 0.0
c.post('/print', json=kp('Focaccia')); c.post('/print', json=kp('Focaccia'))
check('same labels twice after a quick run: both print', sends == [2, 2], sends)

# Retry while the first is still printing: waits for it, answered printed
sends.clear(); slow[0] = 0.5; v2.NO_ID_WAIT = 2.0
t, first = in_background(lambda: c.post('/print', json=kp('Lamb Shoulder')))
time.sleep(0.15)
r = c.post('/print', json=kp('Lamb Shoulder', **{'printed_at': '10:05'})).get_json(); t.join()
check('Retry while the run is still going: waits, answered printed, printed once', first['r'].get_json()['success'] and r.get('duplicate') and sends == [2], (r, sends))

# still going after the wait: "busy", nothing printed
sends.clear(); slow[0] = 2.0; v2.NO_ID_WAIT = 0.5
t, first = in_background(lambda: c.post('/print', json=kp('Beef Shin')))
time.sleep(0.15)
r = c.post('/print', json=kp('Beef Shin', **{'printed_at': '10:06'})); t.join()
check('Retry while a long run is still going: "still printing", not printed', r.status_code == 503 and 'Still printing' in r.get_json()['error'] and sends == [2], (r.get_json(), sends))

# the first run failed: the retry prints
sends.clear(); slow[0] = 0.0; v2.NO_ID_WAIT = 1.0
real_send = v2._send
def fail_once(images):
    v2._send = real_send
    raise RuntimeError('Printer not found on the network')
v2._send = fail_once
r1 = c.post('/print', json=kp('Pork Belly')); r2 = c.post('/print', json=kp('Pork Belly'))
check('a run that failed: the retry prints', r1.status_code == 500 and r2.get_json()['success'] and not r2.get_json().get('duplicate') and sends == [2], (r2.get_json(), sends))

# Retry tapped twice at once after a run that failed: one prints, the other is told it printed
sends.clear(); slow[0] = 0.5
v2._send = fail_once
c.post('/print', json=kp('Hake'))
t1, a = in_background(lambda: c.post('/print', json=kp('Hake', printed_at='10:07')))
t2, b = in_background(lambda: c.post('/print', json=kp('Hake', printed_at='10:07')))
t1.join(); t2.join()
ra, rb = a['r'].get_json(), b['r'].get_json()
check('Retry double-tapped after a failed run: printed once, both told printed', ra['success'] and rb['success'] and sends == [2] and (ra.get('duplicate') or rb.get('duplicate')), (ra, rb, sends))

# just under Kitchen Prep's wait: it had its answer, so the same labels again are on purpose
sends.clear(); slow[0] = 0.4
c.post('/print', json=kp('Gnocchi')); c.post('/print', json=kp('Gnocchi', printed_at='10:09'))
check('a run just shorter than Kitchen Prep’s wait: the same labels again print', sends == [2, 2], sends)

# a printer that's switched off: reported in about 20 s, not a minute
slow[0] = 0.0
v2.port_open = lambda ip, port=9100, timeout=0.6: False
v2.pi_ip = lambda: '127.0.0.1'
v2._printer['sent_at'] = 0
t0 = time.time(); r = c.post('/print', json=cps(900)); dt = time.time() - t0
check('printer switched off: "not found" in %.0fs' % dt, r.status_code == 500 and 'not found' in r.get_json()['error'] and dt < 18, (r.get_json(), dt))
print('ALL PASS' if ok else 'SOME FAILED')
