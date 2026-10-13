#!/usr/bin/env python3
# DIGBYS_PRINTSERVER_V2 — keep this line: the updater looks for it.
"""
Digby's print server. Runs on the Pi as the `digbys-cps` service (port 3000,
reached through ngrok) and prints on the Brother QL-820NWBc for Digby's CPS
and Kitchen Prep.

  POST /print     standard prep labels, plate labels ("plate": true),
                  container labels ("storage": true) and the older free-text
                  labels ("custom": true, "lines": [...]), or {"jobs": [...]}
                  for a whole queue. With a "job_id", a retry of a job that
                  already printed isn't printed again. 503 "busy" when another
                  run had the printer all the while it waited — nothing printed.
  GET  /status    printer, network and version, for the apps
  POST /shutdown  shuts the Pi down safely
  POST /update    installs the latest server from digbys-cps.vercel.app/pi

Plugged into the Pi by USB, the printer is used that way first — no Wi-Fi
needed, and each label is confirmed by the printer before the next — with
Wi-Fi as the second route, tried only when nothing went over USB. Over Wi-Fi
the printer is found by itself on whatever network the Mango is on: the last
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
import hashlib
import importlib.util
import ipaddress
import json
import os
import re
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

from flask import Flask, Response, jsonify, request, send_from_directory
from flask_cors import CORS
from PIL import Image, ImageDraw, ImageFont
from brother_ql.conversion import convert
from brother_ql.raster import BrotherQLRaster

VERSION = '2.2.0'

HOME = os.path.expanduser('~')
STATE_DIR = os.path.join(HOME, '.digbys')
PRINTER_FILE = os.path.join(STATE_DIR, 'printer_ip')
LEGACY_FILE = os.path.join(STATE_DIR, 'legacy_printserver.py')
UPDATE_UNIT = '/etc/systemd/system/digbys-cps-update.service'
APP_URL = os.environ.get('DIGBYS_APP_URL', 'https://digbys-cps.vercel.app').rstrip('/')
APP_DIR = os.path.join(STATE_DIR, 'app')
MAX_BATCH_LABELS = 60

# How long a print waits for the printer while another run has it, before
# answering "busy" (nothing printed, so asking again is safe). Kept inside each
# app's own wait: Kitchen Prep gives up on /print after 15 s and on butchery
# labels after 8 s; CPS waits 45 s or more and asks again when told "busy".
JOB_WAIT = 25          # CPS: every request carries a job_id
NO_ID_WAIT = 10        # Kitchen Prep's labels: no job_id; counted from when the request came in
LEGACY_WAIT = 5        # the previous server's routes (butchery labels)
KP_GIVES_UP = 15       # Kitchen Prep had stopped waiting for a run that took this long here

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


class PrinterError(RuntimeError):
    """The printer itself refused the job (no labels, lid open…) — another route won't help.
    `started`: it said so once a label was under way, so that label may have printed."""
    def __init__(self, msg, started=False):
        super().__init__(msg)
        self.started = started


class PartPrinted(RuntimeError):
    """Some of the labels went out before it failed. `printed` is how many are
    known to have printed; `doubt` how many after those may have (the label
    that was going over USB, or the whole run over Wi-Fi, which can't tell)."""
    def __init__(self, msg, printed=0, uncertain=False, doubt=None):
        super().__init__(msg)
        self.printed = printed
        self.uncertain = uncertain
        self.doubt = doubt


class UsbUnavailable(RuntimeError):
    """USB couldn't be used and nothing went over it — Wi-Fi is safe to try."""


class Busy(RuntimeError):
    """Another run had the printer the whole time this one waited. Nothing was
    printed, so asking again is safe."""


BUSY = 'The printer is busy with another run — try again in a moment'


def take(lock, secs, msg=BUSY):
    if not lock.acquire(timeout=max(0.0, secs)):
        raise Busy(msg)


_usb = {'at': 0.0, 'id': None}


def usb_printer(fresh=False):
    """A Brother plugged into the Pi by USB — the route that doesn't need Wi-Fi.
    Looked up at most every 5 s for status checks; always fresh for a print."""
    if not fresh and time.time() - _usb['at'] < 5:
        return _usb['id']
    try:
        from brother_ql.backends.pyusb import list_available_devices
        devs = list_available_devices()
        found = devs[0]['identifier'].split('_')[0] if devs else None
    except Exception:
        found = None
    _usb.update(at=time.time(), id=found)
    return found


def usb_support():
    try:
        import usb.core  # noqa: F401
        return True
    except Exception:
        return False


# Whether the printer answers — shared by every device polling /status, so the
# printer's single print connection isn't knocked on by each of them, and never
# while a job is printing (it doesn't answer then, but it isn't missing).
_live = {'printing': False, 'checked': 0.0, 'online': False}


def printer_online():
    if _live['printing']:
        return True
    if time.time() - _live['checked'] < 5:
        return _live['online']
    ip = _printer['ip']
    ok = bool(ip and port_open(ip))
    _live.update(checked=time.time(), online=ok)
    return ok


def wait_ready(ip, secs):
    """The Brother stops answering while it prints the previous job, so a busy
    printer is waited for rather than treated as missing."""
    end = time.time() + secs
    while True:
        if port_open(ip, timeout=1.0):
            return True
        if time.time() >= end:
            return False
        time.sleep(0.4)


def instructions_for(images):
    qlr = BrotherQLRaster(PRINTER_MODEL)
    qlr.exception_on_warning = True
    return convert(qlr=qlr, images=images, label=LABEL_SIZE, rotate='0',
                   threshold=70.0, dither=False, compress=False, red=True,
                   dpi_600=False, hq=True, cut=True)


def print_images(images, wait=15):
    """Print a run of labels. Over USB each label is sent and confirmed in turn,
    so a failure says exactly how many printed. Over Wi-Fi the run goes down
    one connection with time to match its length."""
    take(_send_lock, wait)
    try:
        _live['printing'] = True
        try:
            _send(images)
            # the printer finishes the last label after the data is in: count it as there for a moment
            _live.update(checked=time.time() + 15, online=True)
            _printer['sent_at'] = time.time()
        finally:
            _live['printing'] = False
    finally:
        _send_lock.release()


def _send(images):
    last = None
    usb = usb_printer(fresh=True)
    if usb:
        try:
            _send_usb(usb, images)
            _printer['route'] = 'usb'
            return
        except UsbUnavailable as e:
            last = e            # nothing went over USB: Wi-Fi is safe
    data = instructions_for(images)
    # the printer stops answering while it finishes the last job: a long wait only
    # then — a printer that's switched off is reported in about 20 s, not a minute
    recent = time.time() - _printer.get('sent_at', 0) < 30
    for attempt in range(3):
        ip = _printer['ip']
        if not (ip and wait_ready(ip, (15 if recent else 4) if attempt == 0 else 3)):
            ip = find_printer(scan=attempt == 1)
        if not ip:
            last = RuntimeError("Printer not found on the network — is it on and joined to Digbys-BOH?")
            time.sleep(1.5)
            continue
        sent = send_network(ip, data, len(images))
        if sent is True:
            _printer['route'] = 'wifi'
            return
        if sent > 0:            # part of the run went out: it may have printed some — never resent by itself
            raise PartPrinted('The connection to the printer dropped part-way — some labels may have printed. Check before printing again.',
                              uncertain=True, doubt=len(images))
        last = RuntimeError("The printer didn't take the labels — is it on, with labels in?")
        time.sleep(1.5)
    raise last


def send_network(ip, data, labels):
    """Raw print over Wi-Fi with time for the whole run (the printer takes the
    data as it prints). True when it all went in; else how many bytes did."""
    sent = 0
    try:
        with socket.create_connection((ip, PRINTER_PORT), timeout=8) as sock:
            sock.settimeout(20 + 4 * labels)
            view = memoryview(data)
            while sent < len(data):
                n = sock.send(view[sent:sent + 65536])
                if not n:
                    break
                sent += n
            try:
                sock.shutdown(socket.SHUT_WR)
            except OSError:
                pass
        return True if sent >= len(data) else sent
    except OSError:
        return sent


# ── USB: the printer reports back, so each label is confirmed before the next.
#    Anything that goes wrong once a label has started going counts as "may
#    have printed" — never sent again by itself, over USB or Wi-Fi.
STATUS_REQUEST = b'\x00' * 200 + b'\x1b\x40' + b'\x1b\x69\x53'   # invalidate, initialise, status please


def usb_backend(ident):
    from brother_ql.backends.pyusb import BrotherQLBackendPyUSB
    return BrotherQLBackendPyUSB(ident)


def usb_write(be, data):
    """Every byte or an error: pyusb can return short after a timeout without
    saying so, and brother_ql's own write ignores the count."""
    dev = getattr(be, 'write_dev', None)
    if dev is None:
        be.write(data)
        return
    n = dev.write(data, int(getattr(be, 'write_timeout', 15000)))
    if n is not None and n < len(data):
        raise IOError('only %d of %d bytes went' % (n, len(data)))


def usb_read_status(be):
    """One status message from the printer, or None if there's none yet."""
    from brother_ql.reader import interpret_response
    try:
        raw = be.read()
    except Exception:
        return None             # a read that times out only means nothing yet
    if not raw or len(raw) < 32:
        return None
    try:
        return interpret_response(bytes(raw[:32]))
    except Exception:
        return None


def printer_says(errors):
    names = [re.sub(r'\s*\([^)]*\)', '', e).strip() for e in errors]     # without brother_ql's model notes
    return 'The printer says: ' + ', '.join(names) + ' — check it has labels and the lid is shut'


def usb_wait(be, reports, idle=12.0, cap=120.0):
    """After a label has gone over USB, what the printer says about it.
    Returns (outcome, heard): outcome True once it says it printed; 'quiet' if
    a printer not known to report said nothing (counted as printed, as over
    Wi-Fi); False if a printer that reports went silent before finishing.
    Raises PrinterError when it reports a problem — `started` unless that was
    in its reply to the label's opening status request, before printing."""
    start = last = time.time()
    heard = ready = cooling = False
    printed_at = None
    quiet = 3.0 if reports is None else 0.5
    while True:
        st = usb_read_status(be)
        now = time.time()
        if st:
            heard, last = True, now     # any news keeps it waiting
            kind = st.get('status_type')
            cooling = kind == 'Notification'    # e.g. "cooling started": silence until it's done, up to the cap
            if st.get('errors'):
                raise PrinterError(printer_says(st['errors']), started=kind != 'Reply to status request')
            if kind == 'Printing completed':
                printed_at = printed_at or now
            if kind == 'Phase change' and st.get('phase_type') == 'Waiting to receive':
                ready = True
            if printed_at and ready:
                return True, heard
            continue
        if printed_at:
            if now - printed_at > 1.5:      # printed, just never said it was ready again
                return True, heard
        elif not reports and not heard:     # not known to report, and hasn't
            if now - start > quiet:
                return 'quiet', heard
        elif (now - last > idle and not cooling) or now - start > cap:
            return False, heard
        time.sleep(0.02)


def _send_usb(ident, images):
    """Label by label over USB. UsbUnavailable if nothing went over it."""
    try:
        be = usb_backend(ident)
    except Exception as e:
        raise UsbUnavailable('USB: %s' % e)
    total, done = len(images), 0
    try:
        data_for = {}                   # every label converted before any is sent; copies once
        for img in images:
            if id(img) not in data_for:
                data_for[id(img)] = instructions_for([img])
        end = time.time() + 2           # anything left unread from before
        for _ in range(50):
            try:
                if not be.read() or time.time() > end:
                    break
            except Exception:
                break
        # first ask how it is: out of labels or lid open is said before anything is sent
        try:
            usb_write(be, STATUS_REQUEST)
        except Exception as e:
            raise UsbUnavailable('USB: %s' % e)
        reports = None                  # True: it answers; False: it never does; None: not known yet
        end = time.time() + 2
        while time.time() < end:
            st = usb_read_status(be)
            if st and st.get('status_type') == 'Reply to status request':
                if st.get('errors'):
                    raise PrinterError(printer_says(st['errors']))
                reports = True
                break
            if not st:
                time.sleep(0.02)
        for img in images:
            try:
                usb_write(be, data_for[id(img)])
            except Exception as e:
                raise PartPrinted('USB stopped while sending label %d of %d (%s) — it may have printed. Check before printing again.'
                                  % (done + 1, total, e), printed=done, uncertain=True, doubt=1)
            outcome, heard = usb_wait(be, reports)
            if outcome is False:
                raise PartPrinted("The printer didn't say whether label %d of %d printed — check it before printing again."
                                  % (done + 1, total), printed=done, uncertain=True, doubt=1)
            if reports is None:
                reports = True if heard else False
            done += 1
    except PrinterError as e:
        if e.started:                   # a problem once the label was under way: it may have printed
            raise PartPrinted('%s — label %d of %d may have printed. Check before printing again.' % (e, done + 1, total),
                              printed=done, uncertain=True, doubt=1)
        if done:
            raise PartPrinted('%s (%d of %d printed)' % (e, done, total), printed=done)
        raise
    except (PartPrinted, UsbUnavailable):
        raise
    except Exception as e:
        if done:
            raise PartPrinted('USB stopped after %d of %d labels: %s' % (done, total, e), printed=done, uncertain=True, doubt=1)
        raise
    finally:
        try:
            be.dispose()
        except Exception:
            pass


# ═══════════════════════════════════════════════════════════════════════
# Routes
# ═══════════════════════════════════════════════════════════════════════
LEGACY = {'loaded': False, 'routes': [], 'error': None}


@app.route('/status', methods=['GET'])
def status():
    ip = _printer['ip']
    usb = usb_printer()
    online = printer_online()
    if not online and not usb and not _live['printing']:
        find_in_background()
    return jsonify({
        'status': 'ok',
        'server': 'digbys-print',
        'version': VERSION,
        'printer': online or bool(usb),
        'busy': _live['printing'],
        'usb': bool(usb),
        'usb_support': usb_support(),
        'wifi': online,
        'batch': True,
        'lan_app': True,
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


def qty_of(data):
    try:
        return max(1, min(50, int(data.get('quantity', 1))))
    except (TypeError, ValueError):
        return 1


def remember_done(job_ids):
    now = time.time()
    for jid in job_ids:
        if jid:
            _done_jobs[jid] = now
    while len(_done_jobs) > 2000:
        _done_jobs.popitem(last=False)


def busy_reply(e):
    return jsonify({'success': False, 'busy': True, 'error': str(e)}), 503


@app.errorhandler(Busy)
def busy_text(e):
    """The previous server's routes: Kitchen Prep shows their reply as it is."""
    return Response(str(e), status=503, mimetype='text/plain')


@app.route('/print', methods=['POST'])
def print_label():
    """One label run, or {"jobs": [...]}: a whole queue printed over one
    connection. Each job's job_id makes a retry safe — a printed job isn't
    printed again."""
    arrived = time.time()
    try:
        data = request.get_json(force=True, silent=True) or {}
        if isinstance(data.get('jobs'), list):
            return print_batch([j for j in data['jobs'] if isinstance(j, dict)])
        job_id = str(data.get('job_id') or '').strip()[:100]
        if not job_id:
            return print_without_id(data, arrived)
        if job_id in _done_jobs:
            return jsonify({'success': True, 'duplicate': True, 'printer_ip': _printer['ip']})
        images = [render(data)] * qty_of(data)
        take(_jobs_lock, JOB_WAIT)
        try:
            if job_id in _done_jobs:
                return jsonify({'success': True, 'duplicate': True, 'printer_ip': _printer['ip']})
            print_images(images)
            remember_done([job_id])
        finally:
            _jobs_lock.release()
        return jsonify({'success': True, 'printer_ip': _printer['ip'], 'route': _printer.get('route')})
    except Busy as e:
        return busy_reply(e)
    except PartPrinted as e:
        print('Print error:', e, flush=True)
        return jsonify({'success': False, 'error': str(e), 'printed': e.printed,
                        'uncertain': bool(e.uncertain or e.printed)}), 500
    except Exception as e:
        print('Print error:', e, flush=True)
        return jsonify({'success': False, 'error': str(e)}), 500


# Kitchen Prep's labels come without a job_id, and Kitchen Prep stops waiting
# after 15 s while a long run carries on printing. Its Retry then sends the same
# labels again: matched by what's on them, they're answered "printed" instead
# of printing twice — once; asked for again after that, it's on purpose.
_runs = OrderedDict()           # what's on the labels → {'start', 'end', 'ok'}
_runs_lock = threading.Lock()


def label_key(data):
    d = {k: v for k, v in data.items() if k not in ('printed_at', 'job_id')}
    return hashlib.sha1(json.dumps(d, sort_keys=True, default=str).encode()).hexdigest()


def claim_run(key, arrived, deadline):
    """('printed', None) for a retry of a run Kitchen Prep gave up waiting for —
    one that took longer than its wait, or that was still printing when this
    came in; ('printing', None) while that run is still going at the deadline;
    else (None, run): this request's own run, registered so a retry finds it."""
    seen_printing = False
    while True:
        with _runs_lock:
            run = _runs.get(key)
            now = time.time()
            if run and now - run['start'] <= 300:
                if run['end'] is not None:
                    if run['ok'] and now - run['end'] < 180 and (seen_printing or run['end'] - run['start'] >= KP_GIVES_UP):
                        del _runs[key]
                        return 'printed', None
                    run = None
            else:
                run = None
            if run is None:
                mine = {'start': arrived, 'end': None, 'ok': False}
                _runs[key] = mine
                while len(_runs) > 200:
                    _runs.popitem(last=False)
                return None, mine
        seen_printing = True            # the same labels are printing right now
        if time.time() >= deadline:
            return 'printing', None
        time.sleep(0.2)


def print_without_id(data, arrived):
    deadline = arrived + NO_ID_WAIT
    seen, run = claim_run(label_key(data), arrived, deadline)
    if seen == 'printed':
        return jsonify({'success': True, 'duplicate': True, 'printer_ip': _printer['ip']})
    if seen == 'printing':
        raise Busy('Still printing these labels — check the printer')
    try:
        images = [render(data)] * qty_of(data)
        take(_jobs_lock, deadline - time.time())
        try:
            print_images(images, wait=max(0.5, deadline - time.time()))
        finally:
            _jobs_lock.release()
        run['ok'] = True
    finally:
        run['end'] = time.time()
    return jsonify({'success': True, 'printer_ip': _printer['ip'], 'route': _printer.get('route')})


def mark_failed(results, e, total):
    """After a failed run: jobs wholly within what's known to have printed are
    done; a job with some of its labels printed — or that may have — is flagged
    to be checked; the rest didn't print."""
    printed = getattr(e, 'printed', 0) or 0
    doubt = getattr(e, 'doubt', None)
    if doubt is None:
        doubt = total if getattr(e, 'uncertain', False) else 0
    at = 0
    for r in results:
        if r['success'] is not None:
            continue
        q = r.pop('_labels')
        lo, at = at, at + q
        if at <= printed:
            r['success'] = True
            remember_done([r['job_id']])
        elif lo < printed + doubt or lo < printed:
            k = max(0, printed - lo)
            r.update(success=False, uncertain=True, printed=k,
                     error=('%d of %d printed — check before printing again' % (k, q)) if k
                     else 'May have printed — check the printer before printing again')
        else:
            r.update(success=False, error=str(e))


def print_batch(jobs):
    results, images, todo = [], [], []
    for j in jobs:
        jid = str(j.get('job_id') or '').strip()[:100]
        try:
            img = render(j)
        except Exception as e:
            results.append({'job_id': jid, 'success': False, 'error': "Couldn't draw this label: %s" % e})
            continue
        results.append({'job_id': jid, 'success': None, '_labels': qty_of(j), '_img': img})
    n = sum(r.get('_labels', 0) for r in results if r['job_id'] not in _done_jobs)
    if n > MAX_BATCH_LABELS:
        return jsonify({'success': False, 'error': 'Too many labels in one go (%d) — send %d at most' % (n, MAX_BATCH_LABELS),
                        'results': [{'job_id': r['job_id'], 'success': False, 'error': r.get('error') or 'Not printed'} for r in results]}), 400
    try:
        take(_jobs_lock, JOB_WAIT)
    except Busy as e:
        return jsonify({'success': False, 'busy': True, 'error': str(e),
                        'results': [{'job_id': r['job_id'], 'success': False, 'busy': True, 'error': str(e)} for r in results]}), 503
    try:
        for r in results:
            img = r.pop('_img', None)
            if r['success'] is not None:
                continue
            if r['job_id'] and r['job_id'] in _done_jobs:
                r.pop('_labels')
                r.update(success=True, duplicate=True)
                continue
            images.extend([img] * r['_labels'])
            todo.append(r['job_id'])
        if images:
            try:
                print_images(images)
            except Busy as e:
                for r in results:
                    if r['success'] is None:
                        r.pop('_labels')
                        r.update(success=False, busy=True, error=str(e))
                return jsonify({'success': False, 'busy': True, 'error': str(e), 'results': results}), 503
            except Exception as e:
                print('Print error:', e, flush=True)
                mark_failed(results, e, len(images))
                return jsonify({'success': False, 'error': str(e), 'uncertain': any(r.get('uncertain') for r in results),
                                'results': results}), 500
            remember_done(todo)
            for r in results:
                if r['success'] is None:
                    r.pop('_labels')
                    r['success'] = True
    finally:
        _jobs_lock.release()
    ok = all(r['success'] for r in results)
    return jsonify({'success': ok, 'results': results, 'printed': len(images), 'printer_ip': _printer['ip'],
                    'route': _printer.get('route')}), (200 if ok else 500)


# ── CPS on the kitchen Wi-Fi: http://<pi>:3000 serves the app itself, so the
#    iPads print straight to the Pi — no internet, no tunnel. Kept up to date
#    from digbys-cps.vercel.app; the last copy is used when that's unreachable.
APP_FILES = ['manifest.webmanifest', 'icons/apple-touch-icon.png', 'icons/favicon-64.png',
             'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png']
_appdl = {'at': 0.0, 'running': False}


def _download(path, limit=8000000):
    req = urllib.request.Request(APP_URL + '/' + path, headers={'User-Agent': 'digbys-print', 'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(req, timeout=12) as r:
        return r.read(limit)


def _save(path, data):
    full = os.path.join(APP_DIR, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    tmp = full + '.tmp'
    with open(tmp, 'wb') as fh:
        fh.write(data)
    os.replace(tmp, full)


def refresh_app():
    """Fetch the latest CPS; only a complete copy replaces the one on the Pi."""
    try:
        html = _download('')
        if b"<title>Digby's CPS</title>" in html[:4000] and len(html) > 100000 and html.rstrip().endswith(b'</html>'):
            _save('index.html', html)
        for f in APP_FILES:
            try:
                _save(f, _download(f, 2000000))
            except Exception:
                pass
        try:
            _save('pi/VERSION', _download('pi/VERSION', 100))
        except Exception:
            pass
    except Exception as e:
        print('App download failed:', e, flush=True)
    finally:
        _appdl.update(at=time.time(), running=False)


def refresh_app_soon(max_age=600):
    if _appdl['running'] or time.time() - _appdl['at'] < max_age:
        return
    _appdl['running'] = True
    threading.Thread(target=refresh_app, daemon=True).start()


@app.route('/', methods=['GET'])
@app.route('/index.html', methods=['GET'])
def lan_app():
    path = os.path.join(APP_DIR, 'index.html')
    if not os.path.exists(path) and not _appdl['running']:
        _appdl['running'] = True
        refresh_app()
    refresh_app_soon()
    if not os.path.exists(path):
        return Response("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'>"
                        "<p style='font:17px system-ui;padding:24px'>CPS hasn't been downloaded to the Pi yet — "
                        "it needs the internet once. Try again in a minute.</p>", status=503, mimetype='text/html')
    with open(path, 'rb') as fh:
        html = fh.read().decode('utf-8', 'replace')
    direct = not request.headers.get('X-Forwarded-For') and not request.headers.get('Ngrok-Trace-Id') \
        and (request.remote_addr or '') not in ('127.0.0.1', '::1')
    resp = Response(html.replace('<html', '<html data-pi="1"', 1) if direct else html, mimetype='text/html')
    resp.headers['Cache-Control'] = 'no-cache'
    return resp


@app.route('/manifest.webmanifest', methods=['GET'])
@app.route('/icons/<name>', methods=['GET'])
@app.route('/pi/VERSION', methods=['GET'])
def lan_app_file(name=None):
    rel = 'icons/' + name if name else request.path.lstrip('/')
    if rel not in APP_FILES + ['pi/VERSION']:
        return Response('not found', status=404)
    if not os.path.exists(os.path.join(APP_DIR, rel)):
        refresh_app_soon(0)
        return Response('not found', status=404)
    return send_from_directory(APP_DIR, rel)


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
            # its callers give up after a few seconds: busy is said rather than printing late
            take(_send_lock, LEGACY_WAIT)
            try:
                _live['printing'] = True
                try:
                    out = real_send(*args, **kw)
                    _printer['sent_at'] = time.time()
                    return out
                finally:
                    _live['printing'] = False
                    _live.update(checked=time.time() + 15, online=True)
            finally:
                _send_lock.release()
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
