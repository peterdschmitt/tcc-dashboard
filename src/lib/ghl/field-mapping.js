// src/lib/ghl/field-mapping.js

// Canonical internal names for custom fields. The bootstrap script
// creates GHL fields with these exact display names; client.js resolves
// them to GHL field IDs at runtime.
export const FIRST_FIELDS = [
  ['firstLeadId',        'First Lead ID'],
  ['firstClientId',      'First Client ID'],
  ['firstCallDate',      'First Call Date'],
  ['firstCampaign',      'First Campaign'],
  ['firstSubcampaign',   'First Subcampaign'],
  ['firstCallerId',      'First Caller ID'],
  ['firstInboundSource', 'First Inbound Source'],
  ['firstImportDate',    'First Import Date'],
  ['firstRep',           'First Rep'],
];

export const LAST_FIELDS = [
  ['lastLeadId',         'Last Lead ID'],
  ['lastClientId',       'Last Client ID'],
  ['lastCallDate',       'Last Call Date'],
  ['lastRep',            'Last Rep'],
  ['lastCampaign',       'Last Campaign'],
  ['lastSubcampaign',    'Last Subcampaign'],
  ['lastCallerId',       'Last Caller ID'],
  ['lastImportDate',     'Last Import Date'],
  ['lastCallStatus',     'Last Call Status'],
  ['lastCallType',       'Last Call Type'],
  ['lastCallDuration',   'Last Call Duration (s)'],
  ['lastHoldTime',       'Last Hold Time (s)'],
  ['lastHangup',         'Last Hangup'],
  ['lastHangupSource',   'Last Hangup Source'],
  ['lastCallDetails',    'Last Call Details'],
  ['lastRecordingUrl',   'Last Recording URL'],
  ['lastAttemptNumber',  'Last Attempt #'],
  ['currentlyCallable',  'Currently Callable'],
];

export const COMPUTED_FIELDS = [
  ['totalCallAttempts',  'Total Call Attempts'],
];

// Policy fields (defined in sales-mapping.js) are merged into ALL_CUSTOM_FIELDS
// so the bootstrap script creates them in GHL alongside the call-log fields.
import { POLICY_FIELDS } from './sales-mapping.js';

export const ALL_CUSTOM_FIELDS = [...FIRST_FIELDS, ...LAST_FIELDS, ...COMPUTED_FIELDS, ...POLICY_FIELDS];

const FIRST_SOURCE_COLUMNS = {
  firstLeadId: 'Lead Id',
  firstClientId: 'Client ID',
  firstCallDate: 'Date',
  firstCampaign: 'Campaign',
  firstSubcampaign: 'Subcampaign',
  firstCallerId: 'Caller ID',
  firstInboundSource: 'Inbound Source',
  firstImportDate: 'Import Date',
  firstRep: 'Rep',
};

const LAST_SOURCE_COLUMNS = {
  lastLeadId: 'Lead Id',
  lastClientId: 'Client ID',
  lastCallDate: 'Date',
  lastRep: 'Rep',
  lastCampaign: 'Campaign',
  lastSubcampaign: 'Subcampaign',
  lastCallerId: 'Caller ID',
  lastImportDate: 'Import Date',
  lastCallStatus: 'Call Status',
  lastCallType: 'Call Type',
  lastCallDuration: 'Duration',
  lastHoldTime: 'HoldTime',
  lastHangup: 'Hangup',
  lastHangupSource: 'Hangup Source',
  lastCallDetails: 'Details',
  lastRecordingUrl: 'Recording',
  lastAttemptNumber: 'Attempt',
  currentlyCallable: 'Is Callable',
};

/**
 * Build a contact patch from a Call Log row.
 * @param row Call Log row
 * @param opts.isNewContact when true, includes native fields and "First *" customs
 */
export function buildContactPatch(row, { isNewContact }) {
  const v = (k) => (row[k] ?? '').toString().trim();

  // Build native fields, skipping blanks. GHL rejects empty values on
  // strict fields (e.g., 422 "country must be valid" when country is "").
  // Country defaults to 'US' since this is a US-based call center; all
  // existing Call Log rows have blank Country.
  const native = {};
  if (isNewContact) {
    if (v('First')) native.firstName = v('First');
    if (v('Last')) native.lastName = v('Last');
    // Phone validation: GHL rejects with HTTP 400 "string supplied did not
    // seem to be a phone number" if the value isn't recognizable. Require
    // at least 10 digits after stripping non-numeric chars.
    const phoneRaw = v('Phone');
    const phoneDigits = phoneRaw.replace(/\D/g, '');
    if (phoneDigits.length >= 10) native.phone = phoneRaw;
    if (v('State')) native.state = v('State');
    native.country = v('Country') || 'US';
    if (v('Inbound Source')) native.source = v('Inbound Source');
  }

  const customFields = {};

  if (isNewContact) {
    for (const [internalName] of FIRST_FIELDS) {
      customFields[internalName] = v(FIRST_SOURCE_COLUMNS[internalName]);
    }
  }

  for (const [internalName] of LAST_FIELDS) {
    customFields[internalName] = v(LAST_SOURCE_COLUMNS[internalName]);
  }

  // Tags
  const tags = [];
  const campaign = v('Campaign');
  const state = v('State');
  const isCallable = v('Is Callable').toLowerCase() === 'yes' || v('Is Callable').toLowerCase() === 'true';
  if (campaign) tags.push(`publisher:${campaign}`);
  if (state) tags.push(`state:${state}`);
  tags.push(isCallable ? 'callable:yes' : 'callable:no');

  const callableNegationTag = isCallable ? 'callable:no' : 'callable:yes';

  return { native, customFields, tags, callableNegationTag };
}
