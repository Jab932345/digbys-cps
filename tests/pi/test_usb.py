"""USB first, Wi-Fi second. Over USB the printer reports back: each label is
confirmed before the next, a problem it reports is said before anything is
sent, and anything that goes wrong once a label has started going is "may have
printed" — never sent again over Wi-Fi. A stand-in for the Brother's USB side
answers the way the QL-820NWB does, with its timing."""
import importlib.util, os, time
os.environ['HOME'] = '/tmp/pitest-usb'; os.makedirs('/tmp/pitest-usb/.digbys', exist_ok=True)
os.environ['PRINTER_IP'] = '127.0.0.13'
spec = importlib.util.spec_from_file_location('v2', os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'pi', 'printserver.py'))
v2 = importlib.util.module_from_spec(spec); spec.loader.exec_module(v2)
v2.KNOWN_PRINTER_IPS[:] = []
ok = True
def check(label, cond, detail=''):
    global ok
    print(('PASS ' if cond else 'FAIL ') + label + ('' if cond else '  <-- ' + str(detail))); ok = ok and bool(cond)


def status(kind, phase=0, err1=0, err2=0):
    b = bytearray(32); b[0:3] = b'\x80\x20\x42'; b[8] = err1; b[9] = err2; b[10] = 62; b[11] = 0x0A
    b[18] = kind; b[19] = phase
    return bytes(b)
REPLY, DONE, PRINTING, WAITING, NOTE = status(0x00), status(0x01, 1), status(0x06, 1), status(0x06, 0), status(0x05, 1)
NO_MEDIA = dict(err1=1)
LID_OPEN = dict(err2=1 << 4)
JAM = dict(err1=1 << 2)


class ShortWrites:
    """pyusb after a write timeout: returns how much went, without an error —
    here on a label (the short status request goes in whole)."""
    def write(self, data, timeout):
        if len(data) < 1000:
            FakeUSB.log.append('status')
            return len(data)
        FakeUSB.log.append('label-part')
        return len(data) // 2


class FakeUSB:
    """What the printer does: replies to a status request; for each label,
    reply, printing, printed, waiting. A mode changes one label."""
    mode = 'ok'
    at = 0
    log = []
    opened = disposed = 0

    def __init__(self, ident):
        if FakeUSB.mode == 'refuse_open':
            raise IOError('[Errno 13] Access denied (insufficient permissions)')
        FakeUSB.opened += 1
        self.q = [(0, WAITING), (0, status(0x02, 0, **JAM))]   # left unread from an earlier run
        if FakeUSB.mode == 'short_write':
            self.write_dev, self.write_timeout = ShortWrites(), 15000
            self.q.append((time.time() + 0.05, REPLY))      # its answer to the status request
    def later(self, *items):
        t = time.time()
        for delay, b in items:
            self.q.append((t + delay, b))
    def read(self, length=32):
        if FakeUSB.mode == 'silent':
            time.sleep(0.05); raise IOError('[Errno 110] Operation timed out')
        if self.q and self.q[0][0] <= time.time():
            return self.q.pop(0)[1]
        return b''
    def write(self, data):
        if data == v2.STATUS_REQUEST:
            FakeUSB.log.append('status')
            self.later((0, status(0x00, 0, **NO_MEDIA) if FakeUSB.mode == 'no_media' else REPLY))
            return
        n = FakeUSB.log.count('label') + 1
        if FakeUSB.mode == 'write_fails_at' and n == FakeUSB.at:
            raise IOError('[Errno 19] No such device (it may have been disconnected)')
        FakeUSB.log.append('label')
        here = n == FakeUSB.at
        if FakeUSB.mode == 'lid_at' and here:         # opened while it printed
            self.later((0, REPLY), (0, PRINTING), (0.05, status(0x02, 0, **LID_OPEN)))
        elif FakeUSB.mode == 'runs_out_at' and here:  # noticed in its reply, before printing
            self.later((0, status(0x00, 0, **NO_MEDIA)))
        elif FakeUSB.mode == 'stalls_at' and here:    # starts, never says it finished
            self.later((0, REPLY), (0, PRINTING))
        elif FakeUSB.mode == 'mute_at' and here:      # says nothing at all about this label
            pass
        elif FakeUSB.mode == 'cooling_at' and here:   # pauses to cool its head: "cooling started", then nothing for longer than the silence limit
            self.later((0, REPLY), (0, PRINTING), (0.1, NOTE), (1.5, NOTE), (1.6, DONE), (1.6, WAITING))
        elif FakeUSB.mode != 'silent':
            self.later((0, REPLY), (0, PRINTING), (0.02, DONE), (0.02, WAITING))
    def dispose(self):
        FakeUSB.disposed += 1


def reset(mode='ok', at=0):
    FakeUSB.mode, FakeUSB.at, FakeUSB.log = mode, at, []
    FakeUSB.opened = FakeUSB.disposed = 0
    net.clear()


net = []
v2.usb_backend = FakeUSB
v2.send_network = lambda ip, data, labels: (net.append(labels), True)[1]
v2.port_open = lambda ip, port=9100, timeout=0.6: ip == '127.0.0.13'
v2.usb_printer = lambda fresh=False: 'usb://0x04f9:0x209d'
c = v2.app.test_client()
d = dict(storage=True, product_name='Agar Agar', date_prepped='2026-10-12', printed_at='12:00', quantity=1)
labels = lambda: FakeUSB.log.count('label')

reset()
st = c.get('/status').get_json()
r = c.post('/print', json=d).get_json()
check('plugged in: printed over USB, confirmed, nothing over Wi-Fi', r['success'] and r['route'] == 'usb' and labels() == 1 and not net and st['usb'] and st['printer'], (r, FakeUSB.log, net))
check('old messages cleared, then the printer asked how it is, before the label', FakeUSB.log[:1] == ['status'], FakeUSB.log)
check('USB let go after the run', FakeUSB.opened == 1 and FakeUSB.disposed == 1)

reset()
t = time.time(); r = c.post('/print', json=dict(d, quantity=5)).get_json(); dt = time.time() - t
check('5 labels: each confirmed in turn, quickly (%.2fs)' % dt, r['success'] and labels() == 5 and dt < 3, (r, FakeUSB.log))

reset('refuse_open')
r = c.post('/print', json=d).get_json()
check('USB can’t be opened (no permission): the label goes over Wi-Fi', r['success'] and r['route'] == 'wifi' and net == [1], (r, net))

reset(); v2.usb_printer = lambda fresh=False: None
r = c.post('/print', json=d).get_json()
check('no USB: Wi-Fi as before', r['success'] and net == [1] and FakeUSB.opened == 0)
v2.usb_printer = lambda fresh=False: 'usb://0x04f9:0x209d'

reset('no_media')
r = c.post('/print', json=dict(d, quantity=3)).get_json()
check('out of labels: said before anything is sent, not tried over Wi-Fi', not r['success'] and 'No media' in r['error'] and labels() == 0 and not net and not r.get('uncertain'), (r, FakeUSB.log, net))
check('the printer’s words without brother_ql’s model notes', '(' not in r['error'].split('—')[0], r['error'])

reset('runs_out_at', 3)
r = c.post('/print', json=dict(d, quantity=5)).get_json()
check('runs out before label 3 (said in its reply): exactly 2 printed', not r['success'] and r.get('printed') == 2 and 'No media' in r['error'] and not net, (r, net))

reset('lid_at', 3)
r = c.post('/print', json=dict(d, quantity=5)).get_json()
check('lid opened while label 3 printed: 2 printed, the third may have — said so, nothing over Wi-Fi',
      not r['success'] and r.get('printed') == 2 and r.get('uncertain') and 'Cover opened' in r['error'] and 'may have printed' in r['error'] and not net, (r, net))

reset('write_fails_at', 1)
r = c.post('/print', json=dict(d, quantity=3)).get_json()
check('cable pulled while the first label was going: may have printed — not resent over Wi-Fi', not r['success'] and r.get('uncertain') and not net, (r, net))

reset('write_fails_at', 3)
r = c.post('/print', json=dict(d, quantity=5)).get_json()
check('cable pulled at label 3 of 5: 2 printed, the third may have', not r['success'] and r.get('printed') == 2 and r.get('uncertain') and not net, (r, net))

reset('short_write')
r = c.post('/print', json=d).get_json()
check('a write that only partly went (no error from pyusb): may have printed, not resent', not r['success'] and r.get('uncertain') and not net, (r, net))

v2.usb_wait.__defaults__ = (0.6, 10.0)       # 0.6 s of silence for the test, instead of 12
reset('stalls_at', 2)
r = c.post('/print', json=dict(d, quantity=4)).get_json()
check('starts label 2 and never says it finished: 1 printed, 2 may have', not r['success'] and r.get('printed') == 1 and r.get('uncertain') and not net, (r, net))

reset('mute_at', 2)
r = c.post('/print', json=dict(d, quantity=3)).get_json()
check('a printer that reports goes silent on label 2: not taken as printed', not r['success'] and r.get('printed') == 1 and r.get('uncertain'), r)

reset('cooling_at', 2)
r = c.post('/print', json=dict(d, quantity=3)).get_json()
check('pauses to cool mid-run, saying so: waited for, all printed', r['success'] and labels() == 3, r)

reset('silent')
t = time.time(); r = c.post('/print', json=dict(d, quantity=3)).get_json(); dt = time.time() - t
check('a printer that never reports: counted as printed, as over Wi-Fi, without waiting on each label (%.1fs)' % dt,
      r['success'] and r['route'] == 'usb' and labels() == 3 and not net and dt < 8, (r, net))
v2.usb_wait.__defaults__ = (12.0, 120.0)

# a queue over USB fails part-way: each job told exactly where it stands
lab = lambda i, q: dict(plate=True, guest_name='Guest %d' % i, table='1', position=str(i), dietary='Nuts', urgency='allergy', printed_at='12:00', job_id='u%d' % i, quantity=q)
reset('write_fails_at', 5)
r = c.post('/print', json={'jobs': [lab(1, 3), lab(2, 2), lab(3, 4)]}).get_json()
res = {x['job_id']: x for x in r['results']}
check('cable pulled at label 5 of 9: job 1 done, job 2 may have printed (its 2nd label), job 3 didn’t print',
      res['u1']['success'] and not res['u2']['success'] and res['u2'].get('uncertain') and res['u2'].get('printed') == 1
      and '1 of 2 printed' in res['u2']['error'] and not res['u3']['success'] and not res['u3'].get('uncertain') and not net, r)
reset()
r = c.post('/print', json={'jobs': [lab(1, 3), lab(2, 2), lab(3, 4)]}).get_json()
check('retry: job 1 isn’t printed again', r['success'] and labels() == 6 and [x.get('duplicate', False) for x in r['results']] == [True, False, False], (r, FakeUSB.log))

reset('runs_out_at', 4)
r = c.post('/print', json={'jobs': [lab(11, 3), lab(12, 2)]}).get_json()
res = {x['job_id']: x for x in r['results']}
check('runs out before label 4 of 5: job 1 done, job 2 not printed (nothing of it went)', res['u11']['success'] and not res['u12']['success']
      and not res['u12'].get('uncertain') and 'No media' in res['u12']['error'], r)

reset('lid_at', 4)
r = c.post('/print', json={'jobs': [lab(21, 3), lab(22, 2)]}).get_json()
res = {x['job_id']: x for x in r['results']}
check('lid opened while label 4 of 5 printed: job 1 done, job 2 flagged may have printed', res['u21']['success'] and not res['u22']['success']
      and res['u22'].get('uncertain') and 'May have printed' in res['u22']['error'], r)
print('ALL PASS' if ok else 'SOME FAILED')
