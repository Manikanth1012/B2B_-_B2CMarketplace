#!/usr/bin/env python3
"""Inline the shared design-system layer into each self-contained persona file."""
import os, io, sys, json

SRC = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(SRC)

def read(n):
    with io.open(os.path.join(SRC, n), encoding='utf-8') as f:
        return f.read()

TPL = u"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap" rel="stylesheet">
<style>
{css}
</style>
</head>
<body>
<noscript><p style="padding:24px;font-family:Poppins,sans-serif">This prototype needs JavaScript enabled.</p></noscript>
<script>
{icons}
</script>
<script>
{core}
</script>
<script>
{data}
</script>
<script>
{shared}
</script>
<script>
{views}
</script>
</body>
</html>
"""

# (views file, output path, data file, shared file, title, description)
TARGETS = [
    # ---- Marketplace (current deliverable) ----
    ('views_consumer.js',  'consumer.html',   'mp_data.js', 'mp_shared.js',
     'Consumer storefront - Marketplace',
     'Telecom marketplace prototype: consumer B2C storefront across consumer, device and digital content marketplaces.'),
    ('views_partner.js',   'partner.html',    'mp_data.js', 'mp_shared.js',
     'Partner console - Marketplace',
     'Telecom marketplace prototype: B2B2X partner onboarding, product onboarding, orders and settlement.'),
    ('views_mpoperator.js','operator.html',   'mp_data.js', 'mp_shared.js',
     'Marketplace operator - Marketplace',
     'Telecom marketplace prototype: operator governance, commission plans, settlement runs and disputes.'),
    ('views_enterprise.js','enterprise.html', 'mp_data.js', 'mp_shared.js',
     'Enterprise buyer - Marketplace',
     'Telecom marketplace prototype: enterprise procurement of IoT, security and device products with approvals.'),

    # ---- Enterprise Self-Care (earlier deliverable, kept under selfcare/) ----
    ('views_admin.js',     'selfcare/admin.html',     'data.js', 'shared_views.js',
     'Enterprise admin - Enterprise Self-Care', 'Enterprise Self-Care prototype: Enterprise Admin persona.'),
    ('views_user.js',      'selfcare/user.html',      'data.js', 'shared_views.js',
     'Enterprise user - Enterprise Self-Care', 'Enterprise Self-Care prototype: Enterprise End User persona.'),
    ('views_lead.js',      'selfcare/team-lead.html', 'data.js', 'shared_views.js',
     'Team leader - Enterprise Self-Care', 'Enterprise Self-Care prototype: Team Leader persona.'),
    ('views_operator.js',  'selfcare/operator.html',  'data.js', 'shared_views.js',
     'Operator self-care view - Enterprise Self-Care', 'Enterprise Self-Care prototype: Operator Admin persona.'),
]

only = sys.argv[1] if len(sys.argv) > 1 else None


# ---------------------------------------------------------------------------
# Brand images for the PDF writer.
#
# The PDFs are generated in the browser, which has no zlib and cannot decode a
# PNG. So the decode happens here, once, at build time: each logo is split into
# an RGB stream and an alpha stream, both re-compressed with zlib, and emitted
# as base64. A PDF image XObject takes exactly that pair — the alpha becomes an
# /SMask — so the real approved artwork ends up in the document rather than a
# redrawn imitation of it.
# ---------------------------------------------------------------------------
def png_to_pdf_image(path):
    import zlib, struct, base64
    raw = open(path, 'rb').read()
    w, h = struct.unpack('>II', raw[16:24])
    bit, ct, _, _, interlace = raw[24], raw[25], raw[26], raw[27], raw[28]
    if bit != 8 or interlace != 0 or ct not in (2, 6):
        raise SystemExit('unsupported PNG for embedding: ' + path)
    idat = b''
    i = 8
    while i < len(raw):
        ln = struct.unpack('>I', raw[i:i+4])[0]
        typ = raw[i+4:i+8]
        if typ == b'IDAT':
            idat += raw[i+8:i+8+ln]
        i += 12 + ln
    data = zlib.decompress(idat)
    nch = 4 if ct == 6 else 3
    stride = w * nch
    prev = bytearray(stride)
    rgb, alpha = bytearray(), bytearray()
    pos = 0
    for _ in range(h):
        f = data[pos]; pos += 1
        line = bytearray(data[pos:pos+stride]); pos += stride
        # undo the PNG scanline filter
        for x in range(stride):
            a = line[x-nch] if x >= nch else 0
            b = prev[x]
            c = prev[x-nch] if x >= nch else 0
            v = line[x]
            if   f == 1: v += a
            elif f == 2: v += b
            elif f == 3: v += (a + b) >> 1
            elif f == 4:
                pp = a + b - c
                pa, pb, pc = abs(pp-a), abs(pp-b), abs(pp-c)
                v += a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
            line[x] = v & 0xFF
        prev = line
        for x in range(0, stride, nch):
            rgb += line[x:x+3]
            if nch == 4:
                alpha.append(line[x+3])
    out = {
        'w': w, 'h': h,
        'rgb': base64.b64encode(zlib.compress(bytes(rgb), 9)).decode('ascii'),
    }
    if nch == 4:
        out['a'] = base64.b64encode(zlib.compress(bytes(alpha), 9)).decode('ascii')
    return out

BRAND_IMAGES = {}
for key, rel in [('sixd', 'assets/brand/6d-logo.png'),
                 ('operator', 'assets/brand/aventa-logo.png')]:
    ap = os.path.join(OUT, rel)
    if os.path.exists(ap):
        BRAND_IMAGES[key] = png_to_pdf_image(ap)

BRAND_JS = 'const BRAND_IMG = ' + json.dumps(BRAND_IMAGES) + ';\n'

CORE_CSS = read('core.css')
ICONS    = read('icons.js')
CORE_JS  = read('core.js')

built = []
for src, dest, dataf, sharedf, title, desc in TARGETS:
    if only and only not in dest:
        continue
    if not os.path.exists(os.path.join(SRC, src)):
        print('skip (missing): ' + src); continue
    html = TPL.format(title=title, desc=desc, css=CORE_CSS, icons=ICONS,
                      core=BRAND_JS + CORE_JS,
                      data=read(dataf), shared=read(sharedf), views=read(src))
    path = os.path.join(OUT, dest)
    d = os.path.dirname(path)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(path, 'w', encoding='utf-8') as f:
        f.write(html)
    built.append((dest, len(html)))

for d, n in built:
    print('built %-24s %8.1f KB' % (d, n / 1024.0))

# --- scope guardrail: the marketplace catalogue must contain no SD-WAN / MPLS / CPQ ---
import re as _re
_banned = _re.compile(r'SD-?WAN|MPLS|CPQ|configure.price.quote', _re.I)
_cat = read('mp_data.js')
_hits = [l for l in _cat.split('\n') if _banned.search(l) and 'guardrail' not in l and 'no CPQ' not in l]
if _hits:
    print('SCOPE VIOLATION in mp_data.js:')
    for h in _hits[:5]:
        print('   ' + h.strip()[:110])
    sys.exit(1)
print('scope guardrail: no SD-WAN / MPLS / CPQ in the marketplace catalogue')
