import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core'

export const admins = sqliteTable('admins', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('admin'),
  createdAt: text('created_at').notNull(),
  lastLoginAt: text('last_login_at'),
})

export const properties = sqliteTable(
  'properties',
  {
    id: text('id').primaryKey(),
    ref: text('ref').notNull().unique(),
    channel: text('channel').notNull().default('sale'),
    status: text('status').notNull().default('available'),
    published: integer('published', { mode: 'boolean' }).notNull().default(false),
    featured: integer('featured', { mode: 'boolean' }).notNull().default(false),
    headline: text('headline'),

    addressLine1: text('address_line1'),
    street: text('street'),
    locality: text('locality'),
    town: text('town'),
    postcode: text('postcode'),
    displayAddress: text('display_address'),
    latitude: real('latitude'),
    longitude: real('longitude'),

    price: integer('price'),
    priceQualifier: text('price_qualifier'),
    rentFrequency: text('rent_frequency'),
    deposit: integer('deposit'),
    availableFrom: text('available_from'),
    furnishing: text('furnishing'),
    letType: text('let_type'),
    minTenancyMonths: integer('min_tenancy_months'),

    propertyType: text('property_type'),
    newBuild: integer('new_build', { mode: 'boolean' }).notNull().default(false),
    tenure: text('tenure'),
    leaseYearsRemaining: integer('lease_years_remaining'),
    groundRent: integer('ground_rent'),
    serviceCharge: integer('service_charge'),
    sharedOwnership: integer('shared_ownership', { mode: 'boolean' }).notNull().default(false),

    bedrooms: integer('bedrooms'),
    bathrooms: integer('bathrooms'),
    receptions: integer('receptions'),
    floorAreaSqft: integer('floor_area_sqft'),

    councilTaxBand: text('council_tax_band'),
    epcCurrent: text('epc_current'),
    epcPotential: text('epc_potential'),

    parking: text('parking'),
    outsideSpace: text('outside_space'),
    heating: text('heating'),
    electricity: text('electricity'),
    water: text('water'),
    sewerage: text('sewerage'),
    broadband: text('broadband'),
    mobileSignal: text('mobile_signal'),
    construction: text('construction'),
    buildingSafety: text('building_safety'),
    restrictions: text('restrictions'),
    rightsEasements: text('rights_easements'),
    floodRisk: text('flood_risk'),
    planning: text('planning'),
    accessibility: text('accessibility'),

    summary: text('summary'),
    description: text('description'),
    keyFeatures: text('key_features', { mode: 'json' }).$type<string[]>(),

    videoUrl: text('video_url'),
    virtualTourUrl: text('virtual_tour_url'),

    negotiator: text('negotiator'),
    internalNotes: text('internal_notes'),

    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    publishedAt: text('published_at'),
    updatedBy: text('updated_by'),
  },
  (t) => [index('properties_published_idx').on(t.published, t.channel)],
)

export const rooms = sqliteTable(
  'rooms',
  {
    id: text('id').primaryKey(),
    propertyId: text('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    name: text('name').notNull(),
    dimensions: text('dimensions'),
    description: text('description'),
  },
  (t) => [index('rooms_property_idx').on(t.propertyId)],
)

export const media = sqliteTable(
  'media',
  {
    id: text('id').primaryKey(),
    propertyId: text('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    storageKey: text('storage_key').notNull(),
    originalName: text('original_name'),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes'),
    caption: text('caption'),
    position: integer('position').notNull().default(0),
    isCover: integer('is_cover', { mode: 'boolean' }).notNull().default(false),
    status: text('status').notNull().default('pending'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('media_property_idx').on(t.propertyId, t.kind)],
)

export const enquiries = sqliteTable('enquiries', {
  id: text('id').primaryKey(),
  propertyId: text('property_id').references(() => properties.id, { onDelete: 'set null' }),
  kind: text('kind').notNull().default('viewing'),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  message: text('message'),
  postcode: text('postcode'),
  intent: text('intent'),
  handled: integer('handled', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
})

export type Property = typeof properties.$inferSelect
export type Media = typeof media.$inferSelect
export type Room = typeof rooms.$inferSelect
export type Enquiry = typeof enquiries.$inferSelect
