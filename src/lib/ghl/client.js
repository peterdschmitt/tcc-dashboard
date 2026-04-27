// src/lib/ghl/client.js
import { levenshtein } from './levenshtein.js';
import { ALL_CUSTOM_FIELDS } from './field-mapping.js';

const GHL_BASE = 'https://services.leadconnectorhq.com';
const VERSION = '2021-07-28';
// GHL's sustained rate limit is 100 requests per 10 seconds (= 10 req/sec)
// per location. We observed that exceeding even briefly triggers a
// multi-minute extended cool-down (anti-abuse). 250ms (= 4 req/sec)
// leaves substantial headroom and stays comfortably under any
// burst threshold across the full backfill duration.
const INTER_CALL_DELAY_MS = 250;
// 1s, 2s, 4s, 8s, 16s, 32s, 64s = 127s max backoff. After observing GHL
// hold a hard rate-limit for several minutes when we've previously
// abused the burst budget, longer retries are safer than fast failure.
const MAX_RETRIES = 7;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function createGhlClient({ token, locationId, dryRun = false }) {
  if (!token) throw new Error('GHL client: token is required');
  if (!locationId) throw new Error('GHL client: locationId is required');

  let lastCallAt = 0;
  let customFieldCache = null; // Map<displayName, fieldId>

  async function rateLimit() {
    const since = Date.now() - lastCallAt;
    if (since < INTER_CALL_DELAY_MS) await sleep(INTER_CALL_DELAY_MS - since);
    lastCallAt = Date.now();
  }

  async function request(method, path, body) {
    const isWrite = method !== 'GET';
    if (dryRun && isWrite) {
      return { dryRun: true, method, path, body };
    }

    let lastErr;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await rateLimit();
      const url = path.startsWith('http') ? path : `${GHL_BASE}${path}`;
      // Hard timeout per request. Without this, a dropped connection from
      // GHL hangs fetch() forever (Node has no default fetch timeout) and
      // the entire backfill stalls silently. 60s is generous; healthy GHL
      // calls return in <1s.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60_000);
      let res;
      try {
        res = await fetch(url, {
          method,
          headers: {
            'Authorization': `Bearer ${token}`,
            'Version': VERSION,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
      } catch (e) {
        clearTimeout(timeoutId);
        // AbortError or network error — treat as retryable
        lastErr = new Error(`GHL ${method} ${path} → ${e.name}: ${e.message}`);
        if (attempt < MAX_RETRIES) {
          await sleep(1000 * Math.pow(2, attempt));
          continue;
        }
        throw lastErr;
      }
      clearTimeout(timeoutId);

      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`GHL ${method} ${path} → ${res.status}`);
        if (attempt < MAX_RETRIES) {
          await sleep(1000 * Math.pow(2, attempt)); // 1s, 2s, 4s
          continue;
        }
        throw lastErr;
      }

      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (res.status >= 400) {
        const err = new Error(`GHL ${method} ${path} → ${res.status}: ${text}`);
        err.status = res.status;
        err.body = data;
        throw err;
      }
      return data;
    }
    throw lastErr;
  }

  async function resolveCustomFields() {
    if (customFieldCache) return customFieldCache;
    const data = await request('GET', `/locations/${locationId}/customFields`);
    const list = data.customFields ?? [];
    customFieldCache = new Map(list.map(f => [f.name, f.id]));
    return customFieldCache;
  }

  function getCustomFieldId(internalName, allFields) {
    const entry = allFields.find(([k]) => k === internalName);
    if (!entry) throw new Error(`Unknown internal field name: ${internalName}`);
    const displayName = entry[1];
    if (!customFieldCache) throw new Error('Call resolveCustomFields() before getCustomFieldId()');
    const id = customFieldCache.get(displayName);
    if (!id) throw new Error(`GHL custom field "${displayName}" not found — run scripts/ghl-bootstrap-fields.js`);
    return id;
  }

  function normalizePhone(p) {
    // Strip non-digits, then drop leading "1" for 11-digit US numbers so
    // "+14302873295" (GHL's stored format) and "4302873295" (raw row)
    // compare equal. Otherwise we'd mis-treat them as different phones
    // and try to append the row's phone to additionalPhones unnecessarily.
    let s = (p ?? '').toString().replace(/\D/g, '');
    if (s.length === 11 && s.startsWith('1')) s = s.slice(1);
    return s;
  }

  async function searchByPhone(phone) {
    const target = normalizePhone(phone);
    if (!target) return null;
    // Query by normalized 10-digit digits, not the raw formatted phone.
    // Raw formats like "(859) 336-4459" trigger GHL's full-text fuzzy
    // search across multiple fields and can return unrelated contacts;
    // a digits-only query targets the phone index more reliably.
    const data = await request('GET', `/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(target)}`);
    const contacts = data.contacts ?? [];
    for (const c of contacts) {
      const candidates = [c.phone, ...(c.additionalPhones ?? [])].map(normalizePhone);
      if (candidates.includes(target)) return c;
    }
    return null;
  }

  async function searchByNameAndState(firstName, lastName, state) {
    if (!firstName || !lastName || !state) return null;
    const query = `${firstName} ${lastName}`;
    const data = await request('GET', `/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(query)}`);
    const contacts = data.contacts ?? [];
    const targetState = state.toLowerCase();
    for (const c of contacts) {
      const cState = (c.state ?? '').toLowerCase();
      if (cState !== targetState) continue;
      if (levenshtein(c.firstName ?? '', firstName) > 1) continue;
      if (levenshtein(c.lastName  ?? '', lastName)  > 1) continue;
      return c;
    }
    return null;
  }

  function buildCustomFieldsArray(customFieldsObj) {
    // { internalName: value, ... } → [{ id, value }, ...]
    const out = [];
    for (const [internalName, value] of Object.entries(customFieldsObj ?? {})) {
      if (value === undefined || value === null || value === '') continue;
      const id = getCustomFieldId(internalName, ALL_CUSTOM_FIELDS);
      out.push({ id, value });
    }
    return out;
  }

  async function createContact({ native, customFields, tags }) {
    const body = {
      locationId,
      ...native,
      customFields: buildCustomFieldsArray(customFields),
      tags: tags ?? [],
    };
    let data;
    try {
      data = await request('POST', '/contacts/', body);
    } catch (err) {
      // GHL native phone-dedup catches duplicates we missed (eventual
      // consistency: our Tier 1 search runs at T+0 but GHL's index
      // hasn't reflected a contact created seconds earlier in the same
      // batch). Recover by re-fetching the existing contact and flag it
      // so the caller can apply Tier 1 logic on top.
      if (err.status === 400 && err.body?.meta?.contactId) {
        const existing = await request('GET', `/contacts/${err.body.meta.contactId}`);
        const contact = existing.contact ?? existing;
        contact._dedupedExisting = true;
        return contact;
      }
      throw err;
    }
    if (data.dryRun) return { id: `dry-run-${Date.now()}`, dryRun: true };
    return data.contact ?? data;
  }

  async function updateContact(contactId, patch, currentContact) {
    const { customFields = {}, tags = [], removeTag, additionalPhone } = patch;

    // Tags: union with existing, then remove the negation tag if present
    const existingTags = new Set(currentContact?.tags ?? []);
    for (const t of tags) existingTags.add(t);
    if (removeTag) existingTags.delete(removeTag);

    // Additional phones append disabled.
    //
    // The brainstorm spec said "if a row has a phone different from
    // existing primary, append to additionalPhones." Implementation
    // tries to PUT additionalPhones as an array of strings, but GHL's
    // v2 API rejects that with HTTP 422 ("each value in nested property
    // additionalPhones must be either object or array"). The correct
    // GHL request shape for this field isn't documented clearly and
    // we've observed inconsistencies in how GHL's GET response formats
    // it back.
    //
    // Practical observation: the call log dataset is one-phone-per-row,
    // so we never actually have a true secondary phone to capture from
    // a single row. Cross-row variants are usually format differences
    // that normalizePhone now handles via Tier 1 match.
    //
    // V3 follow-up: figure out GHL's exact additionalPhones object
    // shape, then re-enable. Until then, we don't touch the field on
    // update — preserves whatever GHL has.
    const additionalPhones = currentContact?.additionalPhones ?? [];

    // totalCallAttempts: read existing from currentContact.customFields, increment
    let totalAttempts = 1;
    const existingCf = currentContact?.customFields ?? [];
    await resolveCustomFields(); // ensure cache
    const totalAttemptsId = getCustomFieldId('totalCallAttempts', ALL_CUSTOM_FIELDS);
    const existingTotal = existingCf.find(cf => cf.id === totalAttemptsId);
    if (existingTotal && !isNaN(parseInt(existingTotal.value))) {
      totalAttempts = parseInt(existingTotal.value) + 1;
    }
    customFields.totalCallAttempts = String(totalAttempts);

    const body = {
      customFields: buildCustomFieldsArray(customFields),
      tags: [...existingTags],
    };
    // additionalPhones is intentionally never sent on update (see comment
    // in the additionalPhones declaration above). GHL preserves its
    // current value when the field isn't included.

    const data = await request('PUT', `/contacts/${contactId}`, body);
    if (data.dryRun) return { id: contactId, dryRun: true };
    return data.contact ?? data;
  }

  async function addNote(contactId, body) {
    // GHL rejects extra `contactId` in the body for this endpoint
    // (it's already in the URL): "property contactId should not exist".
    const data = await request('POST', `/contacts/${contactId}/notes`, { body });
    return data;
  }

  return {
    request,
    locationId,
    dryRun,
    resolveCustomFields,
    getCustomFieldId,
    normalizePhone,
    searchByPhone,
    searchByNameAndState,
    createContact,
    updateContact,
    addNote,
  };
}
