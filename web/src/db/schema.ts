import { sqliteTable, text, integer, real, index, primaryKey } from 'drizzle-orm/sqlite-core'

export const admins = sqliteTable('admins', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('admin'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  phone: text('phone'),
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
  contactId: text('contact_id'),
  source: text('source').notNull().default('website'),
  externalId: text('external_id'),
  outcome: text('outcome'),
  outcomeAt: text('outcome_at'),
  outcomeBy: text('outcome_by'),
  createdAt: text('created_at').notNull(),
})

export const enquiryNotes = sqliteTable(
  'enquiry_notes',
  {
    id: text('id').primaryKey(),
    enquiryId: text('enquiry_id').notNull().references(() => enquiries.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('enquiry_notes_enquiry_idx').on(t.enquiryId, t.createdAt)],
)

export const appointments = sqliteTable(
  'appointments',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull().default('viewing'),
    propertyId: text('property_id').references(() => properties.id, { onDelete: 'set null' }),
    address: text('address'),
    startsAt: text('starts_at').notNull(),
    durationMin: integer('duration_min').notNull().default(30),
    staffId: text('staff_id').notNull().references(() => admins.id),
    contactName: text('contact_name'),
    contactPhone: text('contact_phone'),
    contactEmail: text('contact_email'),
    notes: text('notes'),
    status: text('status').notNull().default('scheduled'),
    reminderMin: integer('reminder_min').notNull().default(30),
    remindedAt: text('reminded_at'),
    cancelReason: text('cancel_reason'),
    outcome: text('outcome'),
    outcomeInterest: text('outcome_interest'),
    outcomeNotes: text('outcome_notes'),
    outcomeNext: text('outcome_next'),
    outcomeAt: text('outcome_at'),
    outcomeBy: text('outcome_by'),
    enquiryId: text('enquiry_id').references(() => enquiries.id, { onDelete: 'set null' }),
    contactId: text('contact_id'),
    createdBy: text('created_by'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('appointments_start_idx').on(t.startsAt), index('appointments_staff_idx').on(t.staffId, t.status)],
)

export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  appointmentId: text('appointment_id').references(() => appointments.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body'),
  createdBy: text('created_by'),
  createdAt: text('created_at').notNull(),
  targetAdminId: text('target_admin_id'),
  taskId: text('task_id'),
})

export const notificationReads = sqliteTable('notification_reads', {
  notificationId: text('notification_id').notNull(),
  adminId: text('admin_id').notNull(),
  readAt: text('read_at').notNull(),
})

export const emailLog = sqliteTable('email_log', {
  id: text('id').primaryKey(),
  toAddr: text('to_addr').notNull(),
  subject: text('subject').notNull(),
  status: text('status').notNull(),
  error: text('error'),
  appointmentId: text('appointment_id'),
  createdAt: text('created_at').notNull(),
})

export const contacts = sqliteTable(
  'contacts',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    phone: text('phone'),
    phoneNorm: text('phone_norm'),
    phone2: text('phone2'),
    email: text('email'),
    emailNorm: text('email_norm'),
    roles: text('roles').notNull().default(''),
    source: text('source'),
    areas: text('areas'),
    minBeds: integer('min_beds'),
    maxPrice: integer('max_price'),
    position: text('position'),
    address: text('address'),
    notes: text('notes'),
    ownerId: text('owner_id').references(() => admins.id, { onDelete: 'set null' }),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    doNotContact: integer('do_not_contact', { mode: 'boolean' }).notNull().default(false),
    marketingOptOut: integer('marketing_opt_out', { mode: 'boolean' }).notNull().default(false),
    wantedType: text('wanted_type'),
    lastContactAt: text('last_contact_at'),
    createdBy: text('created_by'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('contacts_phone_idx').on(t.phoneNorm), index('contacts_email_idx').on(t.emailNorm), index('contacts_last_idx').on(t.lastContactAt)],
)

export const propertyEmails = sqliteTable(
  'property_emails',
  {
    id: text('id').primaryKey(),
    propertyId: text('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
    contactId: text('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    email: text('email').notNull(),
    subject: text('subject').notNull(),
    status: text('status').notNull(),
    error: text('error'),
    sentBy: text('sent_by'),
    sentAt: text('sent_at').notNull(),
  },
  (t) => [index('property_emails_property_idx').on(t.propertyId, t.contactId)],
)

export const campaigns = sqliteTable('campaigns', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  template: text('template'),
  audience: text('audience').notNull(),
  content: text('content').notNull(),
  status: text('status').notNull().default('draft'), // draft, sending, paused, sent, cancelled
  total: integer('total').notNull().default(0),
  sent: integer('sent').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  lastError: text('last_error'),
  createdBy: text('created_by'),
  startedBy: text('started_by'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
})
export type Campaign = typeof campaigns.$inferSelect

export const campaignRecipients = sqliteTable(
  'campaign_recipients',
  {
    campaignId: text('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
    contactId: text('contact_id').notNull(),
    email: text('email').notNull(),
    status: text('status').notNull().default('queued'), // queued, sent, failed, skipped
    error: text('error'),
    sentAt: text('sent_at'),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.contactId] }), index('campaign_recipients_status_idx').on(t.status, t.campaignId)],
)

export const rentals = sqliteTable('rentals', {
  id: text('id').primaryKey(),
  address: text('address').notNull(),
  postcode: text('postcode'),
  council: text('council'),
  ward: text('ward'),
  wardSource: text('ward_source'),
  occupancy: text('occupancy').notNull().default('single'),
  management: text('management'),
  landlordContactId: text('landlord_contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  landlordName: text('landlord_name'),
  landlordEmail: text('landlord_email'),
  landlordPhone: text('landlord_phone'),
  propertyId: text('property_id').references(() => properties.id, { onDelete: 'set null' }),
  gasExpires: text('gas_expires'),
  eicrExpires: text('eicr_expires'),
  epcExpires: text('epc_expires'),
  epcRating: text('epc_rating'),
  lastCheckedAt: text('last_checked_at'),
  lastCheckedBy: text('last_checked_by'),
  noLicenceNeeded: integer('no_licence_needed', { mode: 'boolean' }).notNull().default(false),
  notes: text('notes'),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdBy: text('created_by'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})
export type Rental = typeof rentals.$inferSelect

export const licences = sqliteTable('licences', {
  id: text('id').primaryKey(),
  rentalId: text('rental_id').notNull().references(() => rentals.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  council: text('council'),
  number: text('number'),
  holder: text('holder'),
  status: text('status').notNull().default('granted'),
  appliedOn: text('applied_on'),
  startsOn: text('starts_on'),
  expiresOn: text('expires_on'),
  maxOccupants: integer('max_occupants'),
  maxHouseholds: integer('max_households'),
  conditions: text('conditions'),
  notes: text('notes'),
  createdBy: text('created_by'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})
export type LicenceRow = typeof licences.$inferSelect

export const licensingSchemes = sqliteTable('licensing_schemes', {
  id: text('id').primaryKey(),
  council: text('council').notNull(),
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  wards: text('wards').notNull(),
  startsOn: text('starts_on').notNull(),
  endsOn: text('ends_on').notNull(),
  sourceUrl: text('source_url'),
  checkedOn: text('checked_on'),
  notes: text('notes'),
  updatedAt: text('updated_at').notNull(),
})

export const licenceReminders = sqliteTable('licence_reminders', {
  rentalId: text('rental_id').notNull(),
  key: text('key').notNull(),
  sentAt: text('sent_at').notNull(),
}, (t) => [primaryKey({ columns: [t.rentalId, t.key] })])

export const postcodeWards = sqliteTable('postcode_wards', {
  postcode: text('postcode').primaryKey(),
  district: text('district'),
  districtCode: text('district_code'),
  ward: text('ward'),
  wardCode: text('ward_code'),
  fetchedAt: text('fetched_at').notNull(),
})

export const scanQueue = sqliteTable('scan_queue', {
  folder: text('folder').notNull(),
  uid: integer('uid').notNull(),
  status: text('status').notNull().default('queued'),
}, (t) => [primaryKey({ columns: [t.folder, t.uid] })])

export const emailDocs = sqliteTable('email_docs', {
  id: text('id').primaryKey(),
  folder: text('folder').notNull(),
  uid: integer('uid').notNull(),
  messageId: text('message_id'),
  subject: text('subject'),
  fromAddr: text('from_addr'),
  sentAt: text('sent_at'),
  kinds: text('kinds').notNull(),
  files: text('files'),
  text: text('text').notNull(),
  createdAt: text('created_at').notNull(),
})
export type EmailDoc = typeof emailDocs.$inferSelect

export const emailFiles = sqliteTable('email_files', {
  id: text('id').primaryKey(),
  docId: text('doc_id').notNull().references(() => emailDocs.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  storageKey: text('storage_key').notNull(),
  size: integer('size').notNull(),
  createdAt: text('created_at').notNull(),
})

export const licenceSuggestions = sqliteTable('licence_suggestions', {
  id: text('id').primaryKey(),
  rentalId: text('rental_id').notNull().references(() => rentals.id, { onDelete: 'cascade' }),
  docId: text('doc_id').notNull().references(() => emailDocs.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  found: text('found').notNull(),
  confidence: text('confidence').notNull(),
  status: text('status').notNull().default('new'),
  decidedBy: text('decided_by'),
  decidedAt: text('decided_at'),
  createdAt: text('created_at').notNull(),
})

export const calls = sqliteTable(
  'calls',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
    direction: text('direction').notNull().default('in'),
    callerType: text('caller_type').notNull(),
    propertyId: text('property_id').references(() => properties.id, { onDelete: 'set null' }),
    notes: text('notes'),
    nextStep: text('next_step').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('calls_contact_idx').on(t.contactId, t.createdAt), index('calls_created_idx').on(t.createdAt)],
)

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
    callId: text('call_id').references(() => calls.id, { onDelete: 'set null' }),
    kind: text('kind').notNull().default('callback'),
    title: text('title').notNull(),
    dueAt: text('due_at').notNull(),
    assignedTo: text('assigned_to').notNull().references(() => admins.id),
    doneAt: text('done_at'),
    doneBy: text('done_by'),
    doneNote: text('done_note'),
    notifiedAt: text('notified_at'),
    createdBy: text('created_by'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('tasks_open_idx').on(t.assignedTo, t.doneAt, t.dueAt), index('tasks_contact_idx').on(t.contactId)],
)

export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  adminId: text('admin_id').notNull(),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id').notNull(),
  detail: text('detail'),
  at: text('at').notNull(),
})

export const jobs = sqliteTable('jobs', {
  name: text('name').primaryKey(),
  lastRunAt: text('last_run_at').notNull(),
  detail: text('detail'),
})

export type Contact = typeof contacts.$inferSelect
export type Call = typeof calls.$inferSelect
export type Task = typeof tasks.$inferSelect
export type Admin = typeof admins.$inferSelect
export type Appointment = typeof appointments.$inferSelect
export type Property = typeof properties.$inferSelect
export type Media = typeof media.$inferSelect
export type Room = typeof rooms.$inferSelect
export type Enquiry = typeof enquiries.$inferSelect

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const mailThreads = sqliteTable('mail_threads', {
  id: text('id').primaryKey(),
  subject: text('subject').notNull(),
  normSubject: text('norm_subject').notNull(),
  counterpart: text('counterpart'),
  counterpartName: text('counterpart_name'),
  area: text('area').notNull(),
  kind: text('kind'),
  /** pending (waiting for our reply) · replied · done (marked dealt with) · info (no reply expected) · promo */
  status: text('status').notNull(),
  firstAt: text('first_at').notNull(),
  lastAt: text('last_at').notNull(),
  lastInAt: text('last_in_at'),
  lastOutAt: text('last_out_at'),
  messageCount: integer('message_count').notNull().default(0),
  doneAt: text('done_at'),
  doneBy: text('done_by'),
  contactId: text('contact_id'),
})

export const mailMessages = sqliteTable('mail_messages', {
  id: text('id').primaryKey(),
  messageId: text('message_id').notNull().unique(),
  threadId: text('thread_id').notNull().references(() => mailThreads.id, { onDelete: 'cascade' }),
  direction: text('direction').notNull(), // in | out
  fromAddr: text('from_addr'),
  fromName: text('from_name'),
  replyTo: text('reply_to'),
  toAddrs: text('to_addrs'),
  ccAddrs: text('cc_addrs'),
  subject: text('subject'),
  sentAt: text('sent_at').notNull(),
  snippet: text('snippet'),
  body: text('body'),
  inReplyTo: text('in_reply_to'),
  refs: text('refs'),
  area: text('area').notNull(),
  kind: text('kind'),
  promo: integer('promo', { mode: 'boolean' }).notNull().default(false),
  needsReply: integer('needs_reply', { mode: 'boolean' }).notNull().default(false),
  unsubscribe: text('unsubscribe'),
  unsubscribePost: integer('unsubscribe_post', { mode: 'boolean' }).notNull().default(false),
  attachments: integer('attachments').notNull().default(0),
  via: text('via'), // portal | mailbox
  sentBy: text('sent_by'),
  createdAt: text('created_at').notNull(),
})

export type MailThread = typeof mailThreads.$inferSelect
export type MailMessage = typeof mailMessages.$inferSelect

export const soldPrices = sqliteTable('sold_prices', {
  id: text('id').primaryKey(),
  price: integer('price').notNull(),
  soldOn: text('sold_on').notNull(), // YYYY-MM-DD
  postcode: text('postcode').notNull(),
  outward: text('outward').notNull(), // HA3
  sector: text('sector').notNull(), // HA3 0
  type: text('type').notNull(), // D detached, S semi, T terraced, F flat
  newBuild: integer('new_build', { mode: 'boolean' }).notNull().default(false),
  tenure: text('tenure'), // F freehold, L leasehold
  paon: text('paon'),
  saon: text('saon'),
  street: text('street'),
  locality: text('locality'),
  town: text('town'),
})
export type SoldPrice = typeof soldPrices.$inferSelect

export const addressCache = sqliteTable('address_cache', {
  postcode: text('postcode').primaryKey(),
  source: text('source').notNull(), // paf (Royal Mail, via Ideal Postcodes) | land-registry
  addresses: text('addresses').notNull(), // JSON array of address lines (without the postcode)
  fetchedAt: text('fetched_at').notNull(),
})

export const knownAddresses = sqliteTable('known_addresses', {
  postcode: text('postcode').notNull(),
  line: text('line').notNull(),
  lastYear: integer('last_year').notNull(),
}, (t) => [primaryKey({ columns: [t.postcode, t.line] })])

export const postcodeGeo = sqliteTable('postcode_geo', {
  postcode: text('postcode').primaryKey(),
  e: integer('e').notNull(), // OS grid easting, metres
  n: integer('n').notNull(), // OS grid northing, metres
})
