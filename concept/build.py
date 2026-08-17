#!/usr/bin/env python3
"""Builds the concept pages into self-contained HTML files in dist/.

Downloads the Fraunces fonts from Google Fonts on first run and inlines
them, together with the founder photo (IMG_7649.jpg at the repo root),
as data URIs."""
import base64, pathlib, re, urllib.request

here = pathlib.Path(__file__).parent
dist = here / "dist"
dist.mkdir(exist_ok=True)

CSS_URL = ("https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght"
           "@0,9..144,300..700;1,9..144,300..700&display=swap")
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"}

def fetch(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA)).read()

def font_b64(style):
    cache = here / f"fraunces-{style}.woff2"
    if not cache.exists():
        css = fetch(CSS_URL).decode()
        blocks = re.findall(r"/\* latin \*/\s*@font-face\s*\{([^}]*)\}", css)
        pick = None
        for block in blocks:
            is_italic = "font-style: italic" in block
            if is_italic == (style == "italic"):
                pick = re.search(r"url\((https://[^)]+\.woff2)\)", block).group(1)
        cache.write_bytes(fetch(pick))
    return base64.b64encode(cache.read_bytes()).decode()

roman, italic = font_b64("roman"), font_b64("italic")

photo = here.parent / "IMG_7649.jpg"
founder = base64.b64encode(photo.read_bytes()).decode() if photo.exists() else ""

for name in ["homepage", "listing", "valuation"]:
    src = (here / f"{name}_src.html").read_text()
    src = (src.replace("__ROMAN_B64__", roman)
              .replace("__ITALIC_B64__", italic)
              .replace("__FOUNDER_B64__", founder))
    (dist / f"{name}.html").write_text(src)
    print(f"built dist/{name}.html ({len(src):,} bytes)")
