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

MIME = {".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}

def badge(key):
    """Logo for a link marked data-badge="key", from badges/<key>.<ext> (or web/public/{portals,accreditations})."""
    folders = [here / "badges", here.parent / "web/public/portals", here.parent / "web/public/accreditations"]
    for folder in folders:
        for ext, mime in MIME.items():
            f = folder / f"{key}{ext}"
            if f.exists():
                return f"data:{mime};base64,{base64.b64encode(f.read_bytes()).decode()}"
    return None

def inline_badges(html):
    # <a ... data-badge="key" ... aria-label="Name (opens…)">Name ...</a>: swap the visible name for the logo.
    def swap(m):
        tag, key, inner = m.group(1), m.group(2), m.group(3)
        uri = badge(key)
        if not uri:
            return m.group(0)
        label = re.search(r'aria-label="([^"]*)"', tag)
        alt = re.sub(r"\s*\(opens in a new tab\)", "", label.group(1)) if label else key
        inner = re.sub(r"^[^<]+", f'<img src="{uri}" alt="{alt}"> ', inner)
        return tag + inner + "</a>"
    return re.sub(r'(<a [^>]*data-badge="([a-z]+)"[^>]*>)(.*?)</a>', swap, html)

for name in ["homepage", "listing", "valuation"]:
    src = (here / f"{name}_src.html").read_text()
    src = (src.replace("__ROMAN_B64__", roman)
              .replace("__ITALIC_B64__", italic)
              .replace("__FOUNDER_B64__", founder))
    src = inline_badges(src)
    (dist / f"{name}.html").write_text(src)
    print(f"built dist/{name}.html ({len(src):,} bytes)")
