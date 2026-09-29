"""Proves the new server draws exactly what the Pi prints today, and that the
brother_ql conversion still accepts every label."""
import importlib.util, sys, os
from PIL import ImageChops
sys.path.insert(0, os.path.dirname(__file__))
import reference_current as ref

spec = importlib.util.spec_from_file_location('v2', os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'pi', 'printserver.py'))
v2 = importlib.util.module_from_spec(spec)
os.environ['HOME'] = '/tmp/pitest-home'
spec.loader.exec_module(v2)

cases = {
  'fresh basic': dict(product_name='Chimichurri — Sirloin Steak', job_code='GS031026CORP', date_prepped='2026-09-28', date_useby='2026-10-01', staff_name='James Brierley', section='Mains', contains='Sulphites, Mustard', may_contain='Nuts', notes='Made without alliums', printed_at='22:57'),
  'long name wraps': dict(product_name='Brown Butter Chicken Breast with Tarragon Cream and Charred Leeks', job_code='AR031026PRIV', date_prepped='2026-09-28', date_useby='2026-10-01', staff_name='Ellie', section='Mains', contains='Milk', printed_at='08:10'),
  'no allergens': dict(product_name='Plain Scones', date_prepped='2026-09-28', date_useby='2026-09-30', staff_name='James', printed_at='09:00'),
  'frozen': dict(product_name='Beef Shin Ragu', job_code='JB241026PRIV', status='FROZEN', status_date='2026-09-28', date_prepped='2026-09-27', date_useby='2026-12-27', staff_name='James', section='Mains', contains='Celery, Gluten, Sulphites', printed_at='10:00', weight_mode='weight', weight_display='2.4kg'),
  'thawed': dict(product_name='Chicken Liver Parfait', status='THAWED', status_date='2026-09-28', date_prepped='2026-09-01', date_useby='2026-10-01', staff_name='James', contains='Milk, Eggs', may_contain='Gluten', notes='From freezer 2 - use first', printed_at='11:00'),
  'portions': dict(product_name='GF Sticky Toffee Pudding', job_code='AR031026PRIV', date_prepped='2026-09-28', date_useby='2026-10-01', staff_name='James', section='Dessert', contains='Milk, Eggs', weight_mode='portions', weight_display='×2 portions · 150g each', printed_at='12:00'),
  'kp label_status': dict(product_name='Brine', label_status='FROZEN', date_prepped='2026-09-28', date_useby='2026-12-27', staff_name='Kitchen', printed_at='12:00'),
  'many allergens + long notes': dict(product_name='Everything Sauce', date_prepped='2026-09-28', date_useby='2026-10-01', staff_name='James', contains='Gluten, Crustaceans, Eggs, Fish, Peanuts, Soya, Milk, Nuts, Celery, Mustard, Sesame, Sulphites, Lupin, Molluscs', may_contain='Nuts, Sesame, Lupin, Molluscs, Crustaceans', notes='A very long note that keeps going and going so it wraps across more than one line and then maybe a third line as well because chefs write a lot', printed_at='13:00'),
  'plate allergy': dict(plate=True, guest_name='John Doe', table='4', position='3', dietary='Gluten Free', dish='Gluten free bread, chilli honey butter', urgency='allergy', printed_at='19:02'),
  'plate dislike long': dict(plate=True, guest_name='Martin Turner', table='1', position='5', dietary='Alternate Menu · No mushrooms · No alliums at all please', dish='TEST dish with a much longer description that should wrap onto a second line for sure', urgency='dislike', printed_at='23:51'),
  'plate intolerance no dish': dict(plate=True, guest_name='Sam', table='12', position='10', dietary='Lactose Free', urgency='intolerance', printed_at='20:00'),
  'storage flour': dict(storage=True, product_name='Plain Flour', date_prepped='2026-08-28', contains='Gluten', printed_at='today'),
  'storage sugar': dict(storage=True, product_name='Granulated Sugar', date_prepped='2026-08-28', contains='', printed_at='today'),
  'storage long + notes': dict(storage=True, product_name='Self Raising Flour Extra Fine Italian Tipo 00', date_prepped='2026-08-28', contains='Gluten', may_contain='Sesame', notes='Top shelf', printed_at='today'),
  'storage no date': dict(storage=True, product_name='Caster Sugar', printed_at='today'),
  'custom lines': dict(custom=True, lines=[{'text': 'FLOUR', 'size': 72}, {'text': 'Dry store', 'size': 28}]),
}

bad = 0
for name, data in cases.items():
    a = ref.render(dict(data))
    b = v2.render(dict(data))
    same = a.size == b.size and ImageChops.difference(a.convert('RGB'), b.convert('RGB')).getbbox() is None
    print(('SAME ' if same else 'DIFF ') + name, a.size, b.size)
    if not same:
        bad += 1
    # conversion to printer instructions must succeed exactly as on the Pi
    qlr = v2.BrotherQLRaster(v2.PRINTER_MODEL); qlr.exception_on_warning = True
    ins = v2.convert(qlr=qlr, images=[b], label=v2.LABEL_SIZE, rotate='0', threshold=70.0, dither=False, compress=False, red=True, dpi_600=False, hq=True, cut=True)
    assert len(ins) > 1000, name
    os.makedirs('/tmp/pitest-out', exist_ok=True); b.save('/tmp/pitest-out/out_%s.png' % name.replace(' ', '_').replace('+', 'and'))

# source note only changes the footer
d = dict(cases['fresh basic']); d['source_note'] = 'Kitchen Prep'
a = ref.render(dict(cases['fresh basic'])); b = v2.render(d)
diff = ImageChops.difference(a, b).getbbox()
print('source note diff box', diff, 'height', a.size[1])
assert diff and diff[1] >= a.size[1] - 30, 'note must only touch the footer'
print('FAILED' if bad else 'ALL SAME')
sys.exit(1 if bad else 0)
