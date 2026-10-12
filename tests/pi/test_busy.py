"""A queue of labels sent back to back: the printer stops answering for a few
seconds after each job, and every label must still print."""
import importlib.util, os, socket, threading, time
os.environ['HOME'] = '/tmp/pitest-busy'; os.makedirs('/tmp/pitest-busy/.digbys', exist_ok=True)
os.environ['PRINTER_IP'] = '127.0.0.12'
jobs = []
busy_until = [0.0]
def serve():
    def listen():
        s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(('127.0.0.12', 9100)); s.listen(4); return s
    s = listen()
    while True:
        c, _ = s.accept()
        if c.recv(1, socket.MSG_PEEK) == b'':   # a ready check: still idle
            c.close(); continue
        s.close()                               # printing: refuses everything
        n = 0
        while True:
            b = c.recv(65536)
            if not b: break
            n += len(b)
        c.close()
        jobs.append(n)
        time.sleep(2.5)
        s = listen()
threading.Thread(target=serve, daemon=True).start()
time.sleep(0.2)
spec = importlib.util.spec_from_file_location('v2', os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'pi', 'printserver.py'))
v2 = importlib.util.module_from_spec(spec); spec.loader.exec_module(v2)
v2.KNOWN_PRINTER_IPS[:] = []
c = v2.app.test_client()
d = dict(storage=True, product_name='Agar Agar', date_prepped='2026-10-12', printed_at='12:00', quantity=1)
ok = 0
t = time.time()
for i in range(5):
    r = c.post('/print', json={**d, 'job_id': 'q%d' % i}).get_json()
    ok += bool(r.get("success"))
time.sleep(0.5)
print(('PASS' if ok == 5 and len(jobs) == 5 else 'FAIL') + ' 5 labels back to back, printer busy 2.5 s after each: %d sent, %d printed (%.0fs)' % (ok, len(jobs), time.time() - t))
