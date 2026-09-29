"""The on-screen preview against the Pi's own drawing: same size, and after the
printer's red/black conversion nearly the same pixels (fonts rasterise slightly
differently in Chrome and FreeType, so edges differ by a pixel here and there)."""
from harness import *
import base64, io, importlib.util, sys
from PIL import Image, ImageOps, ImageChops
PI_TESTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pi')
sys.path.insert(0, PI_TESTS)
src = open(os.path.join(PI_TESTS, 'test_parity.py')).read()
cases_src = src[src.index('cases = {'):src.index('\n}\n', src.index('cases = {')) + 3]
ns = {}; exec(cases_src, ns); cases = ns['cases']
cases = {k: v for k, v in cases.items() if not v.get('custom')}
cases['fresh basic + note'] = dict(cases['fresh basic'], source_note='Kitchen Prep · allergens edited')
from brother_ql.image_trafos import filtered_hsv
def thermal(im):
    im = im.convert('RGB')
    red = filtered_hsv(im, lambda h: 255 if (h < 40 or h > 210) else 0, lambda s: 255 if s > 100 else 0, lambda v: 255 if v > 80 else 0)
    red = ImageOps.invert(red.convert('L')).point(lambda x: 0 if x < 76 else 255, mode='1')
    blk = filtered_hsv(im, lambda h: 255, lambda s: 255, lambda v: 255 if v < 80 else 0)
    blk = ImageOps.invert(blk.convert('L')).point(lambda x: 0 if x < 76 else 255, mode='1')
    out = Image.new('RGB', im.size, (255, 255, 255))
    out.paste((24, 22, 21), mask=blk); out.paste((213, 25, 32), mask=red)
    return out
with sync_playwright() as pw:
    e = Env(pw); p = e.open(); e.login()
    p.evaluate('loadLabelFonts()')
    p.wait_for_timeout(300)
    worst = 0
    for name, data in cases.items():
        url = p.evaluate("d=>{const c=thermal(drawLabel(d));return c.toDataURL('image/png');}", data)
        web = Image.open(io.BytesIO(base64.b64decode(url.split(',')[1]))).convert('RGB')
        pi = thermal(PI.mod.render(dict(data)))
        same_size = web.size == pi.size
        diff = ImageChops.difference(web, pi).convert('L').point(lambda x: 255 if x > 40 else 0)
        frac = sum(1 for v in diff.getdata() if v) / (pi.size[0] * pi.size[1]) if same_size else 1
        worst = max(worst, frac)
        check(f'{name}: same size {web.size} vs {pi.size}, {frac*100:.2f}% pixels differ', same_size and frac < 0.05)
        if frac >= 0.01 or not same_size:
            side = Image.new('RGB', (pi.size[0] * 2 + 10, max(pi.size[1], web.size[1])), (200, 200, 200))
            side.paste(pi, (0, 0)); side.paste(web, (pi.size[0] + 10, 0))
            side.save(f'{SHOTS}/parity-{name.replace(" ", "_").replace("+","and")}.png')
    e.close()
summary()
