// src/lib/ghl/client.js
const GHL_BASE = 'https://services.leadconnectorhq.com';
const VERSION = '2021-07-28';
const INTER_CALL_DELAY_MS = 50;
const MAX_RETRIES = 3;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function createGhlClient({ token, locationId, dryRun = false }) {
  if (!token) throw new Error('GHL client: token is required');
  if (!locationId) throw new Error('GHL client: locationId is required');

  let lastCallAt = 0;

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
      const res = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Version': VERSION,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });

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

  return {
    request,
    locationId,
    dryRun,
    // methods added in subsequent tasks
  };
}
