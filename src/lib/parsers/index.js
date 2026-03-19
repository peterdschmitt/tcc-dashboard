/**
 * Parser registry — auto-detection + routing for carrier commission statements.
 *
 * Each carrier parser exports:
 *   carrierId: string
 *   carrierNames: string[]
 *   canParse(text, filename): boolean
 *   parse(buffer): Promise<ParsedStatement>
 *
 * ParsedStatement: { carrier, statementDate, payPeriod, agentSummary[], records[] }
 * ParsedRecord: { policyNumber, insuredName, agent, agentId, transactionType,
 *                  premium, commissionAmount, outstandingBalance, product, rawLine }
 */

import * as aigParser from './aig.js';
import * as amicableParser from './amicable.js';
import * as transamericaParser from './transamerica.js';
import * as cicaParser from './cica.js';

const PARSERS = [aigParser, amicableParser, transamericaParser, cicaParser];

/**
 * Files that should be skipped during Drive sync (not commission statements).
 * Matched by filename pattern.
 */
const SKIP_PATTERNS = [
  /Life Commissions Consolidated/i,  // Internal tracking workbook
  /^~\$/,                             // Temp files
];

/**
 * Check if a file should be skipped (not a commission statement).
 */
export function shouldSkip(filename) {
  return SKIP_PATTERNS.some(p => p.test(filename));
}

/**
 * Detect carrier from extracted PDF/Excel text or filename.
 * Returns carrierId string or null.
 */
export function detectCarrier(text, filename) {
  for (const parser of PARSERS) {
    if (parser.canParse(text, filename || '')) return parser.carrierId;
  }
  return null;
}

/**
 * Get parser module by carrierId.
 */
export function getParser(carrierId) {
  return PARSERS.find(p => p.carrierId === carrierId) || null;
}

/**
 * Main entry: parse a commission statement buffer.
 * @param {Buffer} buffer - File content
 * @param {string} filename - Original filename
 * @param {string|null} carrierHint - Optional carrier override
 * @returns {Promise<ParsedStatement>}
 */
export async function parseStatement(buffer, filename, carrierHint) {
  // Check if file should be skipped
  if (shouldSkip(filename)) {
    throw new Error(`Skipped: "${filename}" is not a commission statement`);
  }

  const lowerName = filename.toLowerCase();
  const isPdf = lowerName.endsWith('.pdf');
  const isCsv = lowerName.endsWith('.csv');
  const isExcel = lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls');
  let text = '';
  let workbook = null;

  if (isPdf) {
    // pdf-parse v1.x: default export is the parse function
    const pdfParse = (await import('pdf-parse')).default;
    const pdf = await pdfParse(buffer);
    text = pdf.text;
  } else if (isExcel) {
    // Parse Excel workbook
    const { read, utils } = await import('xlsx');
    workbook = read(buffer, { type: 'buffer' });
    // Build text from first sheet for carrier detection
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = utils.sheet_to_json(sheet, { header: 1, defval: '' });
    text = rows.slice(0, 10).map(r => r.join(' ')).join('\n');
  } else {
    // CSV or text — convert buffer to string for detection
    text = buffer.toString('utf-8').substring(0, 5000);
  }

  // Detect carrier
  const carrierId = carrierHint || detectCarrier(text, filename);
  if (!carrierId) {
    throw new Error(
      'Could not detect carrier from statement. ' +
      'Please select a carrier manually or ensure the file contains carrier-identifying text.'
    );
  }

  const parser = getParser(carrierId);
  if (!parser) {
    throw new Error(`No parser available for carrier: ${carrierId}`);
  }

  // Parse the statement (pass workbook for Excel parsers)
  const result = await parser.parse(buffer, text, workbook);
  return {
    ...result,
    carrier: result.carrier || parser.carrierNames[0], // canonical name
    carrierId,
  };
}

/**
 * List available parsers (for UI dropdown).
 */
export function listParsers() {
  return PARSERS.map(p => ({
    id: p.carrierId,
    name: p.carrierNames[0],
    aliases: p.carrierNames,
  }));
}
