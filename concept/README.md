# Preston Hill Estates — website concept

Design concepts for the prestonhillestates.com revamp.

- `homepage_src.html` — homepage: hero with rotating heritage seal, search bar,
  2004 timeline, founder section (Jamil Ahmed), listings, services, valuation, areas
- `listing_src.html` — property detail page with mortgage calculator
- `valuation_src.html` — three-step valuation request flow
- `build.py` — downloads the Fraunces fonts, inlines them plus the founder photo
  (`../IMG_7649.jpg`), and writes self-contained pages to `dist/`

Run `python3 build.py`, then open `dist/homepage.html` in a browser.
All listing data is sample/concept data, clearly marked in each page.
