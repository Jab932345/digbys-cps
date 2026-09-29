"""Builds index.html from src/: the modules in order, the stylesheet, and the
label fonts (DejaVu subsets, base64) the on-screen preview draws with.
    python3 build.py            → index.html
    python3 build.py out.html   → somewhere else"""
import pathlib, sys
root = pathlib.Path(__file__).resolve().parent
src = root / 'src'
out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'index.html'
reg = (src / 'fonts' / 'f_reg.b64').read_text().strip()
bold = (src / 'fonts' / 'f_bold.b64').read_text().strip()
order = ['core.js', 'data.js', 'label.js', 'aled.js', 'printer.js', 'login.js', 'print.js', 'plates.js', 'containers.js', 'history.js', 'manage.js', 'app.js']
js = '\n'.join((src / f).read_text() for f in order)
js = js.replace('/*FONTS*/', f"const FONT_REG='{reg}';\nconst FONT_BOLD='{bold}';")
html = (src / 'shell.html').read_text()
html = html.replace('/*STYLE*/', (src / 'style.css').read_text()).replace('/*SCRIPT*/', js)
out.write_text(html)
print(out, len(html), 'characters')
