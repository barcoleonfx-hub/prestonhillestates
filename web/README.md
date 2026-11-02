# Preston Hill Estates — website and property portal

One app that serves everything:

- **The homepage** at `/`: the approved design (gold logo, rotating seal, 2004 timeline, founder story),
  with live "Featured this week" listings, a working property search, and the valuation form and video
  pop-up sending straight into the portal. Its source is `concept/homepage_src.html`; after editing it run
  `node scripts/build-home.mjs` to regenerate `src/app/(home)/home.css` and `home-content.ts`.

- **The property portal** at `/admin`: staff sign in to add and edit listings, upload photos,
  floorplans, EPC graphs, brochures and video tours, publish or withdraw listings, and handle
  viewing requests.
- **The call log and contacts** (`/admin/my-day`, `/admin/contacts`): log any phone call or walk-in in
  under a minute from a panel that opens anywhere in the portal (press **N**), with one record per person,
  callbacks that pop up when due, and website enquiries landing on the same records.
- **The office diary** at `/admin/diary`: book viewings and valuations in a few taps (day, time,
  how long, who's going), with on-screen alerts and a chime on every staff screen, emails with a
  calendar invite, reminders before each appointment, and a required outcome form afterwards.
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

### Quickest: Render (one service with a disk; at the time of writing roughly $10 a month, check render.com/pricing)

`render.yaml` at the root of the repository sets everything up: the website and portal on one Node
service, with a persistent disk for the database, photos, videos and saved emails.

1. Create an account at render.com and connect GitHub.
2. **New → Blueprint**, choose this repository and the branch to deploy.
3. Fill in the values it asks for: `ADMIN_EMAIL` and `ADMIN_PASSWORD` (the first admin account),
   `PORTAL_URL` (the address Render gives you, e.g. `https://prestonhill.onrender.com`), and the
   `SMTP_*` details when you have them (they can be added later under Environment).
4. Deploy. Sign in at `<address>/admin`, change your password, and add staff under **Staff**.
5. For reminders and the daily clean-up when nobody has the portal open, add a Render Cron Job (or use
   cron-job.org) that calls `<address>/api/cron/reminders` every 5 minutes with the header
   `Authorization: Bearer <CRON_SECRET>` (the value is under Environment).
6. Later, point `prestonhillestates.com` at it under **Settings → Custom domains**.

### Larger setup: managed database and media bucket

1. **Database**: create a libSQL database (e.g. Turso) and set `DATABASE_URL` and `DATABASE_AUTH_TOKEN`.
2. **Media**: create an S3-compatible bucket (Cloudflare R2 is cheap for video; no egress fees),
   expose it on a public URL, and set `STORAGE_DRIVER=s3` plus the `S3_*` and `MEDIA_PUBLIC_BASE_URL`
   variables. The bucket needs a CORS rule allowing `PUT` from the website's domain, because the
   browser uploads files straight to the bucket.
3. **Hosting**: deploy the `web` folder to any Node host (Vercel, Render, Railway or a VPS).
   Set `AUTH_SECRET` to a long random value.
4. Run `npm run db:migrate` against the production database, then `npm run create-admin` once to
   make the first admin. Everyone else is added from **Staff** in the portal.
5. **Email**: set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` (an Office 365 or
   Google Workspace mailbox works), and `PORTAL_URL` for links in the emails. Without SMTP, emails are
   written to `data/outbox` instead.
6. **Reminders when nobody is signed in**: set `CRON_SECRET` and call `/api/cron/reminders` every
   5 minutes with `Authorization: Bearer <CRON_SECRET>` (Vercel Cron, cron-job.org or a server crontab).
   While anyone has the portal open, reminders also fire from their screen.

## Calls, contacts and callbacks

- **Logging a call**: press **N** (or "Log a call" in the sidebar). Type the number first: anyone already
  known appears as you type, matched however the number is written (`+44 7700…`, `07700…`). Pick who's
  calling (buyer, tenant, seller, landlord, other) and only the relevant questions appear: property asked
  about, areas, bedrooms, budget and position for applicants; the property address for owners. Every call
  needs a next step: call back (day, time and who), book a viewing, book a valuation, or no action.
  Booking a viewing or valuation goes straight to the diary with the caller filled in.
- **One record per person**: calls, callbacks, website enquiries, viewings, valuations and outcomes all
  build up on one timeline. A new number for a known person is kept as their second number.
- **Callbacks** pop up with a chime for the person they're assigned to when due (and are emailed), sit on
  their **My day** page until done, and are ticked off automatically when that person logs the call.
  Giving someone else a callback alerts them straight away.
- **My day** shows each person's overdue and upcoming callbacks, today's appointments, website leads nobody
  has dealt with yet, and the calls logged today. "Whole office" shows everyone's.
- **Privacy**: every opening and change of a contact record is logged; admins can see who looked at what,
  and can archive a contact. Once a day, contacts with no calls, enquiries or bookings for 2 years
  (`RETENTION_MONTHS`) are deleted with their call history, unless a callback or appointment is still open.
  Website enquiries older than that are deleted, and old diary entries keep the date and address but lose
  the visitor's name, number and notes. The privacy policy should say the same.

## The diary, alerts and outcomes

- **Booking**: pick the type, the property (or type an address), a day chip, a time slot and a
  duration, then the person going. Slots that person is already booked for are striped red, and the
  server refuses a double booking unless you choose "Book anyway". "Book viewing" on a website
  enquiry fills in the caller's details.
- **Alerts**: every open portal tab checks in every 20 seconds. New bookings, changes, cancellations and
  reminders appear as cards with a chime until each person clicks "Got it". Browsers only play sound
  after the page has been clicked once, and desktop pop-ups need "Turn on desktop alerts" once per browser.
- **Emails**: all active staff get an email for each booking, change, cancellation and reminder. Booking
  emails carry an `.ics` invite so it can go straight into Outlook, Google or Apple calendars.
- **Outcomes**: 15 minutes after an appointment ends, the person who went is locked out of the portal
  by a form until they record whether it went ahead, how it went, notes and the next step. Admins see
  every overdue outcome in the diary and can fill them in.
- **Staff roles**: admins can add staff, switch accounts off, reset passwords and manage roles.
  Negotiators can do everything else.

## Testing

`scripts/e2e.mjs` drives a real browser through the whole flow: sign in, create a listing,
see publishing blocked until required fields are filled, upload photos, a floorplan and a video,
change the cover photo, publish, view it on the public site and send a viewing request.

```bash
node scripts/e2e.mjs http://localhost:3000 <admin-email> <password> <assets-dir> <screenshot-dir>
```

`scripts/e2e-diary.mjs` signs in two people at once: an admin adds a negotiator, books a viewing for
them, checks the alert reaches only the other screen, checks double booking is caught, fires the
reminder, then confirms the negotiator is locked out until the outcome is recorded and that emails with
calendar invites went out. It clears appointments in the local database first, so don't point it at real data.

```bash
node scripts/e2e-diary.mjs http://localhost:3000 <admin-email> <password> <screenshot-dir>
```

`scripts/e2e-crm.mjs` covers the call log with two people: a website enquiry becoming a contact, calling
it back and handing a callback to a colleague, a repeat caller with a differently written number (no
duplicate), a new landlord booked straight into a valuation, and a due callback popping up and being closed
by logging the call. It also clears contacts and callbacks locally first.

```bash
node scripts/e2e-crm.mjs http://localhost:3000 <admin-email> <password> <screenshot-dir>
```
