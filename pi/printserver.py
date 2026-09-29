#!/usr/bin/env python3
# DIGBYS_PRINTSERVER_V2 — keep this line: the updater looks for it.
"""
Digby's print server. Runs on the Pi as the `digbys-cps` service (port 3000,
reached through ngrok) and prints on the Brother QL-820NWBc for Digby's CPS
and Kitchen Prep.

  POST /print     standard prep labels, plate labels ("plate": true),
                  container labels ("storage": true) and the older free-text
                  labels ("custom": true, "lines": [...]). With a "job_id",
                  a retry of a job that already printed isn't printed again.
  GET  /status    printer, network and version, for the apps
  POST /shutdown  shuts the Pi down safely
  POST /update    installs the latest server from digbys-cps.vercel.app/pi

The printer is found by itself on whatever network the Mango is on: the last
address that worked is tried first, then the local network is scanned for the
printer's port (9100). Only a device that is recognisably the Brother is used
(set PRINTER_IP in the service to name it by hand).

Routes from the Pi's previous server that this file doesn't define — the Star
receipt printer and Kitchen Prep's butchery labels — keep working: the
previous server is kept at ~/.digbys/legacy_printserver.py and its routes are
served from here, pointed at the printer this server found.

Install or update (over SSH, once):
    curl -fsSL https://digbys-cps.vercel.app/pi/update.sh | bash
"""
import functools
import importlib.util
import ipaddress
import os
import socket
import subprocess
import sys
import textwrap
import threading
import time
import urllib.error
import urllib.request
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from flask import Flask, jsonify, request
from flask_cors import CORS
from PIL import Image, ImageDraw, ImageFont
from brother_ql.backends.helpers import send
from brother_ql.conversion import convert
from brother_ql.raster import BrotherQLRaster

VERSION = '2.0.1'

HOME = os.path.expanduser('~')
STATE_DIR = os.path.join(HOME, '.digbys')
PRINTER_FILE = os.path.join(STATE_DIR, 'printer_ip')
LEGACY_FILE = os.path.join(STATE_DIR, 'legacy_printserver.py')
UPDATE_UNIT = '/etc/systemd/system/digbys-cps-update.service'

PRINTER_MODEL = 'QL-820NWB'
LABEL_SIZE = '62'
PRINTER_PORT = 9100
KNOWN_PRINTER_IPS = ['192.168.7.231', '192.168.8.231', '192.168.1.127']

BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
REGULAR = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'

app = Flask(__name__)
CORS(app)


# ═══════════════════════════════════════════════════════════════════════
# Label drawing. Every size, position and colour below is the one the Pi
# has been printing with — the labels come out exactly as before. Thermal
# red/black: anything paler than about (80,80,80) doesn't print.
# ═══════════════════════════════════════════════════════════════════════
def load_fonts():
    try:
        return {
            'large':  ImageFont.truetype(BOLD, 36),
            'medium': ImageFont.truetype(BOLD, 28),
            'small':  ImageFont.truetype(REGULAR, 22),
            'label':  ImageFont.truetype(BOLD, 20),
            'notes':  ImageFont.truetype(REGULAR, 24),
            'tiny':   ImageFont.truetype(REGULAR, 18),
        }
    except OSError:
        f = ImageFont.load_default()
        return {'large': f, 'medium': f, 'small': f, 'label': f, 'notes': f, 'tiny': f}


def text_width(draw, text, font):
    try:
        bb = draw.textbbox((0, 0), text, font=font)
        return bb[2] - bb[0]
    except Exception:
        return draw.textlength(text, font=font)


def wrap_to_width(draw, text, font, max_w):
    """Wrap at spaces so no word is ever cut in half."""
    words = text.split()
    lines = []
    cur = ''
    for word in words:
        test = (cur + ' ' + word).strip()
        if text_width(draw, test, font) <= max_w:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines or [text]


def fmt_short_date(s):
    try:
        return datetime.strptime(s, '%Y-%m-%d').strftime('%d/%m/%y')
    except (TypeError, ValueError):
        return s or ''


def s(data, key):
    v = data.get(key)
    return '' if v is None else str(v).strip()


def create_label_image(data):
    """Standard prep label: product + job code on black, frozen/thawed line,
    dates, who, weight, section, allergens, notes."""
    f = load_fonts()
    W = 696
    product = s(data, 'product_name')
    job_code = s(data, 'job_code')
    prepped = s(data, 'date_prepped')
    useby = s(data, 'date_useby')
    staff = s(data, 'staff_name')
    section = s(data, 'section')
    contains = s(data, 'contains')
    may = s(data, 'may_contain')
    notes = s(data, 'notes')
    printed_at = s(data, 'printed_at')
    note = s(data, 'source_note')
    status = (s(data, 'status') or s(data, 'label_status')).upper()
    status_date = s(data, 'status_date') or prepped
    weight = s(data, 'weight_display')
    tmp = Image.new('RGB', (10, 10), 'white')
    td = ImageDraw.Draw(tmp)
    jc_w = (text_width(td, job_code, f['small']) + 20) if job_code else 0
    name_lines = wrap_to_width(td, product, f['large'], W - 20 - jc_w)
    al_lines = textwrap.wrap(contains, width=40) if contains else []
    may_lines = textwrap.wrap('May contain: ' + may, width=46) if may else []
    note_lines = textwrap.wrap(notes, width=46)[:3] if notes else []
    sd_fmt = fmt_short_date(status_date)
    if status == 'FROZEN':
        status_text = 'FROZEN - Do not refreeze - ' + sd_fmt if sd_fmt else 'FROZEN - Do not refreeze'
    elif status == 'THAWED':
        status_text = 'THAWED - ' + sd_fmt if sd_fmt else 'THAWED'
    else:
        status_text = ''
    status_lines = wrap_to_width(td, status_text, f['medium'], W - 20) if status_text else []
    rows = []
    if not status:
        rows.append(('PREP DATE', prepped, f['small'], (20, 20, 20)))
    rows.append(('USE BY', useby, f['medium'], (185, 0, 0)))
    rows.append(('PREP BY', staff, f['small'], (20, 20, 20)))
    if weight:
        rows.append(('WEIGHT', weight, f['small'], (20, 20, 20)))
    if section:
        rows.append(('SECTION', section, f['small'], (20, 20, 20)))
    row_h = 44
    header_h = 14 + len(name_lines) * 44 + 14
    status_h = (len(status_lines) * 36 + 16) if status_lines else 0
    rows_h = len(rows) * row_h + len(rows)
    al_h = (12 + len(al_lines) * 28 + len(may_lines) * 24 + 12) if (contains or may) else 36
    notes_h = (12 + len(note_lines) * 28 + 12) if note_lines else 0
    footer_h = 30
    total_h = header_h + status_h + rows_h + 6 + al_h + notes_h + 2 + footer_h
    img = Image.new('RGB', (W, total_h), 'white')
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, W, header_h], fill=(20, 20, 20))
    ty = 14
    for line in name_lines:
        draw.text((10, ty), line, font=f['large'], fill='white')
        ty += 44
    if job_code:
        jx = W - text_width(draw, job_code, f['small']) - 10
        draw.text((jx, 16), job_code, font=f['small'], fill=(200, 200, 200))
    y = header_h
    if status_lines:
        draw.rectangle([0, y, W, y + status_h], fill='white')
        sy = y + 8
        for line in status_lines:
            sw = text_width(draw, line, f['medium'])
            draw.text(((W - sw) // 2, sy), line, font=f['medium'], fill=(185, 0, 0))
            sy += 36
        y += status_h
    for lbl, val, vfont, vcol in rows:
        draw.rectangle([0, y, W, y + 1], fill=(60, 60, 60))
        y += 1
        draw.text((10, y + 12), lbl, font=f['label'], fill=(40, 40, 40))
        draw.text((200, y + 8), val, font=vfont, fill=vcol)
        y += row_h
    y = draw_allergens(draw, f, W, y, contains, may, al_lines, may_lines, al_h)
    y = draw_notes(draw, f, W, y, note_lines, notes_h)
    footer = printed_at + '  |  Digbys CPS' + ('  |  ' + note if note else '')
    draw_footer(draw, f, W, y, total_h, footer)
    return img


def draw_allergens(draw, f, W, y, contains, may, al_lines, may_lines, al_h):
    draw.rectangle([0, y, W, y + 6], fill=(185, 0, 0) if (contains or may) else (60, 60, 60))
    y += 6
    if contains or may:
        draw.rectangle([0, y, W, y + al_h], fill=(255, 235, 235))
        draw.rectangle([0, y, 8, y + al_h], fill=(185, 0, 0))
        ay = y + 12
        for line in al_lines:
            draw.text((16, ay), line, font=f['small'], fill=(185, 0, 0))
            ay += 28
        for line in may_lines:
            draw.text((16, ay), line, font=f['tiny'], fill=(100, 20, 20))
            ay += 24
    else:
        draw.rectangle([0, y, W, y + al_h], fill=(240, 240, 240))
        draw.rectangle([0, y, 8, y + al_h], fill=(60, 60, 60))
        draw.text((16, y + 9), 'No allergens declared', font=f['label'], fill=(60, 60, 60))
    return y + al_h


def draw_notes(draw, f, W, y, note_lines, notes_h):
    if not note_lines:
        return y
    draw.rectangle([0, y, W, y + 2], fill=(60, 60, 60))
    y += 2
    draw.rectangle([0, y, W, y + notes_h], fill=(255, 250, 235))
    draw.rectangle([0, y, 8, y + notes_h], fill=(140, 100, 0))
    ny = y + 12
    for line in note_lines:
        draw.text((16, ny), line, font=f['notes'], fill=(60, 40, 0))
        ny += 28
    return y + notes_h


def draw_footer(draw, f, W, y, total_h, text):
    draw.rectangle([0, y, W, y + 2], fill=(60, 60, 60))
    y += 2
    draw.rectangle([0, y, W, total_h], fill=(220, 220, 220))
    draw.text((10, y + 7), text, font=f['tiny'], fill=(60, 60, 60))


def create_plate_label(data):
    """Dietary plate label for the rim: type bar, guest, requirement in red,
    table and position, dish."""
    f = load_fonts()
    W = 696
    name = s(data, 'guest_name')
    table = s(data, 'table')
    pos = s(data, 'position')
    dietary = s(data, 'dietary')
    dish = s(data, 'dish')
    urgency = (s(data, 'urgency') or 'allergy').lower()
    printed_at = s(data, 'printed_at')
    tmp = Image.new('RGB', (10, 10), 'white')
    td = ImageDraw.Draw(tmp)
    dish_lines = textwrap.wrap(dish, width=50) if dish else []
    dietary_lines = wrap_to_width(td, dietary, f['large'], W - 20)
    colours = {'allergy': (185, 0, 0), 'intolerance': (185, 0, 0), 'dislike': (20, 20, 20)}
    titles = {'allergy': 'ALLERGY', 'intolerance': 'INTOLERANCE', 'dislike': 'DISLIKE'}
    ucol = colours.get(urgency, (185, 0, 0))
    ulbl = titles.get(urgency, 'ALLERGY')
    urg_h = 44
    name_h = 54
    diet_h = len(dietary_lines) * 48 + 16
    table_h = 46
    rule_h = 2
    dish_h = (10 + len(dish_lines) * 24 + 10) if dish_lines else 0
    foot_h = 26
    total_h = urg_h + name_h + diet_h + table_h + rule_h + dish_h + foot_h
    img = Image.new('RGB', (W, total_h), 'white')
    draw = ImageDraw.Draw(img)
    y = 0
    draw.rectangle([0, y, W, y + urg_h], fill=ucol)
    uw = text_width(draw, ulbl, f['medium'])
    draw.text(((W - uw) // 2, y + 8), ulbl, font=f['medium'], fill='white')
    y += urg_h
    draw.rectangle([0, y, W, y + name_h], fill='white')
    draw.text((14, y + 10), name, font=f['large'], fill=(20, 20, 20))
    y += name_h
    draw.rectangle([0, y, W, y + diet_h], fill='white')
    dy = y + 8
    for line in dietary_lines:
        draw.text((14, dy), line, font=f['large'], fill=(185, 0, 0))
        dy += 48
    y += diet_h
    draw.rectangle([0, y, W, y + 1], fill=(60, 60, 60))
    y += 1
    draw.rectangle([0, y, W, y + table_h], fill='white')
    draw.text((14, y + 10), 'T' + table + '   P' + pos, font=f['large'], fill=(20, 20, 20))
    y += table_h
    if dish_lines:
        draw.rectangle([0, y, W, y + rule_h], fill=(180, 180, 180))
        y += rule_h
        draw.rectangle([0, y, W, y + dish_h], fill=(235, 235, 235))
        dy2 = y + 10
        for line in dish_lines:
            draw.text((14, dy2), line, font=f['notes'], fill=(20, 20, 20))
            dy2 += 24
        y += dish_h
    draw.rectangle([0, y, W, y + rule_h], fill=(180, 180, 180))
    y += rule_h
    draw.rectangle([0, y, W, total_h], fill=(230, 230, 230))
    draw.text((14, y + 5), printed_at + "  |  Digby's CPS  |  Plate Label", font=f['tiny'], fill=(100, 100, 100))
    return img


def create_storage_label(data):
    """Container label: big centred name on black, date in, allergens."""
    f = load_fonts()
    try:
        f_title = ImageFont.truetype(BOLD, 52)
    except OSError:
        f_title = f['large']
    W = 696
    product = s(data, 'product_name')
    contains = s(data, 'contains')
    may = s(data, 'may_contain')
    date_in = s(data, 'date_prepped')
    notes = s(data, 'notes')
    printed_at = s(data, 'printed_at')
    tmp = Image.new('RGB', (10, 10), 'white')
    td = ImageDraw.Draw(tmp)
    al_lines = textwrap.wrap(contains, width=40) if contains else []
    may_lines = textwrap.wrap('May contain: ' + may, width=46) if may else []
    note_lines = textwrap.wrap(notes, width=46)[:3] if notes else []
    name_lines = wrap_to_width(td, product, f_title, W - 40)
    header_h = 24 + len(name_lines) * 64 + 24
    date_h = 46 if date_in else 0
    al_h = (12 + len(al_lines) * 28 + len(may_lines) * 24 + 12) if (contains or may) else 36
    notes_h = (12 + len(note_lines) * 28 + 12) if note_lines else 0
    footer_h = 30
    total_h = header_h + (1 + date_h if date_in else 0) + 6 + al_h + notes_h + 2 + footer_h
    img = Image.new('RGB', (W, total_h), 'white')
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, W, header_h], fill=(20, 20, 20))
    ty = 20
    for line in name_lines:
        lw = text_width(draw, line, f_title)
        draw.text(((W - lw) // 2, ty), line, font=f_title, fill='white')
        ty += 64
    y = header_h
    if date_in:
        draw.rectangle([0, y, W, y + 1], fill=(60, 60, 60))
        y += 1
        draw.text((10, y + 12), 'DATE IN', font=f['label'], fill=(40, 40, 40))
        draw.text((200, y + 8), date_in, font=f['medium'], fill=(20, 20, 20))
        y += date_h
    y = draw_allergens(draw, f, W, y, contains, may, al_lines, may_lines, al_h)
    y = draw_notes(draw, f, W, y, note_lines, notes_h)
    draw_footer(draw, f, W, y, total_h, printed_at + '  |  Digbys CPS  |  Storage')
    return img


def create_custom_label(data):
    """The older free-text label (lines with a size each)."""
    lines = data.get('lines') or []
    W = 696
    fonts = {}
    total_h = 20
    for line in lines:
        size = max(12, min(72, int(line.get('size', 28))))
        total_h += size + 10
    height = max(200, total_h + 30)
    img = Image.new('RGB', (W, height), 'white')
    draw = ImageDraw.Draw(img)
    y = 15
    for line in lines:
        text = str(line.get('text', ''))
        size = max(12, min(72, int(line.get('size', 28))))
        if size not in fonts:
            try:
                fonts[size] = ImageFont.truetype(BOLD, size)
            except OSError:
                fonts[size] = ImageFont.load_default()
        draw.text((15, y), text, font=fonts[size], fill='black')
        y += size + 10
    return img


def render(data):
    if data.get('storage'):
        return create_storage_label(data)
    if data.get('plate'):
        return create_plate_label(data)
    if data.get('custom'):
        return create_custom_label(data)
    return create_label_image(data)


# ═══════════════════════════════════════════════════════════════════════
# Finding the printer
# ═══════════════════════════════════════════════════════════════════════
_printer = {'ip': None, 'at': 0.0, 'searching': False, 'scanned_at': 0.0}
_find_lock = threading.Lock()
_bg_lock = threading.Lock()
_bg = {'running': False}
SCAN_COOLDOWN = 20   # seconds between background scans of the network
_send_lock = threading.Lock()   # one job at a time on the printer


def port_open(ip, port=PRINTER_PORT, timeout=0.6):
    try:
        with socket.create_connection((ip, port), timeout=timeout):
            return True
    except OSError:
        return False


def pi_ip():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(('10.255.255.255', 1))
        return sock.getsockname()[0]
    except OSError:
        pass
    finally:
        sock.close()
    try:
        out = subprocess.run(['hostname', '-I'], capture_output=True, text=True, timeout=3).stdout.split()
        return next((a for a in out if a.count('.') == 3 and not a.startswith('127.')), None)
    except Exception:
        return None


def looks_like_brother(ip):
    """The printer's own web page: Brother's built-in server calls itself
    "debut", and its pages name the printer."""
    try:
        req = urllib.request.Request('http://%s/' % ip, headers={'User-Agent': 'digbys-print'})
        with urllib.request.urlopen(req, timeout=3) as r:
            server = (r.headers.get('Server') or '').lower()
            body = r.read(40000).decode('latin-1', 'ignore').lower()
        return 'debut' in server or 'brother' in body or 'ql-8' in body
    except urllib.error.HTTPError as e:
        return 'debut' in ((e.headers.get('Server') if e.headers else '') or '').lower()
    except Exception:
        return False


_brothers = set()   # addresses already seen to be the Brother


def is_brother(ip):
    if ip in _brothers:
        return True
    if looks_like_brother(ip):
        _brothers.add(ip)
        return True
    return False


def scan_network():
    """The Brother on the local network. Other devices can listen on 9100 too,
    so only a device that is recognisably the Brother is used — never just
    whatever answers."""
    me = pi_ip()
    if not me:
        return None
    hosts = [str(h) for h in ipaddress.ip_network(me + '/24', strict=False).hosts() if str(h) != me]
    with ThreadPoolExecutor(max_workers=64) as pool:
        found = [ip for ip, ok in zip(hosts, pool.map(lambda a: port_open(a, timeout=0.5), hosts)) if ok]
    if not found:
        return None
    return next((ip for ip in found if is_brother(ip)), None)


def bare(ip):
    return (ip or '').replace('tcp://', '').split(':')[0].strip() or None


def remember(ip):
    _printer['ip'] = ip
    _printer['at'] = time.time()
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        with open(PRINTER_FILE, 'w') as fh:
            fh.write(ip)
    except OSError:
        pass


def known_addresses():
    """(address, trusted). Only an address set by hand (PRINTER_IP in the
    service) is trusted as it is — any other has to be recognisably the Brother,
    since after a router change the same address can be a different device."""
    saved = None
    try:
        with open(PRINTER_FILE) as fh:
            saved = fh.read().strip()
    except OSError:
        pass
    legacy = getattr(sys.modules.get('digbys_legacy'), 'PRINTER_IP', None)
    out, seen = [], set()
    for ip, trusted in [(os.environ.get('PRINTER_IP'), True), (_printer['ip'], False), (saved, False), (legacy, False)] + [(k, False) for k in KNOWN_PRINTER_IPS]:
        ip = bare(ip)
        if ip and ip not in seen:
            seen.add(ip)
            out.append((ip, trusted))
    return out


def find_printer(scan=True):
    """Last good address first, then a scan of the local network."""
    with _find_lock:
        for ip, trusted in known_addresses():
            if port_open(ip) and (trusted or is_brother(ip)):
                remember(ip)
                return ip
        if not scan:
            return None
        _printer['searching'] = True
        try:
            ip = scan_network()
        finally:
            _printer['searching'] = False
            _printer['scanned_at'] = time.time()
        if ip:
            remember(ip)
        return ip


def find_in_background():
    """One background search at a time, however many devices ask for /status,
    and a full network scan at most every SCAN_COOLDOWN seconds."""
    with _bg_lock:
        if _bg['running']:
            return
        _bg['running'] = True

    def run():
        try:
            find_printer(scan=time.time() - _printer['scanned_at'] >= SCAN_COOLDOWN)
        except Exception:
            pass
        finally:
            _bg['running'] = False
    threading.Thread(target=run, daemon=True).start()


def print_images(img, qty):
    qlr = BrotherQLRaster(PRINTER_MODEL)
    qlr.exception_on_warning = True
    instructions = convert(qlr=qlr, images=[img] * qty, label=LABEL_SIZE, rotate='0',
                           threshold=70.0, dither=False, compress=False, red=True,
                           dpi_600=False, hq=True, cut=True)
    with _send_lock:
        ip = _printer['ip'] if _printer['ip'] and port_open(_printer['ip']) else find_printer()
        if not ip:
            raise RuntimeError("Printer not found on the network — is it on and joined to Digbys-BOH?")
        try:
            send(instructions=instructions, printer_identifier='tcp://' + ip,
                 backend_identifier='network', blocking=True)
        except Exception:
            _printer['ip'] = None
            again = find_printer()
            if not again:
                raise
            send(instructions=instructions, printer_identifier='tcp://' + again,
                 backend_identifier='network', blocking=True)


# ═══════════════════════════════════════════════════════════════════════
# Routes
# ═══════════════════════════════════════════════════════════════════════
LEGACY = {'loaded': False, 'routes': [], 'error': None}


@app.route('/status', methods=['GET'])
def status():
    ip = _printer['ip']
    online = bool(ip and port_open(ip))
    if not online:
        find_in_background()
    return jsonify({
        'status': 'ok',
        'server': 'digbys-print',
        'version': VERSION,
        'printer': online,
        'printer_ip': ip if online else None,
        'searching': _printer['searching'],
        'pi_ip': pi_ip(),
        'receipt': '/receipt' in LEGACY['routes'],
        'legacy_routes': LEGACY['routes'],
        'legacy_error': LEGACY['error'],
        'updatable': os.path.exists(UPDATE_UNIT),
        'time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
    })


_done_jobs = OrderedDict()      # job_id → when it printed: a retry of a printed job isn't printed twice
_jobs_lock = threading.Lock()


@app.route('/print', methods=['POST'])
def print_label():
    try:
        data = request.get_json(force=True, silent=True) or {}
        try:
            qty = max(1, min(50, int(data.get('quantity', 1))))
        except (TypeError, ValueError):
            qty = 1
        job_id = str(data.get('job_id') or '').strip()[:100]
        with _jobs_lock:
            if job_id and job_id in _done_jobs:
                return jsonify({'success': True, 'duplicate': True, 'printer_ip': _printer['ip']})
            print_images(render(data), qty)
            if job_id:
                _done_jobs[job_id] = time.time()
                while len(_done_jobs) > 1000:
                    _done_jobs.popitem(last=False)
        return jsonify({'success': True, 'printer_ip': _printer['ip']})
    except Exception as e:
        print('Print error:', e, flush=True)
        return jsonify({'success': False, 'error': str(e)}), 500


def run_later(cmds, delay):
    def go():
        time.sleep(delay)
        for cmd in cmds:
            if subprocess.run(cmd).returncode == 0:
                return
    threading.Thread(target=go, daemon=True).start()


@app.route('/shutdown', methods=['POST'])
def shutdown():
    run_later([['sudo', '-n', '/usr/sbin/shutdown', '-h', 'now'],
               ['sudo', '-n', '/sbin/shutdown', '-h', 'now']], 2)
    return jsonify({'success': True, 'message': 'Shutting down'})


@app.route('/update', methods=['POST'])
def update():
    if not os.path.exists(UPDATE_UNIT):
        return jsonify({'started': False, 'error': 'Run the updater once over SSH first'}), 409
    r = subprocess.run(['sudo', '-n', '/usr/bin/systemctl', 'start', '--no-block', 'digbys-cps-update'],
                       capture_output=True, text=True, timeout=15)
    if r.returncode != 0:
        return jsonify({'started': False, 'error': (r.stderr or r.stdout or 'could not start').strip()}), 500
    return jsonify({'started': True, 'from': VERSION})


# ── Routes kept from the previous server ─────────────────────────────────
def load_legacy_routes():
    if not os.path.exists(LEGACY_FILE):
        return
    try:
        spec = importlib.util.spec_from_file_location('digbys_legacy', LEGACY_FILE)
        mod = importlib.util.module_from_spec(spec)
        sys.modules['digbys_legacy'] = mod
        spec.loader.exec_module(mod)
    except Exception as e:
        sys.modules.pop('digbys_legacy', None)
        LEGACY['error'] = '%s: %s' % (type(e).__name__, e)
        return
    old_app = getattr(mod, 'app', None)
    if old_app is None:
        return
    real_send = getattr(mod, 'send', None)
    if callable(real_send):
        def send_to_found_printer(*args, **kw):
            ip = _printer['ip'] or find_printer()
            if ip:
                if len(args) >= 2:
                    args = (args[0], 'tcp://' + ip) + tuple(args[2:])
                else:
                    kw['printer_identifier'] = 'tcp://' + ip
            with _send_lock:
                return real_send(*args, **kw)
        mod.send = send_to_found_printer
    ours = {r.rule for r in app.url_map.iter_rules()}
    for rule in old_app.url_map.iter_rules():
        if rule.endpoint == 'static' or rule.rule in ours:
            continue
        view = old_app.view_functions[rule.endpoint]

        def wrapped(*a, _view=view, **kw):
            if _printer['ip'] and hasattr(mod, 'PRINTER_IP'):
                mod.PRINTER_IP = 'tcp://' + _printer['ip']
            return _view(*a, **kw)
        functools.update_wrapper(wrapped, view)
        methods = sorted(m for m in (rule.methods or ['GET']) if m not in ('HEAD', 'OPTIONS'))
        app.add_url_rule(rule.rule, endpoint='legacy_' + rule.endpoint, view_func=wrapped, methods=methods)
        LEGACY['routes'].append(rule.rule)
    LEGACY['loaded'] = True


load_legacy_routes()

if __name__ == '__main__':
    find_in_background()
    app.run(host='0.0.0.0', port=3000, debug=False, threaded=True)
