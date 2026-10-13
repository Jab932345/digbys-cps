"""In-memory PostgREST stand-ins for the CPS and Kitchen Prep databases, and a
bridge that sends the app's printer calls to the real print server (v2) in
this process, with a stand-in Brother printer listening on 127.0.0.5:9100."""
import json, re, copy, datetime, itertools, threading, socket, os, importlib.util, urllib.parse

TODAY = datetime.date.today()
def d(n): return (TODAY + datetime.timedelta(days=n)).isoformat()
_ids = itertools.count(1000)
def nid(): return next(_ids)
def now_iso(): return datetime.datetime.utcnow().isoformat() + 'Z'

def kp_seed():
    def comp(cid, name, al=(), may=(), hours=None, freeze=False):
        return {'id': cid, 'name': name, 'use_by_hours': hours, 'freeze_flag': freeze, 'fridge_flag': not freeze,
                'component_allergens': [{'allergen': a, 'status': 'Contains'} for a in al] + [{'allergen': a, 'status': 'May Contain'} for a in may]}
    # Kitchen Prep keeps a dish's allergens on its FIRST component (the dish
    # builder edits them per dish). Sirloin Steak has rows on two components,
    # as a newer Kitchen Prep might store them.
    dishes = [
        {'id': 'd-tart', 'name': 'Beef Tartare Crostini', 'category': 'Canapés', 'variant_of': None, 'components': [
            comp('c-tart', 'Beef Tartare', ['Mustard', 'Eggs', 'Cereals containing gluten']), comp('c-cros', 'Crostini', hours=120)]},
        {'id': 'd-parf', 'name': 'Chicken Liver Parfait', 'category': 'Starters', 'variant_of': None, 'components': [
            comp('c-parf', 'Chicken Liver Parfait', ['Milk', 'Eggs', 'Sulphur dioxide', 'Cereals containing gluten'], hours=96), comp('c-onion', 'Red Onion Marmalade'),
            comp('c-brio', 'Toasted Brioche', hours=48)]},
        {'id': 'd-sirl', 'name': 'Sirloin Steak', 'category': 'Mains', 'variant_of': None, 'components': [
            comp('c-chimi', 'Chimichurri', ['Sulphur dioxide', 'Mustard'], ['Tree nuts']), comp('c-shin', 'Beef Shin Ragu', ['Celery', 'Cereals containing gluten', 'Sulphur dioxide'], freeze=True)]},
        {'id': 'd-chick', 'name': 'Brown Butter Chicken Breast', 'category': 'Mains', 'variant_of': None, 'components': [
            comp('c-tarr', 'Tarragon Cream', ['Milk']), comp('c-leek', 'Charred Leeks')]},
        {'id': 'd-dauph', 'name': 'Dauphinoise Potatoes', 'category': 'Sides', 'variant_of': None, 'components': [comp('c-dauph', 'Dauphinoise Potatoes', ['Milk'], hours=48)]},
        {'id': 'd-stp', 'name': 'Sticky Toffee Pudding', 'category': 'Desserts', 'variant_of': None, 'components': [
            comp('c-sponge', 'Sticky Toffee Sponge', ['Cereals containing gluten', 'Eggs', 'Milk'], hours=24, freeze=True), comp('c-toff', 'Toffee Sauce')]},
        {'id': 'd-gfstp', 'name': 'GF Sticky Toffee Pudding', 'category': 'Desserts', 'variant_of': 'd-stp', 'components': [
            comp('c-gfsp', 'GF Sponge', ['Eggs', 'Milk'], ['Cereals containing gluten'], freeze=True)]},
        {'id': 'd-sroll', 'name': 'Sausage Rolls', 'category': 'Evening Grazing', 'variant_of': None, 'components': [
            comp('c-sroll', 'Sausage Rolls', ['Cereals containing gluten', 'Mustard', 'Eggs', 'Milk'], freeze=True)]},
        {'id': 'd-trout', 'name': 'Cured Sea Trout', 'category': 'Tasting Menu', 'variant_of': None, 'components': [comp('c-trout', 'Cured Sea Trout', ['Fish', 'Mustard '], hours=72)]},
        {'id': 'd-stock', 'name': 'House Stock', 'category': 'Basics', 'variant_of': None, 'components': [comp('c-stock', 'Brown Chicken Stock', ['Celery', 'Kiwi'], freeze=True)]},
        # nothing set on the dish: every allergen comes from tagged ingredients (Kitchen Prep 45+)
        {'id': 'd-lamb', 'name': 'Lamb Flatbread', 'category': 'Canapés', 'variant_of': None, 'components': [
            dict(comp('c-lamb', 'Spiced Lamb'), recipe_ingredients=[{'ingredient_name': 'FLATBREAD ', 'name': 'FLATBREAD '}, {'ingredient_name': 'Shallots', 'name': 'Shallots'}]),
            dict(comp('c-mint', 'Mint Yoghurt'), recipe_ingredients=[{'ingredient_name': 'Greek Yoghurt', 'name': 'Greek Yoghurt'}])]},
    ]
    ingredients = [{'id': 'i1', 'name': 'Flatbread', 'allergens': ['Gluten', 'may:Sesame']},
                   {'id': 'i2', 'name': 'Greek Yoghurt', 'allergens': ['Dairy']},
                   {'id': 'i3', 'name': 'Shallots', 'allergens': []}]
    events = [
        {'id': 'ev-carter', 'job_code': 'EC171026WED', 'client_name': 'Emily & Josh Carter — Wedding', 'event_type': 'WED', 'event_date': d(19), 'start_time': '12:30', 'covers': 140, 'status': 'Confirmed', 'venue_name': 'Primrose Hill Farm',
         'guest_allergens': [{'name': 'Table 4', 'dietary': 'GF', 'type': 'allergy', 'allergens': ['Cereals containing gluten']},
                             {'name': "Bride's mother", 'dietary': 'Coeliac', 'type': 'allergy', 'allergens': ['Cereals containing gluten']},
                             {'name': 'Guest — Priya', 'dietary': 'Vegan', 'type': 'preference', 'allergens': ['Milk', 'Eggs']},
                             {'name': 'Mr Hughes', 'dietary': 'No shellfish', 'type': 'allergy', 'allergens': ['Crustaceans', 'Molluscs']}],
         'event_dishes': [{'dish_id': 'd-tart', 'portions': None}, {'dish_id': 'd-parf', 'portions': None}, {'dish_id': 'd-sirl', 'portions': 77}, {'dish_id': 'd-stp', 'portions': None}, {'dish_id': 'd-sroll', 'portions': None}]},
        {'id': 'ev-alysa', 'job_code': 'AR031026PRIV', 'client_name': 'Alysa Remtulla — 40th', 'event_type': 'PRIV', 'event_date': d(5), 'start_time': '19:00', 'covers': 12, 'status': 'Confirmed', 'venue_name': 'Airbnb',
         'guest_allergens': [{'name': 'Alysa', 'dietary': 'Gluten free', 'type': 'intolerance', 'allergens': ['Cereals containing gluten']}],
         'event_dishes': [{'dish_id': 'd-parf', 'portions': None}, {'dish_id': 'd-chick', 'portions': None}, {'dish_id': 'd-gfstp', 'portions': 1}]},
        {'id': 'ev-jlr', 'job_code': 'JLR221026CORP', 'client_name': 'JLR suppliers dinner', 'event_type': 'CORP', 'event_date': d(24), 'start_time': '18:00', 'covers': 45, 'status': 'Provisional', 'venue_name': 'Warwick', 'guest_allergens': [], 'event_dishes': []},
        {'id': 'ev-wake', 'job_code': 'DF061026WAKE', 'client_name': 'David Foster — wake', 'event_type': 'WAKE', 'event_date': d(8), 'start_time': '13:00', 'covers': 50, 'status': 'Confirmed', 'venue_name': 'St James Church Hall', 'guest_allergens': [], 'event_dishes': [{'dish_id': 'd-sroll', 'portions': None}]},
        {'id': 'ev-nigel', 'job_code': 'NH260926CORP', 'client_name': 'Nigel Hailey — Gang Show', 'event_type': 'CORP', 'event_date': d(-2), 'start_time': '12:00', 'covers': 80, 'status': 'Completed', 'venue_name': 'Gang Show HQ', 'guest_allergens': [], 'event_dishes': []},
        {'id': 'ev-cancel', 'job_code': 'XX151026PRIV', 'client_name': 'Cancelled dinner', 'event_type': 'PRIV', 'event_date': d(17), 'start_time': '19:00', 'covers': 8, 'status': 'Cancelled', 'venue_name': '', 'guest_allergens': [], 'event_dishes': []},
        {'id': 'ev-old', 'job_code': 'OLD010926PRIV', 'client_name': 'Long ago', 'event_type': 'PRIV', 'event_date': d(-40), 'start_time': '19:00', 'covers': 8, 'status': 'Completed', 'venue_name': '', 'guest_allergens': [], 'event_dishes': []},
    ]
    settings = [{'key': 'useby_chilled_days', 'value': '3'}, {'key': 'useby_frozen_days', 'value': '90'}, {'key': 'butchery_printer_url', 'value': 'https://palatable-shack-scallion.ngrok-free.dev'}]
    return {'dishes': dishes, 'events': events, 'app_settings': settings, 'ingredients': ingredients}

def cps_seed():
    staff = [{'id': 1, 'name': 'James Brierley', 'pin': '1810', 'initials': 'JB', 'color': '#7c1d0d', 'created_at': '2026-05-01T09:00:00Z'},
             {'id': 2, 'name': 'Ellie Marsh', 'pin': '1234', 'initials': 'EM', 'color': '#1e40af', 'created_at': '2026-05-01T09:00:00Z'},
             {'id': 3, 'name': 'Tom Reed', 'pin': '4321', 'initials': 'TR', 'color': '#065f46', 'created_at': '2026-05-01T09:00:00Z'}]
    products = [
        {'id': 11, 'name': 'Chimichurri — Sirloin Steak', 'category': 'Mains', 'menu_type': None, 'shelf_life_hours': 72, 'contains': 'Sulphites, Mustard', 'may_contain': 'Nuts', 'created_at': '2026-09-20T09:00:00Z'},
        {'id': 12, 'name': 'Sausage Rolls', 'category': 'Evening Grazing', 'menu_type': None, 'shelf_life_hours': 2160, 'contains': 'Gluten, Mustard, Eggs, Milk', 'may_contain': None, 'created_at': '2026-09-20T09:00:00Z'},
        {'id': 13, 'name': 'Staff Lasagne', 'category': 'Mains', 'menu_type': None, 'shelf_life_hours': 72, 'contains': 'Gluten, Milk, Celery', 'may_contain': None, 'created_at': '2026-06-01T09:00:00Z'},
        {'id': 14, 'name': 'Focaccia Croutons', 'category': 'Other', 'menu_type': None, 'shelf_life_hours': 120, 'contains': 'Gluten', 'may_contain': 'Sesame', 'created_at': '2026-06-01T09:00:00Z'},
        {'id': 16, 'name': 'Red Onion Jam — Chicken Liver Parfait', 'category': 'Starters', 'menu_type': None, 'shelf_life_hours': 72, 'contains': 'Sulphites', 'may_contain': None, 'created_at': '2026-09-01T09:00:00Z'},
        {'id': 17, 'name': 'Pork Pies', 'category': 'Evening Grazing', 'menu_type': None, 'shelf_life_hours': 2160, 'contains': None, 'may_contain': None, 'created_at': '2026-08-01T09:00:00Z'},
        {'id': 18, 'name': 'Scotch Eggs', 'category': 'Evening Grazing', 'menu_type': 'Kitchen Prep', 'shelf_life_hours': 72, 'contains': 'Eggs', 'may_contain': None, 'created_at': '2026-08-01T09:00:00Z'},
        {'id': 15, 'name': 'House Pickles', 'category': 'Sauces & Dressings', 'menu_type': None, 'shelf_life_hours': 336, 'contains': 'Mustard, Sulphites', 'may_contain': None, 'created_at': '2026-06-01T09:00:00Z'},
    ]
    jobs = [{'id': 21, 'code': 'EC171026WED', 'description': 'Emily & Josh Carter — Wedding · 17 Oct', 'created_at': '2026-09-20T09:00:00Z'},
            {'id': 22, 'code': 'SJ101026PRIV', 'description': 'Sarah Jones · 10 Oct', 'created_at': '2026-09-21T09:00:00Z'}]
    y = (TODAY - datetime.timedelta(days=1)).isoformat()
    pj = [
        {'id': 31, 'product_name': 'Chicken Liver Parfait', 'staff_name': 'Ellie Marsh', 'section': 'Starters', 'job_code': 'AR031026PRIV', 'quantity': 2, 'date_prepped': y, 'date_useby': d(3), 'contains': 'Milk, Eggs, Sulphites', 'may_contain': None, 'notes': None, 'printed_at': '16:40', 'label_status': None, 'created_at': y + 'T15:40:00Z'},
        {'id': 32, 'product_name': 'Beef Shin Ragu — Sirloin Steak', 'staff_name': 'James Brierley', 'section': 'Mains', 'job_code': None, 'quantity': 3, 'date_prepped': y, 'date_useby': d(89), 'contains': 'Celery, Gluten, Sulphites', 'may_contain': None, 'notes': 'Freezer 2', 'printed_at': '11:05', 'label_status': 'FROZEN', 'created_at': y + 'T10:05:00Z'},
        {'id': 33, 'product_name': '[Custom] FLOUR', 'staff_name': 'Tom Reed', 'section': None, 'job_code': None, 'quantity': 1, 'date_prepped': y, 'date_useby': None, 'contains': None, 'may_contain': None, 'notes': 'Custom label', 'printed_at': '09:12', 'label_status': None, 'created_at': y + 'T08:12:00Z'},
        {'id': 35, 'product_name': 'Injection-brined spatchcock chicken (raw)', 'staff_name': 'James Brierley', 'section': 'Mains', 'job_code': 'EC171026WED', 'quantity': '10', 'date_prepped': d(0), 'date_useby': d(1), 'contains': 'Sulphites', 'may_contain': None, 'notes': 'Raw - injected - cook by tomorrow', 'printed_at': '08:10', 'label_status': 'FRIDGE', 'created_at': now_iso()},
        {'id': 36, 'product_name': 'Sausage Rolls', 'staff_name': 'Kitchen', 'section': 'Evening Grazing', 'job_code': None, 'quantity': '2.4 kg', 'date_prepped': d(0), 'date_useby': d(90), 'contains': 'Gluten, Mustard', 'may_contain': None, 'notes': 'Freezer 1', 'printed_at': '08:20', 'label_status': 'FREEZER', 'created_at': now_iso()},
        {'id': 38, 'product_name': 'Toasted Brioche — Chicken Liver Parfait', 'staff_name': 'Kitchen', 'section': 'Starters', 'job_code': 'AR031026PRIV', 'quantity': '12', 'date_prepped': d(0), 'date_useby': d(3), 'contains': 'Gluten, Eggs, Milk', 'may_contain': None, 'notes': None, 'printed_at': '08:30', 'label_status': 'FRIDGE', 'created_at': now_iso()},
        {'id': 39, 'product_name': 'Crostini — Beef Tartare Crostini', 'staff_name': 'Kitchen', 'section': 'Canapés', 'job_code': None, 'quantity': '40', 'date_prepped': d(-2), 'date_useby': d(-1), 'contains': 'Gluten', 'may_contain': None, 'notes': None, 'printed_at': '08:30', 'label_status': 'FRIDGE', 'created_at': (TODAY - datetime.timedelta(days=2)).isoformat() + 'T09:00:00Z'},
        {'id': 37, 'product_name': 'Old brine', 'staff_name': 'Kitchen', 'section': 'Mains', 'job_code': None, 'quantity': '4', 'date_prepped': d(-9), 'date_useby': d(-8), 'contains': 'Sulphites', 'may_contain': None, 'notes': None, 'printed_at': '08:20', 'label_status': 'FRIDGE', 'created_at': d(-9) + 'T08:00:00Z'},
        {'id': 34, 'product_name': 'Staff Lasagne', 'staff_name': 'Tom Reed', 'section': 'Mains', 'job_code': None, 'quantity': 1, 'date_prepped': d(-3), 'date_useby': d(0), 'contains': 'Gluten, Milk', 'may_contain': None, 'notes': None, 'printed_at': '12:30', 'label_status': None, 'created_at': d(-3) + 'T11:30:00Z'},
    ]
    return {'staff': staff, 'products': products, 'job_codes': jobs, 'print_jobs': pj}

EXT_COLS = {'source', 'label_type', 'allergens_edited', 'status_date', 'weight_display'}

class DB:
    def __init__(self, name, tables, ext=True):
        self.name, self.t, self.ext, self.log = name, tables, ext, []
        self.down = False
    def _filters(self, qs):
        out = []
        for k, v in qs:
            if k in ('select', 'order', 'limit', 'offset'):
                continue
            m = re.match(r'(eq|gte|lte|gt|lt|neq|in)\.(.*)$', v)
            if m:
                out.append((k, m.group(1), urllib.parse.unquote(m.group(2))))
        return out
    @staticmethod
    def _match(row, flt):
        for col, op, val in flt:
            rv = row.get(col)
            rs = '' if rv is None else str(rv)
            if op == 'in' and rs not in [x.strip() for x in val.strip('()').split(',')]: return False
            if op == 'eq' and rs != val: return False
            if op == 'neq' and rs == val: return False
            if op == 'gte' and not (rs >= val): return False
            if op == 'lte' and not (rs <= val): return False
            if op == 'gt' and not (rs > val): return False
            if op == 'lt' and not (rs < val): return False
        return True
    def handle(self, method, path, body, prefer):
        if self.down:
            return None
        parsed = urllib.parse.urlparse(path)
        table = parsed.path.rsplit('/', 1)[-1]
        qs = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
        q = dict(qs)
        self.log.append((method, table, parsed.query, body))
        if table not in self.t:
            return 404, {'code': '42P01', 'message': f'relation "public.{table}" does not exist'}
        rows = self.t[table]
        flt = self._filters(qs)
        if method == 'GET':
            sel = q.get('select', '*')
            if table == 'print_jobs' and not self.ext:
                cols = [c.strip() for c in re.split(r',(?![^(]*\))', sel)]
                bad = [c for c in cols if c in EXT_COLS]
                if bad:
                    return 400, {'code': '42703', 'message': f'column print_jobs.{bad[0]} does not exist'}
            res = [r for r in rows if self._match(r, flt)]
            if 'order' in q:
                col, _, direction = q['order'].partition('.')
                res.sort(key=lambda r: ('' if r.get(col) is None else str(r.get(col))), reverse=direction.startswith('desc'))
            if 'limit' in q:
                res = res[:int(q['limit'])]
            return 200, copy.deepcopy(res)
        if method == 'POST':
            items = body if isinstance(body, list) else [body]
            if table == 'print_jobs' and not self.ext:
                for it in items:
                    bad = [k for k in it if k in EXT_COLS]
                    if bad:
                        return 400, {'code': 'PGRST204', 'message': f"Could not find the '{bad[0]}' column of 'print_jobs' in the schema cache"}
            out = []
            for it in items:
                row = dict(it)
                if table != 'app_settings':
                    row.setdefault('id', nid())
                row.setdefault('created_at', now_iso())
                rows.append(row); out.append(copy.deepcopy(row))
            return 201, (out if 'return=representation' in (prefer or '') else None)
        if method == 'PATCH':
            hit = [r for r in rows if self._match(r, flt)]
            for r in hit: r.update(body)
            return 200, (copy.deepcopy(hit) if 'return=representation' in (prefer or '') else None)
        if method == 'DELETE':
            keep = [r for r in rows if not self._match(r, flt)]
            gone = len(rows) - len(keep)
            rows[:] = keep
            return 204, None
        return 405, {'message': 'method'}

CORS = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Expose-Headers': '*'}

def attach_db(page, url_prefix, db):
    def handler(route, request):
        if request.method == 'OPTIONS':
            return route.fulfill(status=204, headers=CORS)
        if db.down:
            return route.abort('internetdisconnected')
        path = request.url[len(url_prefix):]
        body = None
        if request.post_data:
            try: body = json.loads(request.post_data)
            except Exception: body = None
        status, data = db.handle(request.method, path, body, request.headers.get('prefer', ''))
        route.fulfill(status=status, headers={**CORS, 'Content-Type': 'application/json'}, body='' if data is None else json.dumps(data))
    page.route(url_prefix + '**', handler)

class FakePrinter:
    def __init__(self, host='127.0.0.5', port=9100):
        self.jobs, self.bytes = 0, 0
        self.srv = socket.socket(); self.srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.srv.bind((host, port)); self.srv.listen(16)
        threading.Thread(target=self._loop, daemon=True).start()
    def _loop(self):
        while True:
            try: c, _ = self.srv.accept()
            except OSError: return
            n = 0
            while True:
                b = c.recv(65536)
                if not b: break
                n += len(b)
            if n: self.jobs += 1; self.bytes += n
            c.close()

class Pi:
    """The real print server (v2) answering at the ngrok address."""
    def __init__(self):
        os.environ['HOME'] = '/tmp/cpstest-pi-home'
        os.makedirs('/tmp/cpstest-pi-home/.digbys', exist_ok=True)
        try: os.remove('/tmp/cpstest-pi-home/.digbys/printer_ip')
        except OSError: pass
        os.environ['PRINTER_IP'] = '127.0.0.5'
        spec = importlib.util.spec_from_file_location('printserver_v2', os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'pi', 'printserver.py'))
        self.mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(self.mod)
        self.mod.KNOWN_PRINTER_IPS[:] = []
        self.client = self.mod.app.test_client()
        self.mode = 'ok'          # ok | down | error | slow | busy | part
        self.busy_left = 0
        self.payloads = []
        self.batches = []         # number of jobs in each batch request
        self.print_requests = 0
        self.status_requests = 0
        self.updatable = True
    def handle(self, route, request):
        if request.method == 'OPTIONS':
            return route.fulfill(status=204, headers=CORS)
        if self.mode == 'down':
            return route.abort('connectionrefused')
        path = urllib.parse.urlparse(request.url).path
        if path == '/print':
            data = json.loads(request.post_data or '{}')
            if self.mode == 'error':
                return route.fulfill(status=500, headers={**CORS, 'Content-Type': 'application/json'}, body=json.dumps({'success': False, 'error': 'Printer not found on the network — is it on and joined to Digbys-BOH?'}))
            self.print_requests += 1
            if self.mode == 'busy':           # another run has the printer: nothing printed
                self.busy_left -= 1
                if self.busy_left <= 0: self.mode = 'ok'
                return route.fulfill(status=503, headers={**CORS, 'Content-Type': 'application/json'}, body=json.dumps({'success': False, 'busy': True, 'error': self.mod.BUSY}))
            if isinstance(data.get('jobs'), list):
                self.batches.append(len(data['jobs']))
                self.payloads.extend(data['jobs'])
            else:
                self.payloads.append(data)
            if self.mode == 'part':           # USB stops while the 2nd label goes: 1 printed, the 2nd may have
                self.mode = 'ok'
                real = self.mod.print_images
                def part(images, wait=15):
                    raise self.mod.PartPrinted('USB stopped while sending label 2 of %d — it may have printed. Check before printing again.' % len(images), printed=1, uncertain=True, doubt=1)
                self.mod.print_images = part
                try: r = self.client.post('/print', json=data)
                finally: self.mod.print_images = real
            else:
                r = self.client.post('/print', json=data)
        elif path == '/status':
            self.status_requests += 1
            r = self.client.get('/status')
            d = r.get_json()
            if self.updatable: d['updatable'] = True
            return route.fulfill(status=200, headers={**CORS, 'Content-Type': 'application/json'}, body=json.dumps(d))
        elif path == '/update':
            return route.fulfill(status=200, headers={**CORS, 'Content-Type': 'application/json'}, body=json.dumps({'started': True, 'from': self.mod.VERSION}))
        elif path == '/shutdown':
            return route.fulfill(status=200, headers={**CORS, 'Content-Type': 'application/json'}, body=json.dumps({'success': True}))
        else:
            return route.fulfill(status=404, headers=CORS, body='not found')
        route.fulfill(status=r.status_code, headers={**CORS, 'Content-Type': 'application/json'}, body=r.get_data(as_text=True))
