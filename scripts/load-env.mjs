// scripts/load-env.mjs
// Tiny .env loader that preserves backslash-escape sequences inside
// double-quoted values (e.g. "\n" stays as the two-char string `\n`,
// not converted to a real newline). Node's built-in --env-file and
// the `dotenv` package both decode those escapes, which breaks
// JSON.parse on values like GOOGLE_SERVICE_ACCOUNT_KEY whose
// inner private_key field uses `\n` to represent PEM line breaks.
//
// Usage:
//   import './scripts/load-env.mjs';   // imports for side effect (loads .env.local)
//   // or:
//   import { loadEnv } from './scripts/load-env.mjs';
//   loadEnv('.env.local');

import { readFileSync, existsSync } from 'node:fs';

export function loadEnv(path = '.env.local') {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) continue;
    let value = line.slice(eq + 1);
    // Strip surrounding double quotes if present, but leave inner content as-is
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnv();
