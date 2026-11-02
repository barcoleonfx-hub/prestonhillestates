# Preston Hill Estates — website and property portal

One app that serves both:

- **The property portal** at `/admin`: staff sign in to add and edit listings, upload photos,
  floorplans, EPC graphs, brochures and video tours, publish or withdraw listings, and handle
  viewing requests.
- **The public website**: `/properties` (search) and `/properties/<ref>-<address>` (listing pages),
  which read live from the same database. Published listings are also available as JSON at
  `/api/public/properties`.

Built with Next.js 16, a libSQL/SQLite database (Drizzle ORM), and pluggable media storage
(local disk in development, any S3-compatible bucket in production).

## Run it locally

```bash
cd web
npm install
cp .env.example .env.local      # then set AUTH_SECRET (openssl rand -base64 48)
npm run db:migrate
npm run create-admin -- you@prestonhillestates.com "Your Name"   # prints a generated password
npm run dev                     # http://localhost:3000/admin
```

## What a listing holds

Modelled on what Rightmove, Zoopla and OnTheMarket ask agents for:

| Section | Fields |
|---|---|
| Listing | Sale or let, status (available, under offer, sold STC, sold, let agreed, let, withdrawn), featured flag, headline |
| Address | House number, street, area, town, postcode, display address, map coordinates |
| Price | Price, qualifier (guide price, offers over, POA…), rent frequency, deposit, availability, furnishing, let type, minimum tenancy, tenure, lease length, ground rent, service charge, new build, shared ownership |
| Details | Property type, bedrooms, bathrooms, receptions, floor area |
| Description | Summary, up to 12 key features, full description, room-by-room breakdown |
| Media | Photos (drag to reorder, captions, cover photo), floorplans, EPC graph, brochure PDF, uploaded video tours, YouTube/Vimeo link, virtual tour link |
| Material information | Council tax band, EPC ratings, parking, outside space, utilities, broadband, mobile signal, construction, building safety, restrictions, rights and easements, flood risk, planning, accessibility |
| Internal | Negotiator and private notes (never shown publicly) |

A listing can't be published until it has an address, postcode, price (or POA), property type,
bedrooms, a description, council tax band, tenure (for sales) and at least one photo.

## Going live

1. **Database**: create a libSQL database (e.g. Turso) and set `DATABASE_URL` and `DATABASE_AUTH_TOKEN`.
2. **Media**: create an S3-compatible bucket (Cloudflare R2 is cheap for video; no egress fees),
   expose it on a public URL, and set `STORAGE_DRIVER=s3` plus the `S3_*` and `MEDIA_PUBLIC_BASE_URL`
   variables. The bucket needs a CORS rule allowing `PUT` from the website's domain, because the
   browser uploads files straight to the bucket.
3. **Hosting**: deploy the `web` folder to any Node host (Vercel, Render, Railway or a VPS).
   Set `AUTH_SECRET` to a long random value.
4. Run `npm run db:migrate` against the production database, then `npm run create-admin` for each
   member of staff.

## Testing

`scripts/e2e.mjs` drives a real browser through the whole flow: sign in, create a listing,
see publishing blocked until required fields are filled, upload photos, a floorplan and a video,
change the cover photo, publish, view it on the public site and send a viewing request.

```bash
node scripts/e2e.mjs http://localhost:3000 <admin-email> <password> <assets-dir> <screenshot-dir>
```
