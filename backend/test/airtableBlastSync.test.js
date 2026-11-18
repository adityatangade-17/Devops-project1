const test = require('node:test');
const assert = require('node:assert/strict');
const { formatDate } = require('../src/services/airtableBlastSync');

test('Airtable blast dates are formatted in India time', () => {
  assert.equal(formatDate('2026-09-03T20:30:00.000Z'), '2026-09-04');
});

test('invalid Airtable blast dates produce an empty value', () => {
  assert.equal(formatDate('not-a-date'), '');
});
