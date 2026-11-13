// Each entry runs once, in order; applied ids are recorded in _migrations.

const q = (s: string) => `'${s.replace(/'/g, "''")}'`
/** Adds Google reviews copied word for word from screenshots, skipping any already in the portal. */
const seedReviews = (batch: string, list: [author: string, rating: number, date: string, category: string, text: string][]) =>
  list.map(([a, r, d, c, t], i) => `INSERT INTO reviews (id, author, rating, text, reviewed_on, category, source, shown, created_by, created_at)
    SELECT ${q(`${batch}-${i + 1}`)}, ${q(a)}, ${r}, ${q(t)}, ${q(d)}, ${q(c)}, 'google', ${r >= 4 ? 1 : 0}, NULL, ${q(new Date(0).toISOString())}
    WHERE NOT EXISTS (SELECT 1 FROM reviews WHERE lower(author) = lower(${q(a)}) AND substr(text, 1, 40) = substr(${q(t)}, 1, 40))`)

export const MIGRATIONS: { id: string; sql: string[] }[] = [
  {
    id: '001_initial',
    sql: [
      `CREATE TABLE admins (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin',
        created_at TEXT NOT NULL,
        last_login_at TEXT
      )`,
      `CREATE TABLE properties (
        id TEXT PRIMARY KEY,
        ref TEXT NOT NULL UNIQUE,
        channel TEXT NOT NULL DEFAULT 'sale',
        status TEXT NOT NULL DEFAULT 'available',
        published INTEGER NOT NULL DEFAULT 0,
        featured INTEGER NOT NULL DEFAULT 0,
        headline TEXT,
        address_line1 TEXT, street TEXT, locality TEXT, town TEXT, postcode TEXT,
        display_address TEXT, latitude REAL, longitude REAL,
        price INTEGER, price_qualifier TEXT, rent_frequency TEXT, deposit INTEGER,
        available_from TEXT, furnishing TEXT, let_type TEXT, min_tenancy_months INTEGER,
        property_type TEXT, new_build INTEGER NOT NULL DEFAULT 0, tenure TEXT,
        lease_years_remaining INTEGER, ground_rent INTEGER, service_charge INTEGER,
        shared_ownership INTEGER NOT NULL DEFAULT 0,
        bedrooms INTEGER, bathrooms INTEGER, receptions INTEGER, floor_area_sqft INTEGER,
        council_tax_band TEXT, epc_current TEXT, epc_potential TEXT,
        parking TEXT, outside_space TEXT, heating TEXT, electricity TEXT, water TEXT,
        sewerage TEXT, broadband TEXT, mobile_signal TEXT, construction TEXT,
        building_safety TEXT, restrictions TEXT, rights_easements TEXT, flood_risk TEXT,
        planning TEXT, accessibility TEXT,
        summary TEXT, description TEXT, key_features TEXT,
        video_url TEXT, virtual_tour_url TEXT,
        negotiator TEXT, internal_notes TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, published_at TEXT, updated_by TEXT
      )`,
      `CREATE INDEX properties_published_idx ON properties (published, channel)`,
      `CREATE TABLE rooms (
        id TEXT PRIMARY KEY,
        property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        name TEXT NOT NULL,
        dimensions TEXT,
        description TEXT
      )`,
      `CREATE INDEX rooms_property_idx ON rooms (property_id)`,
      `CREATE TABLE media (
        id TEXT PRIMARY KEY,
        property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        storage_key TEXT NOT NULL,
        original_name TEXT,
        content_type TEXT NOT NULL,
        size_bytes INTEGER,
        caption TEXT,
        position INTEGER NOT NULL DEFAULT 0,
        is_cover INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX media_property_idx ON media (property_id, kind)`,
      `CREATE TABLE enquiries (
        id TEXT PRIMARY KEY,
        property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
        kind TEXT NOT NULL DEFAULT 'viewing',
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        message TEXT,
        handled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
    ],
  },
  {
    id: '002_enquiry_valuation_fields',
    sql: [
      `ALTER TABLE enquiries ADD COLUMN postcode TEXT`,
      `ALTER TABLE enquiries ADD COLUMN intent TEXT`,
    ],
  },
  {
    id: '003_staff_and_appointments',
    sql: [
      `ALTER TABLE admins ADD COLUMN active INTEGER NOT NULL DEFAULT 1`,
      `ALTER TABLE admins ADD COLUMN phone TEXT`,
      `CREATE TABLE appointments (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL DEFAULT 'viewing',
        property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
        address TEXT,
        starts_at TEXT NOT NULL,
        duration_min INTEGER NOT NULL DEFAULT 30,
        staff_id TEXT NOT NULL REFERENCES admins(id),
        contact_name TEXT,
        contact_phone TEXT,
        contact_email TEXT,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'scheduled',
        reminder_min INTEGER NOT NULL DEFAULT 30,
        reminded_at TEXT,
        cancel_reason TEXT,
        outcome TEXT,
        outcome_interest TEXT,
        outcome_notes TEXT,
        outcome_next TEXT,
        outcome_at TEXT,
        outcome_by TEXT,
        enquiry_id TEXT REFERENCES enquiries(id) ON DELETE SET NULL,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX appointments_start_idx ON appointments (starts_at)`,
      `CREATE INDEX appointments_staff_idx ON appointments (staff_id, status)`,
      `CREATE TABLE notifications (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        appointment_id TEXT REFERENCES appointments(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        body TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX notifications_created_idx ON notifications (created_at)`,
      `CREATE TABLE notification_reads (
        notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
        admin_id TEXT NOT NULL,
        read_at TEXT NOT NULL,
        PRIMARY KEY (notification_id, admin_id)
      )`,
      `CREATE TABLE email_log (
        id TEXT PRIMARY KEY,
        to_addr TEXT NOT NULL,
        subject TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        appointment_id TEXT,
        created_at TEXT NOT NULL
      )`,
    ],
  },
  {
    id: '004_crm',
    sql: [
      `CREATE TABLE contacts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT,
        phone_norm TEXT,
        phone2 TEXT,
        email TEXT,
        email_norm TEXT,
        roles TEXT NOT NULL DEFAULT '',
        source TEXT,
        areas TEXT,
        min_beds INTEGER,
        max_price INTEGER,
        position TEXT,
        address TEXT,
        notes TEXT,
        owner_id TEXT REFERENCES admins(id) ON DELETE SET NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        last_contact_at TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX contacts_phone_idx ON contacts (phone_norm)`,
      `CREATE INDEX contacts_email_idx ON contacts (email_norm)`,
      `CREATE INDEX contacts_last_idx ON contacts (last_contact_at)`,
      `CREATE TABLE calls (
        id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        direction TEXT NOT NULL DEFAULT 'in',
        caller_type TEXT NOT NULL,
        property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
        notes TEXT,
        next_step TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX calls_contact_idx ON calls (contact_id, created_at)`,
      `CREATE INDEX calls_created_idx ON calls (created_at)`,
      `CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
        call_id TEXT REFERENCES calls(id) ON DELETE SET NULL,
        kind TEXT NOT NULL DEFAULT 'callback',
        title TEXT NOT NULL,
        due_at TEXT NOT NULL,
        assigned_to TEXT NOT NULL REFERENCES admins(id),
        done_at TEXT,
        done_by TEXT,
        done_note TEXT,
        notified_at TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX tasks_open_idx ON tasks (assigned_to, done_at, due_at)`,
      `CREATE INDEX tasks_contact_idx ON tasks (contact_id)`,
      `CREATE TABLE audit_log (
        id TEXT PRIMARY KEY,
        admin_id TEXT NOT NULL,
        action TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        detail TEXT,
        at TEXT NOT NULL
      )`,
      `CREATE INDEX audit_entity_idx ON audit_log (entity, entity_id, at)`,
      `ALTER TABLE enquiries ADD COLUMN contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL`,
      `ALTER TABLE appointments ADD COLUMN contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL`,
      `ALTER TABLE notifications ADD COLUMN target_admin_id TEXT`,
      `ALTER TABLE notifications ADD COLUMN task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE`,
    ],
  },
  {
    id: '005_jobs',
    sql: [
      `CREATE TABLE jobs (name TEXT PRIMARY KEY, last_run_at TEXT NOT NULL, detail TEXT)`,
    ],
  },
  {
    id: '006_enquiry_source',
    sql: [
      // Where an enquiry came from (website form, Zoopla, OnTheMarket, email), and the email's Message-ID
      // so the same email is never imported twice.
      `ALTER TABLE enquiries ADD COLUMN source TEXT NOT NULL DEFAULT 'website'`,
      `ALTER TABLE enquiries ADD COLUMN external_id TEXT`,
      `CREATE UNIQUE INDEX enquiries_external_idx ON enquiries (external_id)`,
    ],
  },
  {
    id: '007_enquiry_outcomes',
    sql: [
      // What happened with an enquiry after we followed it up, and a do-not-contact flag on the person.
      `ALTER TABLE enquiries ADD COLUMN outcome TEXT`,
      `ALTER TABLE enquiries ADD COLUMN outcome_at TEXT`,
      `ALTER TABLE enquiries ADD COLUMN outcome_by TEXT`,
      `ALTER TABLE contacts ADD COLUMN do_not_contact INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE contacts ADD COLUMN wanted_type TEXT`,
    ],
  },
  {
    id: '008_enquiry_notes',
    sql: [
      // Staff comments on an enquiry ("left a voicemail", "wants a 3-bed instead"), and a faster per-property lookup.
      `CREATE TABLE enquiry_notes (
        id TEXT PRIMARY KEY,
        enquiry_id TEXT NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX enquiry_notes_enquiry_idx ON enquiry_notes (enquiry_id, created_at)`,
      `CREATE INDEX enquiries_property_idx ON enquiries (property_id, created_at)`,
    ],
  },
  {
    id: '009_settings',
    sql: [
      // Portal-wide settings, e.g. the mailbox the portal reads new enquiries from (password stored encrypted).
      `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    ],
  },
  {
    id: '010_mail_store',
    sql: [
      // A copy of each email in the office mailbox (received and sent), grouped into conversations, so the
      // Inbox page can show the full history and what is still waiting for a reply. Deleted after 2 years.
      `CREATE TABLE mail_threads (
        id TEXT PRIMARY KEY,
        subject TEXT NOT NULL,
        norm_subject TEXT NOT NULL,
        counterpart TEXT,
        counterpart_name TEXT,
        area TEXT NOT NULL,
        kind TEXT,
        status TEXT NOT NULL,
        first_at TEXT NOT NULL,
        last_at TEXT NOT NULL,
        last_in_at TEXT,
        last_out_at TEXT,
        message_count INTEGER NOT NULL DEFAULT 0,
        done_at TEXT,
        done_by TEXT,
        contact_id TEXT
      )`,
      `CREATE INDEX mail_threads_status_idx ON mail_threads (status, last_at)`,
      `CREATE INDEX mail_threads_area_idx ON mail_threads (area, last_at)`,
      `CREATE INDEX mail_threads_match_idx ON mail_threads (norm_subject, counterpart)`,
      `CREATE TABLE mail_messages (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL UNIQUE,
        thread_id TEXT NOT NULL REFERENCES mail_threads(id) ON DELETE CASCADE,
        direction TEXT NOT NULL,
        from_addr TEXT,
        from_name TEXT,
        reply_to TEXT,
        to_addrs TEXT,
        cc_addrs TEXT,
        subject TEXT,
        sent_at TEXT NOT NULL,
        snippet TEXT,
        body TEXT,
        in_reply_to TEXT,
        refs TEXT,
        area TEXT NOT NULL,
        kind TEXT,
        promo INTEGER NOT NULL DEFAULT 0,
        needs_reply INTEGER NOT NULL DEFAULT 0,
        unsubscribe TEXT,
        unsubscribe_post INTEGER NOT NULL DEFAULT 0,
        attachments INTEGER NOT NULL DEFAULT 0,
        via TEXT,
        sent_by TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX mail_messages_thread_idx ON mail_messages (thread_id, sent_at)`,
      `CREATE INDEX mail_messages_reply_idx ON mail_messages (in_reply_to)`,
      `CREATE INDEX mail_messages_sent_idx ON mail_messages (sent_at)`,
      `CREATE INDEX mail_messages_from_idx ON mail_messages (from_addr)`,
    ],
  },
  {
    id: '011_sold_prices',
    sql: [
      // Homes sold in our area, from HM Land Registry Price Paid Data (Open Government Licence), refreshed monthly.
      `CREATE TABLE sold_prices (
        id TEXT PRIMARY KEY,
        price INTEGER NOT NULL,
        sold_on TEXT NOT NULL,
        postcode TEXT NOT NULL,
        outward TEXT NOT NULL,
        sector TEXT NOT NULL,
        type TEXT NOT NULL,
        new_build INTEGER NOT NULL DEFAULT 0,
        tenure TEXT,
        paon TEXT,
        saon TEXT,
        street TEXT,
        locality TEXT,
        town TEXT
      )`,
      `CREATE INDEX sold_prices_sector_idx ON sold_prices (sector, sold_on)`,
      `CREATE INDEX sold_prices_outward_idx ON sold_prices (outward, sold_on)`,
      `CREATE INDEX sold_prices_street_idx ON sold_prices (street, outward)`,
      `CREATE INDEX sold_prices_date_idx ON sold_prices (sold_on)`,
    ],
  },
  {
    id: '012_address_cache',
    sql: [
      // Addresses found for a postcode (valuation address finder), kept so each postcode is only paid for once.
      `CREATE TABLE address_cache (postcode TEXT PRIMARY KEY, source TEXT NOT NULL, addresses TEXT NOT NULL, fetched_at TEXT NOT NULL)`,
    ],
  },
  {
    id: '013_known_addresses',
    sql: [
      // Every address in our area that has sold since 1995 (HM Land Registry), for the valuation address finder.
      `CREATE TABLE known_addresses (postcode TEXT NOT NULL, line TEXT NOT NULL, last_year INTEGER NOT NULL, PRIMARY KEY (postcode, line))`,
    ],
  },
  {
    id: '014_postcode_geo',
    sql: [
      // Where each postcode is (OS grid, metres), from OS Code-Point Open (Open Government Licence), so sold
      // prices can be shown by real distance rather than by postcode sector.
      `CREATE TABLE postcode_geo (postcode TEXT PRIMARY KEY, e INTEGER NOT NULL, n INTEGER NOT NULL)`,
      `CREATE INDEX postcode_geo_en_idx ON postcode_geo (e, n)`,
    ],
  },
  {
    id: '015_property_emails',
    sql: [
      // People who've asked not to get property emails from us (one click in any email we send).
      `ALTER TABLE contacts ADD COLUMN marketing_opt_out INTEGER NOT NULL DEFAULT 0`,
      // Each tailored property email sent to a past applicant, so nobody gets the same listing twice.
      `CREATE TABLE property_emails (
        id TEXT PRIMARY KEY,
        property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
        email TEXT NOT NULL,
        subject TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        sent_by TEXT,
        sent_at TEXT NOT NULL
      )`,
      `CREATE INDEX property_emails_property_idx ON property_emails (property_id, contact_id)`,
    ],
  },
  {
    id: '016_campaigns',
    sql: [
      // Email campaigns to the contact list. Content is JSON (see lib/campaign.ts); each person's copy is drawn at send time.
      `CREATE TABLE campaigns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        template TEXT,
        audience TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        total INTEGER NOT NULL DEFAULT 0,
        sent INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_by TEXT,
        started_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      )`,
      `CREATE TABLE campaign_recipients (
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        contact_id TEXT NOT NULL,
        email TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        error TEXT,
        sent_at TEXT,
        PRIMARY KEY (campaign_id, contact_id)
      )`,
      `CREATE INDEX campaign_recipients_status_idx ON campaign_recipients (status, campaign_id)`,
      `CREATE INDEX campaign_recipients_sent_idx ON campaign_recipients (sent_at)`,
    ],
  },
  {
    id: '017_licensing',
    sql: [
      // Rented properties we let or manage, for tracking council licences and safety certificates.
      `CREATE TABLE rentals (
        id TEXT PRIMARY KEY,
        address TEXT NOT NULL,
        postcode TEXT,
        council TEXT,
        ward TEXT,
        ward_source TEXT,
        occupancy TEXT NOT NULL DEFAULT 'single',
        management TEXT,
        landlord_contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
        landlord_name TEXT,
        landlord_email TEXT,
        landlord_phone TEXT,
        property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
        gas_expires TEXT,
        eicr_expires TEXT,
        epc_expires TEXT,
        epc_rating TEXT,
        last_checked_at TEXT,
        last_checked_by TEXT,
        notes TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX rentals_postcode_idx ON rentals (postcode)`,
      `CREATE TABLE licences (
        id TEXT PRIMARY KEY,
        rental_id TEXT NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        council TEXT,
        number TEXT,
        holder TEXT,
        status TEXT NOT NULL DEFAULT 'granted',
        applied_on TEXT,
        starts_on TEXT,
        expires_on TEXT,
        max_occupants INTEGER,
        max_households INTEGER,
        conditions TEXT,
        notes TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX licences_rental_idx ON licences (rental_id)`,
      // Council licensing schemes (selective, additional HMO) and the wards they cover. Seeded, editable by staff.
      `CREATE TABLE licensing_schemes (
        id TEXT PRIMARY KEY,
        council TEXT NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        wards TEXT NOT NULL,
        starts_on TEXT NOT NULL,
        ends_on TEXT NOT NULL,
        source_url TEXT,
        checked_on TEXT,
        notes TEXT,
        updated_at TEXT NOT NULL
      )`,
      // Reminders already sent, so each one goes once.
      `CREATE TABLE licence_reminders (rental_id TEXT NOT NULL, key TEXT NOT NULL, sent_at TEXT NOT NULL, PRIMARY KEY (rental_id, key))`,
      // Council and ward for each postcode, from postcodes.io (ONS data, Open Government Licence).
      `CREATE TABLE postcode_wards (postcode TEXT PRIMARY KEY, district TEXT, district_code TEXT, ward TEXT, ward_code TEXT, fetched_at TEXT NOT NULL)`,
    ],
  },
  {
    id: '018_licence_scan',
    sql: [
      // Emails in the mailbox that look like licences or safety certificates, waiting to be read.
      `CREATE TABLE scan_queue (folder TEXT NOT NULL, uid INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'queued', PRIMARY KEY (folder, uid))`,
      // What was read from each one, kept so new properties can be matched later without reading the mailbox again.
      `CREATE TABLE email_docs (
        id TEXT PRIMARY KEY,
        folder TEXT NOT NULL,
        uid INTEGER NOT NULL,
        message_id TEXT,
        subject TEXT,
        from_addr TEXT,
        sent_at TEXT,
        kinds TEXT NOT NULL,
        files TEXT,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE UNIQUE INDEX email_docs_msg_idx ON email_docs (folder, uid)`,
      // Details found for a property, for staff to accept or dismiss.
      `CREATE TABLE licence_suggestions (
        id TEXT PRIMARY KEY,
        rental_id TEXT NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
        doc_id TEXT NOT NULL REFERENCES email_docs(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        found TEXT NOT NULL,
        confidence TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'new',
        decided_by TEXT,
        decided_at TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE UNIQUE INDEX licence_suggestions_uniq ON licence_suggestions (rental_id, doc_id, kind)`,
    ],
  },
  {
    id: '019_email_files',
    sql: [
      // PDFs (licences, gas safety records, EICRs, EPCs) saved from the mailbox, so they open straight from the portal.
      `CREATE TABLE email_files (id TEXT PRIMARY KEY, doc_id TEXT NOT NULL REFERENCES email_docs(id) ON DELETE CASCADE, filename TEXT NOT NULL, storage_key TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL)`,
      `CREATE INDEX email_files_doc_idx ON email_files (doc_id)`,
    ],
  },
  {
    id: '020_no_licence_needed',
    sql: [
      // Staff (or the imported spreadsheet) have confirmed this property doesn't need a licence, e.g. an exemption.
      `ALTER TABLE rentals ADD COLUMN no_licence_needed INTEGER NOT NULL DEFAULT 0`,
    ],
  },
  {
    id: '021_postcodes_and_registers',
    sql: [
      // How a rental's postcode was found: from the spreadsheet, the Land Registry list or a map look-up.
      `ALTER TABLE rentals ADD COLUMN postcode_source TEXT`,
      `ALTER TABLE rentals ADD COLUMN postcode_note TEXT`,
      `ALTER TABLE rentals ADD COLUMN postcode_tried_at TEXT`,
      // Councils' published licence registers, downloaded and checked against our properties.
      `CREATE TABLE council_registers (
        id TEXT PRIMARY KEY,
        council TEXT NOT NULL,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        page_url TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_fetched_at TEXT,
        last_ok_at TEXT,
        last_error TEXT,
        as_of TEXT,
        entries INTEGER,
        file_key TEXT,
        doc_id TEXT,
        updated_at TEXT NOT NULL
      )`,
      // What each register says about each of our properties, from the latest download.
      `CREATE TABLE register_hits (
        rental_id TEXT NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
        register_id TEXT NOT NULL REFERENCES council_registers(id) ON DELETE CASCADE,
        found INTEGER NOT NULL,
        reference TEXT,
        kind TEXT,
        starts_on TEXT,
        expires_on TEXT,
        line TEXT,
        checked_at TEXT NOT NULL,
        PRIMARY KEY (rental_id, register_id)
      )`,
    ],
  },
  {
    id: '022_resolved_address',
    sql: [
      // The full address worked out from a shortened or misspelt one ("82 Mountsteward" → "82 Mount Stewart Avenue"),
      // used to match council registers and emails. The address as typed is kept as it is.
      `ALTER TABLE rentals ADD COLUMN resolved_address TEXT`,
    ],
  },
  {
    id: '023_address_keys',
    sql: [
      // A compact look-up for matching typed addresses to postcodes, built from known_addresses, so the whole
      // address list never has to be held in memory. kind: 'num' (house number), 'st' (street), 'bld' (building).
      `CREATE TABLE address_keys (kind TEXT NOT NULL, k TEXT NOT NULL, street TEXT NOT NULL, flat TEXT, pc TEXT NOT NULL)`,
      `CREATE INDEX address_keys_idx ON address_keys (kind, k)`,
    ],
  },
  {
    id: '024_epc_and_autofill',
    sql: [
      // The EPC found on GOV.UK for each rental, and when it was last looked up.
      `ALTER TABLE rentals ADD COLUMN epc_ref TEXT`,
      `ALTER TABLE rentals ADD COLUMN epc_checked_at TEXT`,
      // What a suggestion replaced when it was filled in automatically, so it can be undone.
      `ALTER TABLE licence_suggestions ADD COLUMN prev TEXT`,
    ],
  },
  {
    id: '025_rentman_list',
    sql: [
      // Rentman is the master list of properties: its reference, landlord number, rent and whether it's archived
      // there. sheet_address is how the property was written on the licensing spreadsheet, kept for matching.
      `ALTER TABLE rentals ADD COLUMN rentman_ref TEXT`,
      `ALTER TABLE rentals ADD COLUMN landlord_ref TEXT`,
      `ALTER TABLE rentals ADD COLUMN rent_pcm INTEGER`,
      `ALTER TABLE rentals ADD COLUMN rentman_archived INTEGER`,
      `ALTER TABLE rentals ADD COLUMN sheet_address TEXT`,
      `CREATE INDEX rentals_rentman_ref ON rentals (rentman_ref)`,
    ],
  },
  {
    id: '026_sheet_councils_follow_postcode',
    sql: [
      // Councils typed on a licensing spreadsheet outside Brent and Harrow were kept as if chosen by hand, so the
      // postcode look-up never corrected them ("heringe", "heartsmere") or found the ward. Let the postcode decide.
      `UPDATE rentals SET ward_source = 'auto' WHERE ward_source = 'manual' AND ward IS NULL AND postcode IS NOT NULL AND council NOT IN ('brent', 'harrow')`,
    ],
  },
  {
    id: '027_remove_licensing',
    sql: [
      // The licensing section was removed (November 2026): its tables and leftovers go with it.
      `DROP TABLE IF EXISTS register_hits`,
      `DROP TABLE IF EXISTS licence_suggestions`,
      `DROP TABLE IF EXISTS email_files`,
      `DROP TABLE IF EXISTS email_docs`,
      `DROP TABLE IF EXISTS scan_queue`,
      `DROP TABLE IF EXISTS council_registers`,
      `DROP TABLE IF EXISTS licence_reminders`,
      `DROP TABLE IF EXISTS licences`,
      `DROP TABLE IF EXISTS licensing_schemes`,
      `DROP TABLE IF EXISTS rentals`,
      `DROP TABLE IF EXISTS postcode_wards`,
      `DROP TABLE IF EXISTS address_keys`,
      `DELETE FROM notifications WHERE kind = 'licence'`,
      `DELETE FROM jobs WHERE name IN ('licensing', 'epc', 'council_registers', 'licence_scan')`,
      `DELETE FROM settings WHERE key LIKE 'licensing_%' OR key IN ('licence_scan', 'address_keys', 'schemes_seeded')`,
    ],
  },
  {
    id: '028_tenant_alerts',
    sql: [
      // Tenants who registered what they're looking for. New lets that match are emailed to them automatically.
      `CREATE TABLE tenant_alerts (
        contact_id TEXT PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
        max_rent INTEGER, min_beds INTEGER, areas TEXT, move_by TEXT, pets INTEGER NOT NULL DEFAULT 0, furnishing TEXT, notes TEXT,
        active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_sent_at TEXT
      )`,
    ],
  },
  {
    id: '029_reviews',
    sql: [
      // Real client reviews (copied from Google), shown on the sales and lettings pages. Only 4 and 5 stars are shown.
      `CREATE TABLE reviews (
        id TEXT PRIMARY KEY, author TEXT NOT NULL, rating INTEGER NOT NULL, text TEXT NOT NULL, reviewed_on TEXT,
        category TEXT NOT NULL DEFAULT 'general', source TEXT NOT NULL DEFAULT 'google', shown INTEGER NOT NULL DEFAULT 1,
        created_by TEXT, created_at TEXT NOT NULL
      )`,
    ],
  },
  {
    id: '030_google_reviews_1',
    // From screenshots of the Google Business Profile, Nov 2026. "…" marks where Google cut a long review short.
    sql: seedReviews('g1', [
      ['Mitesh Patel', 5, '2024-11-06', 'lettings', 'Fantastic service from Preston Hill estates that genuinely care and help. As a landlord I did not understand the new license rules and Fred helped me unconditionally. I have been working with Fred now for some time and always receive great service.'],
      ['ali Ali', 5, '2023-10-11', 'lettings', 'Honestly couldnt have asked for a better service, i iust came to get my contract renewed they have always helped me get a good deal. Ive stayed in the property for 4 years and have had no issues! Couldnt have asked for a better real estate company'],
      ['Kam Patel', 5, '2024-11-06', 'general', '"I can\'t recommend Preston Hill Estates (Fred) highly enough! From the moment I contacted them, their team always go…'],
      ['sanila fernandes', 5, '2024-11-06', 'general', 'Recently moved to new property, Haque and Fred are very helpful who work in Preston hill agency, I would highly…'],
      ['Ahmed Fraz', 5, '2024-11-06', 'general', 'Very helpful finding a home, friedly and professionally'],
      ['Persida Matei', 5, '2024-11-12', 'general', 'Great team, always there to help when needed!'],
      ['Thao Le', 5, '2024-11-09', 'lettings', 'Since knowing Preston Hills Estates, I have had no problems. Landlord was also super helpful and staff who came to fix…'],
      ['JIJO Chukkath', 5, '2024-12-19', 'general', 'Very professional team 👏'],
      ['Henna Hanif', 5, '2024-12-01', 'sales', 'Great service we used Preston Hill Estates to sell our property from start to finish they were very professional, worked to a timely manner and kept us feeling reassured at all times. Definitely recommend 👌'],
    ]),
  },
  {
    id: '031_enquiry_side',
    sql: [
      // Sales or lettings, when staff have set it by hand (otherwise it's worked out from the property and the message).
      `ALTER TABLE enquiries ADD COLUMN side TEXT`,
    ],
  },
  {
    id: '032_enquiry_sorting',
    sql: [
      // Sales or lettings read from the original email in the background, with the reason, for enquiries whose
      // saved summary doesn't say.
      `ALTER TABLE enquiries ADD COLUMN auto_side TEXT`,
      `ALTER TABLE enquiries ADD COLUMN side_why TEXT`,
      `ALTER TABLE enquiries ADD COLUMN side_checked_at TEXT`,
      // Zoopla and OnTheMarket account emails (one-time sign-in codes, password resets) were saved as enquiries.
      `DELETE FROM enquiries WHERE kind = 'email' AND source IN ('zoopla', 'onthemarket') AND (
        lower(message) LIKE '%verification code%' OR lower(message) LIKE '%one-time%code%' OR lower(message) LIKE '%one time%code%'
        OR lower(message) LIKE '%passcode%' OR lower(message) LIKE '%reset your password%' OR lower(message) LIKE '%password reset%')`,
      // The "Unknown" people those emails created (Zoopla's own phone number), now with nothing left: archived.
      `UPDATE contacts SET archived = 1 WHERE name = 'Unknown' AND NOT EXISTS (SELECT 1 FROM enquiries WHERE enquiries.contact_id = contacts.id)
        AND (phone IS NULL OR replace(phone, ' ', '') LIKE '%35441000')`,
    ],
  },
  {
    id: '033_enquiry_sorting_more',
    sql: [
      // Look again at enquiries still unsorted: now also by address (our listings) and the person's other enquiries.
      `UPDATE enquiries SET side_checked_at = NULL WHERE side IS NULL AND auto_side IS NULL`,
    ],
  },
  {
    id: '034_remove_portal_account_emails',
    sql: [
      // Zoopla / OnTheMarket / website account emails saved as enquiries before the import learned to skip them:
      // ZooplaPro "access from a new device" logins, password and security emails, and anything else with no
      // person in it (no name, no email of theirs) and none of a real lead's details. Left alone if staff have
      // recorded anything against it.
      `DELETE FROM enquiries WHERE kind = 'email' AND source IN ('zoopla', 'onthemarket', 'website')
        AND outcome IS NULL
        AND NOT EXISTS (SELECT 1 FROM enquiry_notes n WHERE n.enquiry_id = enquiries.id)
        AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.enquiry_id = enquiries.id)
        AND coalesce(message, '') NOT LIKE '%Type of enquiry:%' AND coalesce(message, '') NOT LIKE '%Zoopla reference:%'
        AND coalesce(message, '') NOT LIKE '%Wants:%' AND coalesce(message, '') NOT LIKE '%Listing:%' AND coalesce(message, '') NOT LIKE '%Situation:%'
        AND (
          (trim(name) IN ('Unknown', '') AND (email IS NULL OR email LIKE '%zoopla%' OR email LIKE '%onthemarket%' OR email LIKE '%wix%'))
          OR lower(coalesce(message, '')) LIKE '%zooplapro%' OR lower(coalesce(message, '')) LIKE '%login attempt%'
          OR lower(coalesce(message, '')) LIKE '%verify-device%' OR lower(coalesce(message, '')) LIKE '%new browser%'
          OR lower(coalesce(message, '')) LIKE '%member services%' OR lower(coalesce(message, '')) LIKE '%reset your password%'
        )`,
      // The empty "Unknown" people those emails created.
      `UPDATE contacts SET archived = 1 WHERE name = 'Unknown' AND NOT EXISTS (SELECT 1 FROM enquiries WHERE enquiries.contact_id = contacts.id)`,
    ],
  },
  {
    id: '035_valuation_check',
    sql: [
      // The valuation check on a valuation enquiry: comparables staff found and the figure they settled on (JSON).
      `ALTER TABLE enquiries ADD COLUMN valuation TEXT`,
    ],
  },
  {
    id: '036_enquiry_messages',
    sql: [
      // The email conversation on an enquiry: what we sent and what they replied, linked by the emails' own IDs.
      `CREATE TABLE enquiry_messages (
        id TEXT PRIMARY KEY,
        enquiry_id TEXT NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
        message_id TEXT,
        direction TEXT NOT NULL,
        subject TEXT,
        body TEXT,
        from_addr TEXT,
        via TEXT,
        sent_by TEXT,
        sent_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX enquiry_messages_enquiry_idx ON enquiry_messages (enquiry_id, sent_at)`,
      `CREATE UNIQUE INDEX enquiry_messages_message_idx ON enquiry_messages (message_id) WHERE message_id IS NOT NULL`,
      // When they last replied (shown as "Replied" until someone deals with it).
      `ALTER TABLE enquiries ADD COLUMN last_reply_at TEXT`,
    ],
  },
  {
    id: '037_booklets',
    sql: [
      // What staff changed on a valuation booklet (only the changes: everything else is filled in fresh each time).
      // The id is the enquiry's id, or "a-" and the appointment's id for a valuation booked without an enquiry.
      `CREATE TABLE booklets (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_by TEXT,
        updated_at TEXT NOT NULL
      )`,
    ],
  },
  {
    id: '038_lookup_cache',
    sql: [
      // Answers from outside services (places near a postcode, a home's sale history, its energy certificates),
      // kept for a while so a booklet opens quickly and those services are asked rarely.
      `CREATE TABLE lookup_cache (
        key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      )`,
    ],
  },
  {
    id: '039_area_places',
    sql: [
      // Our own copy of schools, supermarkets, parks, GPs, pharmacies, gyms and stations across the patch (from
      // OpenStreetMap), filled in the background square by square, so booklets don't wait on a public server.
      `CREATE TABLE area_places (
        id TEXT PRIMARY KEY,
        square TEXT NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        tags TEXT
      )`,
      `CREATE INDEX area_places_pos_idx ON area_places (lat, lon)`,
      `CREATE INDEX area_places_square_idx ON area_places (square)`,
    ],
  },
  {
    id: '040_booklet_shares',
    sql: [
      // A private link to a valuation booklet, for the person it's for (sent in the "property report" email), and
      // when they opened it.
      `CREATE TABLE booklet_shares (
        token TEXT PRIMARY KEY,
        booklet_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        views INTEGER NOT NULL DEFAULT 0,
        first_view_at TEXT,
        last_view_at TEXT
      )`,
      `CREATE UNIQUE INDEX booklet_shares_booklet_idx ON booklet_shares (booklet_id)`,
    ],
  },
  {
    id: '041_tailored_emails',
    sql: [
      // One-off emails staff write and address themselves (another agent, an investor, a solicitor), with pictures.
      `CREATE TABLE tailored_emails (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        template TEXT,
        recipients TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        sent INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        results TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sent_at TEXT
      )`,
      // Pictures added to those emails, served publicly at /email-img/<id> so they show in people's inboxes.
      `CREATE TABLE email_images (
        id TEXT PRIMARY KEY,
        storage_key TEXT NOT NULL,
        content_type TEXT NOT NULL,
        width INTEGER,
        height INTEGER,
        size_bytes INTEGER,
        original_name TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL
      )`,
    ],
  },
]
