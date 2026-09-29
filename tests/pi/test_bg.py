import importlib.util, os, time, threading
os.environ['HOME'] = '/tmp/pitest-bg'; os.makedirs('/tmp/pitest-bg/.digbys', exist_ok=True)
os.environ.pop('PRINTER_IP', None)
spec = importlib.util.spec_from_file_location('v2', os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'pi', 'printserver.py'))
v2 = importlib.util.module_from_spec(spec); spec.loader.exec_module(v2)
v2.KNOWN_PRINTER_IPS[:] = []
scans = []
def fake_scan():
    scans.append(time.time()); time.sleep(0.5); return None
v2.scan_network = fake_scan
v2._printer['ip'] = None
c = v2.app.test_client()
before = threading.active_count()
for _ in range(25):
    c.get('/status')
time.sleep(0.2)
peak = threading.active_count() - before
time.sleep(0.8)
for _ in range(10):
    c.get('/status')
time.sleep(0.8)
print('PASS one background search at a time' if peak <= 1 else f'FAIL {peak} extra threads')
print('PASS one scan inside the cooldown' if len(scans) == 1 else f'FAIL {len(scans)} scans')
v2._printer['scanned_at'] = time.time() - 21
c.get('/status'); time.sleep(0.8)
print('PASS scans again after the cooldown' if len(scans) == 2 else f'FAIL {len(scans)} scans')
