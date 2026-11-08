"""Builds small test EPUBs from the demo text: EPUB3 (nav), EPUB2 (NCX, one file
split by anchors, Gutenberg-style), and a long book for timing."""
import re, zipfile, html, sys
from pathlib import Path

md = Path('demo/sample.md').read_text()
chapters = []
for chunk in re.split(r'\n(?=## )', md):
    if not chunk.startswith('## '): continue
    head, *rest = chunk.split('\n', 1)
    label, title = [s.strip() for s in head[3:].split('|')]
    paras = [p.strip() for p in (rest[0] if rest else '').split('\n\n') if p.strip()]
    chapters.append((label, title, paras))

def inline(t):
    t = html.escape(t, quote=False)
    t = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', t)
    t = re.sub(r'\*(.+?)\*', r'<i>\1</i>', t)
    return t.replace('"', '&#8220;', 1)

def body(paras):
    out = []
    for p in paras:
        if re.fullmatch(r'(\* ?){3}', p): out.append('<hr/>')
        elif p.startswith('>'): out.append(f'<blockquote><p>{inline(p[1:].strip())}</p></blockquote>')
        else: out.append(f'<p>{inline(p)}</p>')
    return '\n'.join(out)

XHTML = '<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>{t}</title></head><body>{b}</body></html>'
CONTAINER = '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="{p}" media-type="application/oebps-package+xml"/></rootfiles></container>'

def write(path, files):
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr('mimetype', 'application/epub+zip', compress_type=zipfile.ZIP_STORED)
        for name, data in files.items(): z.writestr(name, data, compress_type=zipfile.ZIP_DEFLATED)

def epub3(path, chs, title):
    files = {'META-INF/container.xml': CONTAINER.format(p='OEBPS/content.opf')}
    man, spine, nav = [], [], []
    # a cover page with only an image: should be skipped
    files['OEBPS/text/cover.xhtml'] = XHTML.format(t='Cover', b='<div><img src="../img/cover.jpg" alt="cover"/></div>')
    man.append('<item id="cover" href="text/cover.xhtml" media-type="application/xhtml+xml"/>'); spine.append('<itemref idref="cover"/>')
    for i, (label, t, paras) in enumerate(chs):
        f = f'text/ch{i+1:03}.xhtml'
        files['OEBPS/' + f] = XHTML.format(t=html.escape(t), b=f'<section epub:type="chapter"><h1>{html.escape(t)}</h1>\n<h2>A note</h2>\n{body(paras)}</section>' if i == 2 else f'<section epub:type="chapter"><h1>{html.escape(t)}</h1>\n{body(paras)}</section>')
        man.append(f'<item id="c{i}" href="{f}" media-type="application/xhtml+xml"/>'); spine.append(f'<itemref idref="c{i}"/>')
        nav.append(f'<li><a href="text/ch{i+1:03}.xhtml">{html.escape(t)}</a></li>')
    files['OEBPS/nav.xhtml'] = XHTML.format(t='Contents', b=f'<nav epub:type="toc"><ol>{"".join(nav)}</ol></nav>')
    man.append('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>')
    files['OEBPS/content.opf'] = f'''<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">test-3</dc:identifier><dc:title>{html.escape(title)}</dc:title><dc:creator>Test Author</dc:creator><dc:language>en</dc:language></metadata><manifest>{"".join(man)}</manifest><spine>{"".join(spine)}</spine></package>'''
    write(path, files)

def epub2_single_file(path, chs):
    parts = [f'<h1>The Margin Keeper</h1><p class="byline">An EPUB 2 test</p>']
    nav = []
    for i, (label, t, paras) in enumerate(chs):
        parts.append(f'<div class="chapter"><h2><a id="chap{i+1:02}"></a>{label.upper()}<br/>{html.escape(t)}</h2>{body(paras)}</div>')
        nav.append(f'<navPoint id="n{i}" playOrder="{i+1}"><navLabel><text>{html.escape(t)}</text></navLabel><content src="book.html#chap{i+1:02}"/></navPoint>')
    files = {
        'META-INF/container.xml': CONTAINER.format(p='content.opf'),
        'book.html': XHTML.format(t='Book', b=''.join(parts)),
        'toc.ncx': f'<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>{"".join(nav)}</navMap></ncx>',
        'content.opf': '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf"><dc:title>The Margin Keeper (EPUB 2)</dc:title><dc:creator opf:role="aut">Test Author</dc:creator></metadata><manifest><item id="b" href="book.html" media-type="application/xhtml+xml"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx"><itemref idref="b"/></spine></package>',
    }
    write(path, files)

out = Path('scripts/fixtures')
epub3(out / 'margin-keeper-epub3.epub', chapters, 'The Margin Keeper')
epub2_single_file(out / 'margin-keeper-epub2.epub', chapters)
big = [(l, f'{t} ({n+1})', p * 6) for n in range(12) for (l, t, p) in chapters]
epub3(out / 'long-book.epub', big, 'A Long Book')
(out / 'not-an-epub.epub').write_text('hello')
print('ok', [f.name for f in out.iterdir()])
