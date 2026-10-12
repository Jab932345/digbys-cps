import importlib.util, os, socket, threading
os.environ['HOME'] = '/tmp/pitest-idem'; os.makedirs('/tmp/pitest-idem/.digbys', exist_ok=True)
os.environ['PRINTER_IP'] = '127.0.0.9'
jobs = []
srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); srv.bind(('127.0.0.9', 9100)); srv.listen(8)
def loop():
    while True:
        c, _ = srv.accept(); n = 0
        while True:
            b = c.recv(65536)
            if not b: break
            n += len(b)
        if n: jobs.append(n)
        c.close()
threading.Thread(target=loop, daemon=True).start()
spec = importlib.util.spec_from_file_location('v2', os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'pi', 'printserver.py'))
v2 = importlib.util.module_from_spec(spec); spec.loader.exec_module(v2)
v2.KNOWN_PRINTER_IPS[:] = []
c = v2.app.test_client()
d = dict(product_name='Test', date_prepped='2026-09-29', date_useby='2026-10-02', staff_name='J', printed_at='10:00', quantity=1)
r1 = c.post('/print', json={**d, 'job_id': 'abc'}).get_json()
r2 = c.post('/print', json={**d, 'job_id': 'abc'}).get_json()
r3 = c.post('/print', json={**d, 'job_id': 'xyz'}).get_json()
r4 = c.post('/print', json=d).get_json(); r5 = c.post('/print', json=d).get_json()
import time; time.sleep(0.5)
print('PASS retry of a printed job not printed twice' if r1['success'] and r2.get('duplicate') and len(jobs) == 4 else f'FAIL {r1} {r2} jobs={len(jobs)}')
print('PASS version 2.0.2' if v2.VERSION == '2.0.2' else 'FAIL version')
# a non-Brother among several 9100 listeners is never chosen
v2.pi_ip = lambda: '127.0.0.20'
import ipaddress
v2.port_open = lambda ip, port=9100, timeout=0.5: ip in ('127.0.0.30', '127.0.0.31')
v2.looks_like_brother = lambda ip: False
print('PASS two unknown 9100 devices → none chosen' if v2.scan_network() is None else 'FAIL picked one')
v2.looks_like_brother = lambda ip: ip == '127.0.0.31'
print('PASS the Brother is chosen' if v2.scan_network() == '127.0.0.31' else 'FAIL')
v2.looks_like_brother = lambda ip: False
v2.port_open = lambda ip, port=9100, timeout=0.5: ip == '127.0.0.30'
v2.looks_like_brother = lambda ip: False
v2._brothers.clear()
print('PASS a lone device that isn’t a Brother is never used' if v2.scan_network() is None else 'FAIL')
v2._printer['ip'] = None; os.environ.pop('PRINTER_IP', None)
v2.KNOWN_PRINTER_IPS[:] = ['127.0.0.30']
try: os.remove('/tmp/pitest-idem/.digbys/printer_ip')
except OSError: pass
got = v2.find_printer(scan=False)
print('PASS an old address that isn’t a Brother isn’t trusted' if got is None else f'FAIL {got}')

# the remembered address is re-checked: after a router change it can be another device
os.environ.pop('PRINTER_IP', None)
v2._brothers.clear(); v2._printer['ip'] = '127.0.0.30'
open('/tmp/pitest-idem/.digbys/printer_ip', 'w').write('127.0.0.30')
v2.port_open = lambda ip, port=9100, timeout=0.5: ip == '127.0.0.30'
v2.looks_like_brother = lambda ip: False
print('PASS a remembered address that is now another device isn’t used' if v2.find_printer(scan=False) is None else 'FAIL')
os.environ['PRINTER_IP'] = '127.0.0.30'
print('PASS an address set by hand is trusted' if v2.find_printer(scan=False) == '127.0.0.30' else 'FAIL')
