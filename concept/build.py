#!/usr/bin/env python3
"""Builds the concept pages: inlines the Fraunces fonts and the founder photo
as data URIs so each page is a single self-contained HTML file."""
import base64, pathlib

here = pathlib.Path(__file__).parent
out = here / "dist"
out.mkdir(exist_ok=True)

b64 = lambda p: base64.b64encode((here / p).read_bytes()).decode()
roman, italic = b64("fraunces-roman.woff2"), b64("fraunces-italic.woff2")
founder = b64("founder_web.jpg")

for name in ["homepage", "listing", "valuation"]:
    src = (here / f"{name}_src.html").read_text()
    src = (src.replace("__ROMAN_B64__", roman)
              .replace("__ITALIC_B64__", italic)
              .replace("__FOUNDER_B64__", founder))
    (out / f"{name}.html").write_text(src)
    print(f"built dist/{name}.html ({len(src):,} bytes)")
