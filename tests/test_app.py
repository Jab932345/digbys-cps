"""CPS 3 (v2) end-to-end checks against mocked Supabase + the real print server."""
from harness import *
import datetime, sys
T = datetime.date.today()
def D(n): return (T + datetime.timedelta(days=n)).isoformat()
ONLY = sys.argv[1:]

def wait_toast(p, text, timeout=6000):
    t = time.time()
    while (time.time() - t) * 1000 < timeout:
        try:
            if text.lower() in p.locator('#toast .toast-msg').inner_text().lower():
                return True
        except Exception:
            pass
        p.wait_for_timeout(80)
    return False
def toast_now(p):
    try: return p.locator('#toast .toast-msg').inner_text()
    except Exception: return ''
def search(p, q):
    p.fill('#q', q); p.wait_for_timeout(160)
def tile(p, text):
    return p.locator(f'#prod-results .tile:has-text("{text}")').first
def ev(p, js):
    return p.evaluate(js)
def patches(env, table='print_jobs'):
    return [x for x in env.cps.log if x[0] == 'PATCH' and x[1] == table]
def no_errors(env, label):
    errs = [x for x in env.errors if 'Failed to load resource' not in x]
    check(label + ': no console errors', not errs, errs[:4])

# ─────────────────────────────────────────────────────────────────────────
def t_wizard(pw):
    e = Env(pw, ext=True)
    p = e.open(); e.login()
    p.wait_for_selector('#prod-results .tile')
    # Sent from Kitchen Prep
    p.wait_for_selector('#inbox .inbox-row', timeout=5000)
    rows = p.locator('#inbox .inbox-row').all_inner_texts()
    check('inbox shows 3, then Show 1 more', len(rows) == 3 and 'Show 1 more' in p.locator('#inbox .inbox-more').inner_text(), rows)
    p.click('#inbox .inbox-more'); p.wait_for_timeout(100)
    rows = p.locator('#inbox .inbox-row').all_inner_texts()
    check('inbox lists the 4 recent Kitchen Prep print requests (not the 9-day-old one)', len(rows) == 4 and not any('Old brine' in r for r in rows), rows)
    check('nav badge shows 4 from Kitchen Prep', p.locator('#sb-nav .nav-n.kp').inner_text() == '4')
    cr = p.locator('#inbox .inbox-row:has-text("Crostini")')
    check('past use-by: flagged, only Dismiss offered', 'Use-by has passed' in cr.inner_text() and cr.locator('[data-act=ib-print]').count() == 0, cr.inner_text())
    check('KP component life caps Kitchen Prep’s own use-by (Brioche 48 h)', ev(p, "inboxPayload(S.inbox.find(r=>r.id===38)).date_useby") == D(2))
    sr = p.locator('#inbox .inbox-row:has-text("Sausage Rolls")').inner_text()
    check('inbox flags changed allergens and frozen', 'allergens updated since' in sr and 'Frozen' in sr, sr)
    n0 = len(e.pi.payloads)
    p.click('#inbox .inbox-row:has-text("Sausage Rolls") [data-act=ib-print]')
    wait_payloads(e, n0 + 1)
    pl = e.pi.payloads[-1]
    check('inbox print: current Kitchen Prep allergens, 1 label, weight kept', pl.get('contains') == 'Gluten, Eggs, Milk, Mustard' and pl.get('quantity') == 1 and pl.get('weight_display') == '2.4 kg', pl)
    check('inbox print: frozen with its date', pl.get('status') == 'FROZEN' and pl.get('status_date') == D(0), pl)
    p.wait_for_timeout(400)
    pa = patches(e)
    check('inbox print marks the row FROZEN', any('id=eq.36' in x[2] and x[3].get('label_status') == 'FROZEN' for x in pa), pa)
    p.click('#inbox .inbox-row:has-text("Injection-brined") [data-act=ib-print]')
    wait_payloads(e, n0 + 2)
    pl = e.pi.payloads[-1]
    check('brine run prints 10 labels with its job', pl.get('quantity') == 10 and pl.get('job_code') == 'EC171026WED' and pl.get('contains') == 'Sulphites', pl)
    check('inbox print carries a job id (a retry can’t print twice)', str(pl.get('job_id', '')).startswith('ib-'), pl.get('job_id'))
    p.click('#inbox .inbox-row:has-text("Toasted Brioche") [data-act=ib-print]')
    wait_payloads(e, n0 + 3)
    check('brioche prints with its capped use-by', e.pi.payloads[-1].get('date_useby') == D(2) and e.pi.payloads[-1].get('quantity') == 12, e.pi.payloads[-1])
    p.wait_for_timeout(300)
    p.click('#inbox .inbox-row:has-text("Crostini") [data-act=ib-dismiss]'); p.wait_for_timeout(500)
    check('dismissed with Undo', wait_toast(p, 'Dismissed') and any('id=eq.39' in x[2] and x[3].get('label_status') == 'DISMISSED' for x in patches(e)))
    p.wait_for_timeout(300)
    check('inbox empties and badge goes', p.locator('#inbox .inbox-row').count() == 0 and p.locator('#sb-nav .nav-n.kp').count() == 0)

    # Kitchen Prep copies in CPS: marked, and never offered once they're orphaned
    p.wait_for_timeout(300)
    marked = {x['id'] for x in e.cps.t['products'] if x.get('menu_type') == 'Kitchen Prep'}
    check('current Kitchen Prep copies marked in CPS', {11, 12} <= marked, marked)
    search(p, 'pork pies')
    check('orphaned copy with the sync’s freezer life hidden', p.locator('#prod-results .tile').count() == 0)
    search(p, 'scotch eggs')
    check('marked copy hidden after its rename', p.locator('#prod-results .tile').count() == 0)
    p.click('[data-act=wiz-q-clear]')

    # Kitchen Prep product with its event
    search(p, 'chimi')
    tiles = p.locator('#prod-results .tile').all_inner_texts()
    check('Kitchen Prep product listed once — the CPS copy is hidden', len([t for t in tiles if 'Chimichurri' in t]) == 1 and 'Kitchen Prep' in tiles[0], tiles)
    check('one-off offered at the top while searching', p.locator('#prod-results .oneoff-row').count() == 1)
    tile(p, 'Chimichurri').click()
    p.wait_for_selector('#job-results .job')
    hd = p.locator('#job-results .group-hd').first.inner_text()
    check('job step leads with events that have the dish', 'on the menu' in hd.lower(), hd)
    check('portions from the function sheet', '77 portions' in p.locator('#job-results .job:has-text("EC171026WED")').first.inner_text())
    check('cancelled and long-past events hidden', p.locator('#job-results .job:has-text("XX151026PRIV")').count() == 0 and p.locator('#job-results .job:has-text("OLD010926PRIV")').count() == 0)
    check('recent past events tucked away', p.locator('#job-results details.past .job:has-text("NH260926CORP")').count() == 1)
    p.click('#job-results .job:has-text("EC171026WED") >> nth=0')
    p.wait_for_selector('.rv')
    check('straight to Check and print', p.locator('.step-title').inner_text().startswith('Check and print'))
    al = p.locator('#rv-al').inner_text()
    check('allergens locked, from Kitchen Prep', 'From Kitchen Prep' in al and 'Change for this label only' in al, al)
    check('rows left on another component: the dish’s full set (never fewer)', all(a in al for a in ['Gluten', 'Celery', 'Mustard', 'Sulphites', 'Nuts']), al)
    check('use-by auto = +3 days', p.input_value('#rv-useby') == D(3))
    p.wait_for_timeout(250)
    check('label preview drawn', ev(p, "document.getElementById('lp-side').width") > 300)
    n0 = len(e.pi.payloads)
    p.click('#print-btn')
    shield = ev(p, 'W.shield-Date.now()')
    check('tap shield right after Print', shield > 300, shield)
    check('instantly back at the product step', ev(p, 'W.step') == 'product' and p.locator('#q').count() == 1)
    wait_payloads(e, n0 + 1)
    pl = e.pi.payloads[-1]
    check('payload: product, job, section, allergens, source',
          pl.get('product_name') == 'Chimichurri — Sirloin Steak' and pl.get('job_code') == 'EC171026WED' and pl.get('section') == 'Mains'
          and pl.get('contains') == 'Gluten, Celery, Mustard, Sulphites' and pl.get('may_contain') == 'Nuts' and pl.get('source_note') == 'Kitchen Prep' and pl.get('job_id'), pl)
    check('sent toast', wait_toast(p, 'Sent 1 label — Chimichurri'), toast_now(p))
    p.wait_for_timeout(400)
    rec = last_pj(e)
    check('record with source (History details on)', rec.get('source') == 'kitchen-prep' and rec.get('label_type') == 'standard' and rec.get('allergens_edited') is False, rec)
    check('job stays chosen', 'EC171026WED' in p.locator('.job-pill').inner_text())
    hd = p.locator('#prod-results .group-hd').first.inner_text()
    check('its menu is listed first', 'on the menu' in hd.lower() and 'EC171026WED' in hd, hd)

    # Sticky job survives a reload
    p.goto(APP); p.wait_for_selector('#app:not([hidden])'); p.wait_for_selector('#prod-results .tile')
    check('job still chosen after reopening the app', p.locator('.job-pill').count() == 1 and 'EC171026WED' in p.locator('.job-pill').inner_text())

    # Dish-level allergens reach every component
    search(p, 'leeks'); tile(p, 'Charred Leeks').click()
    p.wait_for_selector('.rv')
    al = p.locator('#rv-al').inner_text()
    check('Charred Leeks gets the dish allergens (Milk) and says so', 'Milk' in al and 'Brown Butter Chicken Breast' in al, al)
    p.keyboard.press('Escape'); p.wait_for_timeout(200)
    check('Escape goes back', ev(p, 'W.step') == 'product')

    # Freezer component: must say fresh or frozen; unknown allergen kept
    search(p, 'stock')
    t = tile(p, 'Brown Chicken Stock').inner_text()
    check('freezer eyebrow and unknown allergen kept (Kiwi)', 'Freezer' in t and 'Celery' in t and 'Kiwi' in t, t)
    tile(p, 'Brown Chicken Stock').click(); p.wait_for_selector('.rv, .secs')
    if p.locator('.secs').count():
        check('Kitchen Prep category that isn’t a section: asked once', True)
        p.click('.sec[data-v=""]'); p.wait_for_selector('.rv')
    check('asks fresh or frozen', 'Fresh or frozen?' in p.locator('#print-btn').inner_text())
    n0 = len(e.pi.payloads)
    p.click('#print-btn'); p.wait_for_timeout(600)
    check('won’t print until chosen', len(e.pi.payloads) == n0 and ev(p, 'W.step') == 'review')
    p.click('[data-act=wiz-status][data-v=FROZEN]')
    check('frozen use-by +90', p.input_value('#rv-useby') == D(90))
    p.click('[data-act=wiz-status][data-v=THAWED]')
    check('thawed: dated today, use-by +3', p.input_value('#rv-useby') == D(3) and p.input_value('#rv-statusDate') == D(0))
    p.click('[data-act=wiz-status][data-v=FROZEN]')
    p.click('#print-btn'); wait_payloads(e, n0 + 1)
    pl = e.pi.payloads[-1]
    check('frozen label payload', pl.get('status') == 'FROZEN' and pl.get('status_date') == D(0) and pl.get('date_useby') == D(90) and pl.get('contains') == 'Celery, Kiwi', pl)

    # Change allergens for one label: modes never downgrade by accident
    p.wait_for_timeout(700)
    search(p, 'tarragon'); tile(p, 'Tarragon Cream').click(); p.wait_for_selector('.rv')
    p.click('[data-act=wiz-al-unlock]')
    p.click('#rv-al .alc[data-v=Mustard]')
    check('edit note says it prints “allergens edited”', 'allergens edited' in p.locator('#rv-al-note').inner_text())
    p.click('#rv-al [data-act=al-mode][data-v=m]')
    p.click('#rv-al .alc[data-v=Milk]')
    st = ev(p, '({c:W.al.c,m:W.al.m})')
    check('May contain never takes Milk off Contains', st == {'c': ['Milk', 'Mustard'], 'm': []} and 'switch to Contains' in toast_now(p), st)
    p.click('#rv-al .alc[data-v=Sesame]')
    st = ev(p, '({c:W.al.c,m:W.al.m})')
    check('May contain adds Sesame as may', st == {'c': ['Milk', 'Mustard'], 'm': ['Sesame']}, st)
    p.click('#rv-al [data-act=al-mode][data-v=c]')
    p.click('#rv-al .alc[data-v=Sesame]')
    st = ev(p, '({c:W.al.c,m:W.al.m})')
    check('Contains mode upgrades Sesame', st == {'c': ['Milk', 'Mustard', 'Sesame'], 'm': []}, st)
    p.click('#rv-al .alc[data-v=Sesame]'); p.click('#rv-al .alc[data-v=Milk]')
    p.click('#rv-al [data-act=al-mode][data-v=m]'); p.click('#rv-al .alc[data-v=Milk]')
    n0 = len(e.pi.payloads)
    p.click('#print-btn'); wait_payloads(e, n0 + 1)
    pl = e.pi.payloads[-1]
    check('edited label payload', pl.get('contains') == 'Mustard' and pl.get('may_contain') == 'Milk' and pl.get('source_note') == 'Kitchen Prep · allergens edited', pl)
    p.wait_for_timeout(500)
    check('record flags allergens edited', last_pj(e).get('allergens_edited') is True, last_pj(e))
    check('Kitchen Prep product itself unchanged', ev(p, "productByKey('kp:c-tarr').contains.join()") == 'Milk')

    # How many labels sheet, then Kitchen Prep changes allergens right before printing
    p.wait_for_timeout(700)
    search(p, 'dauph'); tile(p, 'Dauphinoise').click(); p.wait_for_selector('.rv')
    p.click('[data-act=wiz-labels-sheet]'); p.wait_for_selector('.qty-grid')
    p.click('.qty[data-v="12"]')
    check('label count set to 12', 'Print 12 labels' in p.locator('#print-btn').inner_text() and p.locator('#side-n').inner_text() == '×12 labels')
    for d in e.kp.t['dishes']:
        if d['id'] == 'd-dauph':
            d['components'][0]['component_allergens'].append({'allergen': 'Eggs', 'status': 'Contains'})
    n0 = len(e.pi.payloads)
    p.click('#print-btn')
    p.wait_for_function("document.getElementById('pv-banner').innerText.includes('changed its allergens')", timeout=8000)
    check('stops: Kitchen Prep changed the allergens — kept in Didn’t print with Check', p.locator('#pv-banner [data-act=outbox-retry-all]').inner_text().strip() == 'Check' and ev(p, 'S.outbox.length') == 1 and ev(p, 'S.outbox[0].stale') is True)
    check('nothing sent', len(e.pi.payloads) == n0)
    ev(p, 'onPrinterBack()'); p.wait_for_timeout(600)
    check('never sent by itself when the printer comes back', len(e.pi.payloads) == n0)
    p.click('#pv-banner [data-act=outbox-retry-all]'); p.wait_for_selector('.rv')
    p.wait_for_timeout(300)
    al = p.locator('#rv-al').inner_text()
    check('Check reopens it with the new allergens and the count kept', 'Eggs' in al and 'Milk' in al and ev(p, 'W.labels') == 12 and 'changed' in p.locator('.rv .edit-note').first.inner_text(), al)
    p.click('#print-btn'); wait_payloads(e, n0 + 1)
    pl = e.pi.payloads[-1]
    check('prints with the new allergens', pl.get('contains') == 'Eggs, Milk' and pl.get('quantity') == 12, pl)
    p.wait_for_timeout(500)
    check('and leaves Didn’t print', ev(p, 'S.outbox.length') == 0)

    # Kitchen Prep shortens how long something keeps right before it prints: stopped, use-by redone
    p.wait_for_timeout(600)
    search(p, 'parfait'); tile(p, 'Chicken Liver Parfait').click(); p.wait_for_selector('.rv, #job-results')
    if p.locator('#job-results').count(): p.click('#job-results .job-stock'); p.wait_for_selector('.rv')
    check('parfait keeps 96 h', p.input_value('#rv-useby') == D(4), p.input_value('#rv-useby'))
    for d in e.kp.t['dishes']:
        if d['id'] == 'd-parf':
            d['components'][0]['use_by_hours'] = 48
    n0 = len(e.pi.payloads)
    p.click('#print-btn')
    p.wait_for_function("document.getElementById('pv-banner').innerText.includes('how long it keeps')", timeout=8000)
    check('shelf life changed: not printed, kept to check', len(e.pi.payloads) == n0 and ev(p, 'S.outbox.length') == 1)
    p.click('#pv-banner [data-act=outbox-retry-all]'); p.wait_for_selector('.rv'); p.wait_for_timeout(300)
    check('reopened with the new use-by', p.input_value('#rv-useby') == D(2), p.input_value('#rv-useby'))
    p.click('#print-btn'); wait_payloads(e, n0 + 1)
    check('prints with it', e.pi.payloads[-1].get('date_useby') == D(2), e.pi.payloads[-1])
    p.wait_for_timeout(500)

    # Thawed: 3 days, or the product's own life if shorter (Sticky Toffee Sponge keeps 24 h)
    search(p, 'sponge'); tile(p, 'Sticky Toffee Sponge').click(); p.wait_for_selector('.rv')
    p.click('[data-act=wiz-status][data-v=THAWED]')
    check('thawed use-by = its 24 h life', p.input_value('#rv-useby') == D(1), p.input_value('#rv-useby'))
    p.keyboard.press('Escape'); p.wait_for_timeout(150)

    # One label run is never sent twice at once, however it's retried
    e.pi.mode = 'down'
    search(p, 'croutons'); tile(p, 'Focaccia Croutons').click(); p.wait_for_selector('.rv, .secs')
    if p.locator('.secs').count(): p.click('.sec[data-v=""]'); p.wait_for_selector('.rv')
    p.click('#print-btn')
    p.wait_for_function("S.outbox.length===1", timeout=8000)
    e.pi.mode = 'ok'; n0 = len(e.pi.payloads)
    ev(p, 'Promise.all([retryOutbox(S.outbox[0].id),retryAllOutbox(),onPrinterBack()])')
    p.wait_for_timeout(1500)
    check('retry + Retry all + auto-resend at once → sent once', len(e.pi.payloads) == n0 + 1 and ev(p, 'S.outbox.length') == 0, len(e.pi.payloads) - n0)
    p.wait_for_timeout(1700)

    # Past use-by can't print
    p.wait_for_timeout(700)
    search(p, 'lasagne'); tile(p, 'Staff Lasagne').click(); p.wait_for_selector('.rv')
    check('custom product: section from its category, allergens locked', 'Mains' in p.locator('#side-sum').inner_text() and 'From the custom product' in p.locator('#rv-al').inner_text())
    p.fill('#rv-useby', D(-1)); p.wait_for_timeout(150)
    check('warns the use-by has passed', 'has passed' in p.locator('#rv-dates').inner_text())
    n0 = len(e.pi.payloads)
    p.click('#print-btn'); p.wait_for_timeout(500)
    check('past use-by blocked', len(e.pi.payloads) == n0 and 'use-by date has passed' in toast_now(p), toast_now(p))
    p.click('[data-act=wiz-useby-reset]')
    check('Auto puts it back', p.input_value('#rv-useby') == D(3))

    # Printer down → kept → sent by itself when it's back
    e.pi.mode = 'down'
    p.click('#print-btn')
    p.wait_for_function("document.getElementById('pv-banner').innerText.includes('didn’t print')", timeout=8000)
    check('didn’t print: banner with Retry, no toast on top of it', p.locator('#pv-banner [data-act=outbox-retry-all]').count() == 1 and not ev(p, "document.getElementById('toast').classList.contains('show')"))
    p.wait_for_timeout(2200)
    check('kept to retry, banner shown', ev(p, 'S.outbox.length') == 1 and 'didn’t print' in p.locator('#pv-banner').inner_text() and ev(p, 'S.printer.state') == 'offline')
    n0 = len(e.pi.payloads)
    e.pi.mode = 'ok'
    ev(p, 'checkPrinter()')
    ok = wait_payloads(e, n0 + 1, 8000)
    check('sent by itself when the printer is back', ok and e.pi.payloads[-1].get('product_name') == 'Staff Lasagne', e.pi.payloads[-1] if ok else None)
    p.wait_for_timeout(600)
    check('banner gone', ev(p, 'S.outbox.length') == 0 and p.locator('#pv-banner').inner_text().strip() == '')

    # Clear the job, then a one-off saved as a product
    p.wait_for_timeout(500)
    p.click('[data-act=wiz-job-clear]')
    check('job cleared', p.locator('.job-pill').count() == 0 and ev(p, "localStorage.getItem('dcps_job')") is None)
    search(p, 'beetroot relish')
    p.click('#prod-results .oneoff-row')
    p.wait_for_selector('#job-results .job-stock')
    p.click('#job-results .job-stock'); p.wait_for_selector('.secs')
    p.click('.sec[data-v="Mains"]'); p.wait_for_selector('.al-step')
    check('one-off: Continue waits for allergens', p.locator('[data-act=wiz-al-done]').is_disabled())
    p.click('.al-step [data-act=al-none]')
    check('No allergens enables Continue', not p.locator('[data-act=wiz-al-done]').is_disabled())
    p.click('[data-act=wiz-al-done]'); p.wait_for_selector('.rv')
    p.click('.toggle-row')
    n0 = len(e.pi.payloads)
    p.click('#print-btn'); wait_payloads(e, n0 + 1)
    pl = e.pi.payloads[-1]
    check('one-off payload', pl.get('product_name') == 'Beetroot relish' and pl.get('no_allergens') is True and pl.get('contains') is None and pl.get('job_code') is None and pl.get('source_note') == 'One-off', pl)
    p.wait_for_timeout(800)
    saved = [x for x in e.cps.t['products'] if x['name'] == 'Beetroot relish']
    check('saved as a custom product', len(saved) == 1 and saved[0]['category'] == 'Mains' and saved[0]['contains'] is None, saved)
    check('job stays as stock', 'Stock' in p.locator('.job-pill').inner_text())
    search(p, 'beetroot')
    check('saved product now listed as Custom', 'Custom' in tile(p, 'Beetroot relish').inner_text())

    # Custom product without a section: chosen once, remembered
    search(p, 'pickles'); tile(p, 'House Pickles').click(); p.wait_for_selector('.secs')
    p.click('.sec[data-v="Starters"]'); p.wait_for_selector('.rv')
    p.keyboard.press('Escape'); p.keyboard.press('Escape'); p.wait_for_timeout(200)
    ev(p, 'W=freshW();renderPrintView()')
    search(p, 'pickles'); tile(p, 'House Pickles').click(); p.wait_for_selector('.rv')
    check('section remembered for next time', 'Starters' in p.locator('#side-sum').inner_text() and 'last time' in p.locator('#side-sum').inner_text())
    p.keyboard.press('Escape'); p.wait_for_timeout(150)

    # Old Kitchen Prep copies are never offered
    search(p, 'red onion jam')
    check('old Kitchen Prep copy hidden', p.locator('#prod-results .tile').count() == 0 and p.locator('#prod-results .oneoff-row').count() == 1)
    p.click('[data-act=wiz-q-clear]')

    # Reprint from History: one label, original count shown, same batch
    sticky_before = ev(p, "JSON.stringify(LS.get('dcps_job',null))")
    p.click('.nav-item[data-to=history]'); p.wait_for_selector('.hrow')
    p.click('.hrow:has-text("Beef Shin Ragu")'); p.wait_for_selector('#lp-hi')
    p.click('[data-act=hi-reprint]'); p.wait_for_selector('.rv')
    sub = p.locator('#step-hd .sub').inner_text()
    check('reprint: ×1, originally ×3, dates kept', ev(p, 'W.labels') == 1 and 'originally ×3' in sub and p.input_value('#rv-useby') == D(89) and ev(p, 'W.status') == 'FROZEN', sub)
    n0 = len(e.pi.payloads)
    p.click('#print-btn'); wait_payloads(e, n0 + 1)
    pl = e.pi.payloads[-1]
    check('reprint payload', pl.get('quantity') == 1 and pl.get('status') == 'FROZEN' and pl.get('date_useby') == D(89), pl)
    p.wait_for_timeout(600)
    check('a reprint doesn’t take over the job for the next labels', ev(p, "JSON.stringify(LS.get('dcps_job',null))") == sticky_before, sticky_before)

    # The job stops applying 3 hours after the last label, even if the screen sat open
    ev(p, "setSticky(jobByCode('EC171026WED'));W=freshW();renderPrintView()")
    check('job pill shows the job', 'EC171026WED' in p.locator('.job-pill').inner_text())
    ev(p, "LS.set('dcps_job',{code:'EC171026WED',at:Date.now()-4*3600e3})")
    search(p, 'tarragon'); tile(p, 'Tarragon Cream').click()
    p.wait_for_selector('#job-results')
    check('3 hours on: asks for the job again', ev(p, 'W.step') == 'job')
    p.click('#job-results .job:has-text("AR031026PRIV") >> nth=0'); p.wait_for_selector('.rv')

    # Kitchen Prep shortens a shelf life while the label is open: the auto use-by follows
    for d in e.kp.t['dishes']:
        if d['id'] == 'd-chick':
            d['components'][0]['use_by_hours'] = 24
    ev(p, 'loadKP()'); p.wait_for_timeout(800)
    check('use-by follows Kitchen Prep’s new shelf life', p.input_value('#rv-useby') == D(1), p.input_value('#rv-useby'))
    no_errors(e, 'wizard')
    e.shot('v2-t-wizard')
    e.close()

# ─────────────────────────────────────────────────────────────────────────
def t_plates(pw):
    e = Env(pw)
    p = e.open(); e.login()
    p.click('.nav-item[data-to=plates]'); p.wait_for_selector('#pl-form')
    p.wait_for_selector('.guest')
    check('plates picks the next event with dietary guests', 'Alysa Remtulla' in p.locator('#pl-form .row-t').first.inner_text())
    p.click('.guest:has-text("Alysa")')
    check('guest fills name and requirement type', p.input_value('#pl-name') == 'Alysa' and 'Intolerance' in p.locator('[data-act=pl-urg].on').inner_text())
    chips = ev(p, 'PL.diets')
    check('diet chosen, implied allergen not repeated', chips == ['Gluten Free'], chips)
    p.fill('#pl-table', '3'); p.fill('#pl-pos', '2')
    p.click('[data-act=pl-dish][data-v="Chicken Liver Parfait"]')
    p.click('[data-act=pl-dish][data-v="Brown Butter Chicken Breast"]')
    check('add button counts the courses', 'Add 2 labels' in p.locator('#pl-add').inner_text())
    p.click('#pl-add'); p.wait_for_timeout(250)
    heads = p.locator('.q-course').all_inner_texts()
    check('queue grouped by course, in order', len(heads) == 2 and heads[0].lower().startswith('starters') and heads[1].lower().startswith('mains'), heads)
    check('guest shows 2 labels', p.locator('.guest:has-text("Alysa") .g-n').inner_text() == '2')
    p.click('[data-act=pl-next]'); p.wait_for_timeout(100)
    p.click('.guest:has-text("Alysa")')
    check('table and seat remembered', p.input_value('#pl-table') == '3' and p.input_value('#pl-pos') == '2')
    n0 = len(e.pi.payloads)
    p.click('.q-course:has-text("Starters") [data-act=pl-print-course]')
    wait_payloads(e, n0 + 1); p.wait_for_timeout(400)
    pl = e.pi.payloads[-1]
    check('plate payload', pl.get('plate') is True and pl.get('dish') == 'Chicken Liver Parfait' and pl.get('dietary') == 'Gluten Free' and pl.get('urgency') == 'intolerance' and pl.get('table') == '3' and pl.get('position') == '2', pl)
    check('only that course printed', len(e.pi.payloads) == n0 + 1 and ev(p, 'PL.queue.length') == 1)
    p.click('[data-act=pl-event]'); p.wait_for_selector('.sheet')
    p.click('.sheet [data-act=pl-event-pick]:has-text("Carter")'); p.wait_for_timeout(200)
    check('wedding has 4 dietary guests', p.locator('.guest').count() == 4)
    p.click('.guest:has-text("Priya")')
    check('vegan preference → Dislike, Vegan only', ev(p, 'PL.diets') == ['Vegan'] and ev(p, 'PL.urgency') == 'dislike', ev(p, '[PL.diets,PL.urgency]'))
    p.click('.guest:has-text("Hughes")')
    st = ev(p, '[PL.diets,PL.custom]')
    check('free-text requirement kept with its allergens', st == [['Crustaceans', 'Molluscs'], 'No shellfish'], st)
    p.fill('#pl-name', 'Bartholomew Montgomery-Fitzwilliam the Third'); p.wait_for_timeout(150)
    check('warns a name is too long for the label', 'Too long' in p.locator('#pl-name-warn').inner_text())
    no_errors(e, 'plates')
    e.shot('v2-t-plates')
    e.close()

# ─────────────────────────────────────────────────────────────────────────
def t_containers_history_manage(pw):
    e = Env(pw, ext=True)
    p = e.open(); e.login()
    p.click('.nav-item[data-to=containers]'); p.wait_for_selector('[data-act=ct-seed]')
    p.click('[data-act=ct-seed] >> nth=0'); p.wait_for_selector('.ct-tiles .tile')
    check('flour and sugar added', p.locator('.ct-tiles .tile').count() == 5)
    p.click('.ct-tiles .tile:has-text("Plain Flour")'); p.click('.ct-tiles .tile:has-text("Plain Flour")')
    check('tapping twice → 2 labels', p.locator('.ct-tiles .tile:has-text("Plain Flour") .cnt').inner_text() == '2')
    check('date in defaults to today', 'Today' in p.locator('#ct-date-pill').inner_text())
    p.fill('#ct-date-pill input[type=date]', D(-1)); p.wait_for_timeout(150)
    check('date pill changes', 'Yesterday' in p.locator('#ct-date-pill').inner_text())
    n0 = len(e.pi.payloads)
    p.click('#ct-side [data-act=ct-print]'); wait_payloads(e, n0 + 1); p.wait_for_timeout(400)
    pl = e.pi.payloads[-1]
    check('container payload', pl.get('storage') is True and pl.get('product_name') == 'Plain Flour' and pl.get('contains') == 'Gluten' and pl.get('quantity') == 2 and pl.get('date_prepped') == D(-1), pl)
    check('tray empties', ev(p, 'CT.tray.length') == 0)
    p.click('[data-act=ct-edit]'); p.click('.ct-tiles .tile:has-text("Caster Sugar")'); p.wait_for_selector('#ce-name')
    p.click('#aled-ce .alc[data-v=Sulphites]')
    p.click('[data-act=ce-save]'); p.wait_for_timeout(500)
    row = [x for x in e.cps.t['products'] if x['name'] == 'Caster Sugar'][0]
    check('container allergens edited', row['contains'] == 'Sulphites', row)
    p.click('[data-act=ct-edit]')

    p.click('.nav-item[data-to=history]'); p.wait_for_selector('.hrow')
    check('waiting and never-printed Kitchen Prep requests marked', 'Waiting to print' in p.locator('.hrow:has-text("Injection-brined")').inner_text() and 'Never printed' in p.locator('.hrow:has-text("Old brine")').inner_text())
    check('container row badge', 'Container' in p.locator('.hrow:has-text("Plain Flour")').first.inner_text())
    p.click('.hrow:has-text("Injection-brined")'); p.wait_for_selector('#lp-hi')
    check('waiting row offers Print it now', 'Print it now' in p.locator('[data-act=hi-reprint]').inner_text())
    n0 = len(e.pi.payloads)
    p.click('[data-act=hi-reprint]'); wait_payloads(e, n0 + 1); p.wait_for_timeout(400)
    check('prints the Kitchen Prep request', e.pi.payloads[-1].get('quantity') == 10)
    check('and marks it printed', any('id=eq.35' in x[2] and x[3].get('label_status') is None for x in patches(e)))
    p.fill('#hq', 'flour'); p.wait_for_timeout(150)
    check('history search', p.locator('.hrow').count() >= 1 and all('flour' in t.lower() for t in p.locator('.hrow').all_inner_texts()), p.locator('.hrow').all_inner_texts())
    p.fill('#hq', '')

    p.goto(APP + '#manage/products'); p.wait_for_selector('#mg-detail')
    p.wait_for_selector('#mg-detail .row-nav')
    p.click('[data-act=mg-ptab][data-v=custom]'); p.wait_for_timeout(200)
    txt = p.locator('#mg-detail').inner_text()
    check('old Kitchen Prep copies listed for tidying', 'Red Onion Jam — Chicken Liver Parfait' in txt and 'old kitchen prep copies' in txt.lower(), txt[-400:])
    chk = p.locator('#mg-detail .row-nav[data-act=cp-check]').all_inner_texts()
    check('products from before CPS 3 listed to check once (incl. the frozen-days one)', any('Pork Pies' in x for x in chk) and any('House Pickles' in x for x in chk), chk)
    p.click('#mg-detail .row-nav[data-act=cp-check]:has-text("House Pickles")'); p.wait_for_selector('#cp-name')
    p.click('.sheet [data-act=cp-save]'); p.wait_for_timeout(800)
    hp = [x for x in e.cps.t['products'] if x['name'] == 'House Pickles'][0]
    check('Save marks it as made here', hp.get('menu_type') == 'Custom', hp)
    check('and it leaves the check list', p.locator('#mg-detail .row-nav[data-act=cp-check]:has-text("House Pickles")').count() == 0)
    p.click('#mg-detail .row-nav:has-text("House Pickles")'); p.wait_for_selector('#cp-name')
    p.click('.sheet [data-act=cp-del]'); p.wait_for_timeout(700)
    check('deleted', not any(x['name'] == 'House Pickles' for x in e.cps.t['products']))
    p.click('#toast [data-act=toast-act]'); p.wait_for_timeout(800)
    hp = [x for x in e.cps.t['products'] if x['name'] == 'House Pickles']
    check('Undo puts it back with its mark', len(hp) == 1 and hp[0].get('menu_type') == 'Custom' and hp[0].get('shelf_life_hours') == 336, hp)
    p.click('[data-act=cp-tidy]'); p.wait_for_timeout(700)
    check('tidy removes them', not any(x['id'] == 16 for x in e.cps.t['products']))
    check('with Undo', wait_toast(p, 'Removed') and p.locator('#toast [data-act=toast-act]').count() == 1, toast_now(p))
    p.click('[data-act=mg-ptab][data-v=kp]'); p.wait_for_timeout(200)
    p.click('#mg-detail .row-nav:has-text("Tarragon Cream")'); p.wait_for_selector('.sheet')
    check('Kitchen Prep product is read-only here', p.locator('.sheet .alc[data-act=al-tap]').count() == 0 and 'Kitchen Prep' in p.locator('.sheet').inner_text())
    p.click('.sheet [data-act=print-product]'); p.wait_for_selector('.rv, #job-results')
    check('Print a label goes straight to the wizard', ev(p, 'S.view') == 'print' and ev(p, 'W.prod&&W.prod.name') == 'Tarragon Cream — Brown Butter Chicken Breast')
    p.goto(APP + '#manage/setup'); p.wait_for_timeout(1500)
    check('setup page renders', 'CPS database' in p.locator('#mg-detail').inner_text())
    no_errors(e, 'containers/history/manage')
    e.close()

# ─────────────────────────────────────────────────────────────────────────
def t_first_run(pw):
    e = Env(pw)
    e.cps.t['staff'].clear()
    p = e.open()
    p.wait_for_selector('#fr-name')
    p.fill('#fr-name', 'james brierley'); p.fill('#fr-pin', '1810')
    p.click('[data-act=first-run]'); p.wait_for_selector('#app:not([hidden])')
    check('first run: added and signed in as manager', ev(p, 'S.user.name') == 'James Brierley' and ev(p, 'isManager()') is True)
    no_errors(e, 'first run')
    e.close()

def t_kp_down(pw):
    e = Env(pw)
    e.kp.down = True
    p = e.open(); e.login(); p.wait_for_timeout(1200)
    check('Kitchen Prep down: banner explains', 'Kitchen Prep hasn’t loaded' in p.locator('#pv-banner').inner_text())
    check('custom products still offered', p.locator('#prod-results .tile:has-text("Staff Lasagne")').count() >= 1)
    e.kp.down = False
    p.click('[data-act=kp-retry]'); p.wait_for_timeout(1200)
    check('retry loads Kitchen Prep', p.locator('#prod-results .tile:has-text("Chimichurri")').count() >= 1 and p.locator('#pv-banner').inner_text().strip() == '')
    e.close()

def t_phone(pw):
    e = Env(pw, width=390, height=844, mobile=True)
    p = e.open(); e.login()
    p.wait_for_selector('#prod-results .tile')
    ov = ev(p, 'document.scrollingElement.scrollWidth-innerWidth')
    check('phone: no sideways scroll on Print', ov <= 0, ov)
    search(p, 'chimi'); tile(p, 'Chimichurri').click()
    p.click('#job-results .job:has-text("EC171026WED") >> nth=0'); p.wait_for_selector('.rv')
    p.wait_for_timeout(300)
    check('phone: preview drawn above the form', ev(p, "document.getElementById('lp-phone').width") > 300)
    ov = ev(p, 'document.scrollingElement.scrollWidth-innerWidth')
    check('phone: no sideways scroll on review', ov <= 0, ov)
    n0 = len(e.pi.payloads)
    p.click('#print-btn'); wait_payloads(e, n0 + 1)
    check('phone: prints', len(e.pi.payloads) == n0 + 1)
    for v in ['plates', 'containers', 'history', 'manage']:
        p.click(f'.tab[data-to={v}]'); p.wait_for_timeout(500)
        ov = ev(p, 'document.scrollingElement.scrollWidth-innerWidth')
        check(f'phone: no sideways scroll on {v}', ov <= 0, ov)
    no_errors(e, 'phone')
    e.close()

TESTS = [t_wizard, t_plates, t_containers_history_manage, t_first_run, t_kp_down, t_phone]
with sync_playwright() as pw:
    for t in TESTS:
        if ONLY and t.__name__ not in ONLY: continue
        print('──', t.__name__)
        try:
            t(pw)
        except Exception as ex:
            import traceback; traceback.print_exc()
            check(t.__name__ + ' ran to the end', False, repr(ex)[:300])
ok = summary()
sys.exit(0 if ok else 1)
