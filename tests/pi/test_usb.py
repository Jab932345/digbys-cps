"""USB first, Wi-Fi second: a printer plugged into the Pi is used without the
network; if USB fails the label still goes over Wi-Fi."""
import importlib.util, os
os.environ['HOME'] = '/tmp/pitest-usb'; os.makedirs('/tmp/pitest-usb/.digbys', exist_ok=True)
os.environ['PRINTER_IP'] = '127.0.0.13'
spec = importlib.util.spec_from_file_location('v2', os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'pi', 'printserver.py'))
v2 = importlib.util.module_from_spec(spec); spec.loader.exec_module(v2)
v2.KNOWN_PRINTER_IPS[:] = []
calls = []
fail_usb = [False]
def fake_send(instructions, printer_identifier, backend_identifier, blocking=True):
    calls.append(backend_identifier)
    if backend_identifier == 'pyusb' and fail_usb[0]: raise IOError('usb gone')
v2.send = fake_send
v2.port_open = lambda ip, port=9100, timeout=0.6: ip == '127.0.0.13'
c = v2.app.test_client()
d = dict(storage=True, product_name='Agar Agar', date_prepped='2026-10-12', printed_at='12:00', quantity=1)
v2.usb_printer = lambda: 'usb://0x04f9:0x209d'
st = c.get('/status').get_json()
r = c.post('/print', json=d).get_json()
print('PASS plugged in: printed over USB' if r['success'] and calls == ['pyusb'] and st['usb'] and st['printer'] else f'FAIL {calls} {st}')
calls.clear(); fail_usb[0] = True
r = c.post('/print', json=d).get_json()
print('PASS USB fails: same label goes over Wi-Fi' if r['success'] and calls == ['pyusb', 'network'] else f'FAIL {calls} {r}')
calls.clear(); v2.usb_printer = lambda: None
r = c.post('/print', json=d).get_json()
print('PASS no USB: Wi-Fi as before' if r['success'] and calls == ['network'] else f'FAIL {calls}')
