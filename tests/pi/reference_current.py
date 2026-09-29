# Reference: the label drawing code as it runs on the Pi today (reconstructed
# from every change made to ~/printserver.py). Used only to prove the new server
# draws identical labels.
from PIL import Image, ImageDraw, ImageFont
import textwrap
from datetime import datetime

def load_fonts():
    try:
        B = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
        R = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
        return {
            'large':  ImageFont.truetype(B, 36),
            'medium': ImageFont.truetype(B, 28),
            'small':  ImageFont.truetype(R, 22),
            'label':  ImageFont.truetype(B, 20),
            'notes':  ImageFont.truetype(R, 24),
            'tiny':   ImageFont.truetype(R, 18),
        }
    except:
        f = ImageFont.load_default()
        return {'large':f,'medium':f,'small':f,'label':f,'notes':f,'tiny':f}

def text_width(draw, text, font):
    try:
        bb = draw.textbbox((0,0), text, font=font)
        return bb[2] - bb[0]
    except:
        return draw.textlength(text, font=font)

def wrap_to_width(draw, text, font, max_w):
    words = text.split()
    lines = []
    cur = ''
    for word in words:
        test = (cur+' '+word).strip()
        if text_width(draw, test, font) <= max_w:
            cur = test
        else:
            if cur: lines.append(cur)
            cur = word
    if cur: lines.append(cur)
    return lines or [text]

def fmt_short_date(s):
    try: return datetime.strptime(s, '%Y-%m-%d').strftime('%d/%m/%y')
    except: return s or ''

def create_label_image(data):
    f = load_fonts()
    W = 696
    product    = (data.get('product_name','') or '').strip()
    job_code   = (data.get('job_code','') or '').strip()
    prepped    = (data.get('date_prepped','') or '').strip()
    useby      = (data.get('date_useby','') or '').strip()
    staff      = (data.get('staff_name','') or '').strip()
    section    = (data.get('section','') or '').strip()
    contains   = (data.get('contains','') or '').strip()
    may        = (data.get('may_contain','') or '').strip()
    notes      = (data.get('notes','') or '').strip()
    printed_at = (data.get('printed_at','') or '').strip()
    status     = (data.get('status','') or data.get('label_status','') or '').upper().strip()
    status_date= (data.get('status_date','') or prepped or '').strip()
    weight    = (data.get('weight_display','') or '').strip()
    tmp = Image.new('RGB',(10,10),'white')
    td  = ImageDraw.Draw(tmp)
    jc_w = (text_width(td, job_code, f['small']) + 20) if job_code else 0
    name_lines = wrap_to_width(td, product, f['large'], W - 20 - jc_w)
    al_lines   = textwrap.wrap(contains, width=40) if contains else []
    may_lines  = textwrap.wrap('May contain: '+may, width=46) if may else []
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
        rows.append(('PREP DATE', prepped, f['small'], (20,20,20)))
    rows.append(('USE BY', useby, f['medium'], (185,0,0)))
    rows.append(('PREP BY', staff, f['small'], (20,20,20)))
    if weight:
        rows.append(('WEIGHT', weight, f['small'], (20,20,20)))
    if section:
        rows.append(('SECTION', section, f['small'], (20,20,20)))
    row_h    = 44
    header_h = 14 + len(name_lines)*44 + 14
    status_h = (len(status_lines)*36 + 16) if status_lines else 0
    rows_h   = len(rows) * row_h + len(rows)
    al_h     = (12 + len(al_lines)*28 + len(may_lines)*24 + 12) if (contains or may) else 36
    notes_h  = (12 + len(note_lines)*28 + 12) if note_lines else 0
    footer_h = 30
    total_h  = header_h + status_h + rows_h + 6 + al_h + notes_h + 2 + footer_h
    img  = Image.new('RGB', (W, total_h), 'white')
    draw = ImageDraw.Draw(img)
    y    = 0
    draw.rectangle([0, 0, W, header_h], fill=(20,20,20))
    ty = 14
    for line in name_lines:
        draw.text((10, ty), line, font=f['large'], fill='white')
        ty += 44
    if job_code:
        jx = W - text_width(draw, job_code, f['small']) - 10
        draw.text((jx, 16), job_code, font=f['small'], fill=(200,200,200))
    y = header_h
    if status_lines:
        draw.rectangle([0, y, W, y+status_h], fill='white')
        sy = y + 8
        for line in status_lines:
            sw = text_width(draw, line, f['medium'])
            draw.text(((W-sw)//2, sy), line, font=f['medium'], fill=(185,0,0))
            sy += 36
        y += status_h
    for lbl, val, vfont, vcol in rows:
        draw.rectangle([0, y, W, y+1], fill=(60,60,60))
        y += 1
        draw.text((10, y+12), lbl, font=f['label'], fill=(40,40,40))
        draw.text((200, y+8), val, font=vfont, fill=vcol)
        y += row_h
    draw.rectangle([0, y, W, y+6], fill=(185,0,0) if (contains or may) else (60,60,60))
    y += 6
    if contains or may:
        draw.rectangle([0, y, W, y+al_h], fill=(255,235,235))
        draw.rectangle([0, y, 8, y+al_h], fill=(185,0,0))
        ay = y+12
        for line in al_lines:
            draw.text((16, ay), line, font=f['small'], fill=(185,0,0))
            ay += 28
        for line in may_lines:
            draw.text((16, ay), line, font=f['tiny'], fill=(100,20,20))
            ay += 24
    else:
        draw.rectangle([0, y, W, y+al_h], fill=(240,240,240))
        draw.rectangle([0, y, 8, y+al_h], fill=(60,60,60))
        draw.text((16, y+9), 'No allergens declared', font=f['label'], fill=(60,60,60))
    y += al_h
    if note_lines:
        draw.rectangle([0, y, W, y+2], fill=(60,60,60))
        y += 2
        draw.rectangle([0, y, W, y+notes_h], fill=(255,250,235))
        draw.rectangle([0, y, 8, y+notes_h], fill=(140,100,0))
        ny = y+12
        for line in note_lines:
            draw.text((16, ny), line, font=f['notes'], fill=(60,40,0))
            ny += 28
        y += notes_h
    draw.rectangle([0, y, W, y+2], fill=(60,60,60))
    y += 2
    draw.rectangle([0, y, W, total_h], fill=(220,220,220))
    draw.text((10, y+7), printed_at+'  |  Digbys CPS', font=f['tiny'], fill=(60,60,60))
    return img

def create_plate_label(data):
    f = load_fonts()
    W = 696
    name     = (data.get('guest_name','') or '').strip()
    table    = (data.get('table','') or '').strip()
    pos      = (data.get('position','') or '').strip()
    dietary  = (data.get('dietary','') or '').strip()
    dish     = (data.get('dish','') or '').strip()
    urgency  = (data.get('urgency','allergy') or 'allergy').lower().strip()
    printed_at=(data.get('printed_at','') or '').strip()
    tmp=Image.new('RGB',(10,10),'white')
    td=ImageDraw.Draw(tmp)
    dish_lines=textwrap.wrap(dish,width=50) if dish else []
    dietary_lines=wrap_to_width(td,dietary,f['large'],W-20)
    URGENCY_COLS={'allergy':(185,0,0),'intolerance':(185,0,0),'dislike':(20,20,20)}
    URGENCY_LABELS={'allergy':'ALLERGY','intolerance':'INTOLERANCE','dislike':'DISLIKE'}
    ucol=URGENCY_COLS.get(urgency,(185,0,0))
    ulbl=URGENCY_LABELS.get(urgency,'ALLERGY')
    urg_h   = 44
    name_h  = 54
    diet_h  = len(dietary_lines)*48 + 16
    table_h = 46
    rule_h  = 2
    dish_h  = (10+len(dish_lines)*24+10) if dish_lines else 0
    foot_h  = 26
    total_h = urg_h+name_h+diet_h+table_h+rule_h+dish_h+foot_h
    img =Image.new('RGB',(W,total_h),'white')
    draw=ImageDraw.Draw(img)
    y=0
    draw.rectangle([0,y,W,y+urg_h],fill=ucol)
    uw=text_width(draw,ulbl,f['medium'])
    draw.text(((W-uw)//2,y+8),ulbl,font=f['medium'],fill='white')
    y+=urg_h
    draw.rectangle([0,y,W,y+name_h],fill='white')
    draw.text((14,y+10),name,font=f['large'],fill=(20,20,20))
    y+=name_h
    draw.rectangle([0,y,W,y+diet_h],fill='white')
    dy=y+8
    for line in dietary_lines:
        draw.text((14,dy),line,font=f['large'],fill=(185,0,0))
        dy+=48
    y+=diet_h
    draw.rectangle([0,y,W,y+1],fill=(60,60,60))
    y+=1
    draw.rectangle([0,y,W,y+table_h],fill='white')
    table_str='T'+table+'   P'+pos
    draw.text((14,y+10),table_str,font=f['large'],fill=(20,20,20))
    y+=table_h
    if dish_lines:
        draw.rectangle([0,y,W,y+rule_h],fill=(180,180,180))
        y+=rule_h
        draw.rectangle([0,y,W,y+dish_h],fill=(235,235,235))
        dy2=y+10
        for line in dish_lines:
            draw.text((14,dy2),line,font=f['notes'],fill=(20,20,20))
            dy2+=24
        y+=dish_h
    draw.rectangle([0,y,W,y+rule_h],fill=(180,180,180))
    y+=rule_h
    draw.rectangle([0,y,W,total_h],fill=(230,230,230))
    draw.text((14,y+5),printed_at+"  |  Digby's CPS  |  Plate Label",font=f['tiny'],fill=(100,100,100))
    return img

def create_storage_label(data):
    f = load_fonts()
    f_title = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 52)
    W = 696
    product    = (data.get('product_name','') or '').strip()
    contains   = (data.get('contains','') or '').strip()
    may        = (data.get('may_contain','') or '').strip()
    date_in    = (data.get('date_prepped','') or '').strip()
    notes      = (data.get('notes','') or '').strip()
    printed_at = (data.get('printed_at','') or '').strip()
    tmp=Image.new('RGB',(10,10),'white')
    td=ImageDraw.Draw(tmp)
    al_lines   = textwrap.wrap(contains, width=40) if contains else []
    may_lines  = textwrap.wrap('May contain: '+may, width=46) if may else []
    note_lines = textwrap.wrap(notes, width=46)[:3] if notes else []
    name_lines = wrap_to_width(td, product, f_title, W-40)
    header_h = 24 + len(name_lines)*64 + 24
    date_h   = 46 if date_in else 0
    al_h     = (12 + len(al_lines)*28 + len(may_lines)*24 + 12) if (contains or may) else 36
    notes_h  = (12 + len(note_lines)*28 + 12) if note_lines else 0
    footer_h = 30
    total_h  = header_h + (1+date_h if date_in else 0) + 6 + al_h + notes_h + 2 + footer_h
    img  = Image.new('RGB',(W,total_h),'white')
    draw = ImageDraw.Draw(img)
    y    = 0
    draw.rectangle([0,0,W,header_h],fill=(20,20,20))
    ty = 20
    for line in name_lines:
        lw = text_width(draw, line, f['large'])
        lw = text_width(draw, line, f_title)
        draw.text(((W-lw)//2, ty), line, font=f_title, fill='white')
        ty += 64
    y = header_h
    if date_in:
        draw.rectangle([0,y,W,y+1],fill=(60,60,60))
        y+=1
        draw.text((10,y+12),'DATE IN',font=f['label'],fill=(40,40,40))
        draw.text((200,y+8),date_in,font=f['medium'],fill=(20,20,20))
        y+=date_h
    draw.rectangle([0,y,W,y+6],fill=(185,0,0) if (contains or may) else (60,60,60))
    y+=6
    if contains or may:
        draw.rectangle([0,y,W,y+al_h],fill=(255,235,235))
        draw.rectangle([0,y,8,y+al_h],fill=(185,0,0))
        ay=y+12
        for line in al_lines:
            draw.text((16,ay),line,font=f['small'],fill=(185,0,0))
            ay+=28
        for line in may_lines:
            draw.text((16,ay),line,font=f['tiny'],fill=(100,20,20))
            ay+=24
    else:
        draw.rectangle([0,y,W,y+al_h],fill=(240,240,240))
        draw.rectangle([0,y,8,y+al_h],fill=(60,60,60))
        draw.text((16,y+9),'No allergens declared',font=f['label'],fill=(60,60,60))
    y+=al_h
    if note_lines:
        draw.rectangle([0,y,W,y+2],fill=(60,60,60))
        y+=2
        draw.rectangle([0,y,W,y+notes_h],fill=(255,250,235))
        draw.rectangle([0,y,8,y+notes_h],fill=(140,100,0))
        ny=y+12
        for line in note_lines:
            draw.text((16,ny),line,font=f['notes'],fill=(60,40,0))
            ny+=28
        y+=notes_h
    draw.rectangle([0,y,W,y+2],fill=(60,60,60))
    y+=2
    draw.rectangle([0,y,W,total_h],fill=(220,220,220))
    draw.text((10,y+7),printed_at+"  |  Digbys CPS  |  Storage",font=f['tiny'],fill=(60,60,60))
    return img

def create_custom_label(data):
    lines = data.get('lines', [])
    W  = 696
    fc = {}
    total_h = 20
    for line in lines:
        size = max(12, min(72, int(line.get('size', 28))))
        total_h += size + 10
    height = max(200, total_h + 30)
    img  = Image.new('RGB', (W, height), 'white')
    draw = ImageDraw.Draw(img)
    y = 15
    for line in lines:
        text = line.get('text', '')
        size = max(12, min(72, int(line.get('size', 28))))
        if size not in fc:
            try:    fc[size] = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', size)
            except: fc[size] = ImageFont.load_default()
        draw.text((15, y), text, font=fc[size], fill='black')
        y += size + 10
    return img

def render(data):
    if data.get('storage'): return create_storage_label(data)
    if data.get('plate'): return create_plate_label(data)
    if data.get('custom'): return create_custom_label(data)
    return create_label_image(data)
