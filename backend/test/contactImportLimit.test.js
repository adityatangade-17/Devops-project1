const test = require('node:test');
const assert = require('node:assert/strict');

const { MAX_CONTACT_IMPORT_ROWS } = require('../src/routes/messages');

test('contact CSV/XLSX imports allow up to 10,000 rows', () => {
  assert.equal(MAX_CONTACT_IMPORT_ROWS, 10000);
});
