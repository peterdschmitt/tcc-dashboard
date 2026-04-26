// src/lib/ghl/sales-mapping.js
//
// Maps Sales Tracker columns to GHL contact custom fields. Used by both
// the Call Log sync's enrichment pass (when a row's phone matches a
// sales record) and the standalone Sales Tracker sync (Phase C).
//
// Pattern matches field-mapping.js: each entry is [internalName, displayName].
// Bootstrap script creates GHL fields named with the displayName; client.js
// resolves internalName → displayName → GHL field ID at runtime.

/**
 * Policy custom fields. These extend ALL_CUSTOM_FIELDS in field-mapping.js
 * so the bootstrap script creates them in GHL alongside the call-log fields.
 */
export const POLICY_FIELDS = [
  // Application + Identity
  ['policyNumber',           'Policy #'],
  ['carrierPolicyNumber',    'Carrier Policy #'],
  ['carrierProductPayout',   'Carrier + Product + Payout'],
  ['applicationSubmittedDate', 'Application Submitted Date'],
  ['effectiveDate',          'Effective Date'],

  // Premium / Coverage
  ['monthlyPremium',         'Monthly Premium'],
  ['originalPremium',        'Original Premium'],
  ['faceAmount',             'Face Amount'],
  ['termLength',             'Term Length'],

  // Status (the lifecycle fields that change post-submission)
  ['placedStatus',           'Placed Status'],
  ['originalPlacedStatus',   'Original Placed Status'],
  ['carrierStatus',          'Carrier Status'],
  ['carrierStatusDate',      'Carrier Status Date'],
  ['lastCarrierSyncDate',    'Last Carrier Sync Date'],
  ['outcomeAtApplication',   'Outcome at Application'],

  // Sales context
  ['salesLeadSource',        'Sales Lead Source'],
  ['salesAgent',             'Sales Agent'],
  ['salesNotes',             'Sales Notes'],
  ['carrierSyncNotes',       'Carrier Sync Notes'],

  // Payment
  ['paymentType',            'Payment Type'],
  ['paymentFrequency',       'Payment Frequency'],
  ['draftDay',               'Draft Day'],
  ['ssnBillingMatch',        'SSN Billing Match'],

  // Note: Date of Birth and Gender are GHL standard contact fields
  // (`dateOfBirth`, `gender`), not custom. They're populated via
  // `nativeEnrichment` below — GHL rejects custom fields with names
  // that collide with its standard schema.

  // Beneficiary
  ['beneficiaryFirstName',   'Beneficiary First Name'],
  ['beneficiaryLastName',    'Beneficiary Last Name'],
  ['beneficiaryRelationship', 'Beneficiary Relationship'],
];

// Mapping from internal field name → Sales Tracker column name.
// Some columns only exist on the `Merged` tab (carrier-corrected); we
// `?? ''` them so missing-column reads return blank without throwing.
const SALES_SOURCE_COLUMNS = {
  policyNumber:              'Policy #',
  carrierPolicyNumber:       'Carrier Policy #',                     // Merged only
  carrierProductPayout:      'Carrier + Product + Payout',
  applicationSubmittedDate:  'Application Submitted Date',
  effectiveDate:             'Effective Date',

  monthlyPremium:            'Monthly Premium',
  originalPremium:           'Original Premium',                     // Merged only
  faceAmount:                'Face Amount',
  termLength:                'Term Length',

  placedStatus:              'Placed?',
  originalPlacedStatus:      'Original Placed Status',               // Merged only
  carrierStatus:             'Carrier Status',                       // Merged only
  carrierStatusDate:         'Carrier Status Date',                  // Merged only
  lastCarrierSyncDate:       'Last Sync Date',                       // Merged only
  outcomeAtApplication:      'Outcome at Application Submission',

  salesLeadSource:           'Lead Source',
  salesAgent:                'Agent',
  salesNotes:                'Sales Notes',
  carrierSyncNotes:          'Sync Notes',                           // Merged only

  paymentType:               'Payment Type',
  paymentFrequency:          'Payment Frequency',
  draftDay:                  'Draft Day',
  ssnBillingMatch:           'Social Security Billing Match',

  beneficiaryFirstName:      'Beneficiary - First Name',
  beneficiaryLastName:       'Beneficiary - Last Name',
  beneficiaryRelationship:   'Relationship to Insured',
};

/**
 * Build a policy patch from a Sales Tracker record.
 *
 * Returns:
 *   {
 *     customFields: { internalName: value, ... }   // only set when source has a value
 *     nativeEnrichment: { email, address1, city, postalCode }  // only set when source has a value
 *   }
 *
 * Pattern matches buildContactPatch in field-mapping.js: blank values get
 * dropped at the `buildCustomFieldsArray` step in client.js, so we don't
 * have to filter here. But native enrichment fields use only-if-present
 * semantics because GHL rejects blank values for some.
 */
export function buildPolicyPatch(salesRecord) {
  const v = (k) => (salesRecord[k] ?? '').toString().trim();

  const customFields = {};
  for (const [internalName] of POLICY_FIELDS) {
    customFields[internalName] = v(SALES_SOURCE_COLUMNS[internalName]);
  }

  // Native enrichment: only include keys that have a value in the sales
  // record, so we don't blank-out existing GHL data when the sales row
  // is missing those fields. Same pattern as buildContactPatch. dateOfBirth
  // and gender go here (not in customFields) because GHL rejects custom
  // fields whose names collide with its standard contact schema.
  const nativeEnrichment = {};
  if (v('Email Address')) nativeEnrichment.email = v('Email Address');
  if (v('Street Address')) nativeEnrichment.address1 = v('Street Address');
  if (v('City')) nativeEnrichment.city = v('City');
  if (v('Zip Code')) nativeEnrichment.postalCode = v('Zip Code');
  if (v('Date of Birth')) nativeEnrichment.dateOfBirth = v('Date of Birth');
  if (v('Gender')) nativeEnrichment.gender = v('Gender');

  return { customFields, nativeEnrichment };
}

/**
 * Phone column header in the Sales Tracker (note: it's the parenthesized form,
 * not just "Phone Number"). Exported so callers don't hardcode it.
 */
export const SALES_PHONE_COLUMN = 'Phone Number (US format)';
