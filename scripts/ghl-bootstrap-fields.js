// scripts/ghl-bootstrap-fields.js
// Run: node --env-file=.env.local scripts/ghl-bootstrap-fields.js
// Idempotent: safe to run multiple times.
import { createGhlClient } from '../src/lib/ghl/client.js';
import { ALL_CUSTOM_FIELDS } from '../src/lib/ghl/field-mapping.js';

async function main() {
  const token = process.env.GHL_API_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!token || !locationId) throw new Error('GHL_API_TOKEN and GHL_LOCATION_ID required');

  const client = createGhlClient({ token, locationId });
  const existing = await client.resolveCustomFields(); // Map<name, id>
  console.log(`Found ${existing.size} existing custom fields in GHL.`);

  let created = 0, skipped = 0;
  for (const [internalName, displayName] of ALL_CUSTOM_FIELDS) {
    if (existing.has(displayName)) {
      console.log(`✓ exists: ${displayName}`);
      skipped++;
      continue;
    }
    const body = { name: displayName, dataType: 'TEXT', model: 'contact', placeholder: '' };
    await client.request('POST', `/locations/${locationId}/customFields`, body);
    console.log(`+ created: ${displayName}`);
    created++;
  }
  console.log(`Done. Created ${created}, skipped ${skipped}.`);
}

main().catch(e => { console.error(e); process.exit(1); });
