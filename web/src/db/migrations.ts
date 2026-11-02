// Each entry runs once, in order; applied ids are recorded in _migrations.
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
]
