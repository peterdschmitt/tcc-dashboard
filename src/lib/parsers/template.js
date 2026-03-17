/**
 * Template for adding a new carrier commission statement parser.
 *
 * To add a new carrier:
 * 1. Copy this file to src/lib/parsers/<carrier>.js
 * 2. Implement canParse() and parse()
 * 3. Import and register in src/lib/parsers/index.js
 * 4. Test with a sample statement
 */

export const carrierId = 'new_carrier';
export const carrierNames = ['New Carrier Name'];

/**
 * Detect if a statement belongs to this carrier.
 * @param {string} text - Extracted text from file
 * @param {string} filename - Original filename
 */
export function canParse(text, filename) {
  // Check for carrier-specific markers in the text
  return false;
}

/**
 * Parse the commission statement.
 * @param {Buffer} buffer - File content
 * @param {string} text - Pre-extracted text
 * @returns {{ statementDate, payPeriod, agentSummary[], records[] }}
 */
export async function parse(buffer, text) {
  // For Excel files:
  // const XLSX = await import('xlsx');
  // const workbook = XLSX.read(buffer, { type: 'buffer' });

  return {
    statementDate: '',
    payPeriod: '',
    agentSummary: [],
    records: [],
    // Each record should have:
    // { policyNumber, insuredName, agent, agentId, effDate,
    //   transactionType, commType, premium, premiumPaid,
    //   commissionAmount, outstandingBalance, product,
    //   cancellationIndicator, section, rawLine }
  };
}
