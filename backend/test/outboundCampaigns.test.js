// Unit tests for the Phase-2 outbound campaign engine's pure safety logic:
// the quiet-hours window and the per-kind template parameter builder. These run
// without a DB — they lock down the Meta-safety behaviour.

const { test } = require('node:test');
const assert = require('node:assert');

const { hourInQuietWindow, buildComponents } = require('../src/services/outboundCampaigns');

test('overnight quiet window (21:00 → 09:00) blocks the night, allows the day', () => {
  // Inside the quiet window → true (no sending).
  for (const h of [21, 22, 23, 0, 3, 8]) {
    assert.strictEqual(hourInQuietWindow(h, 21, 9), true, `hour ${h} should be quiet`);
  }
  // Working hours → false (sending allowed).
  for (const h of [9, 12, 15, 18, 20]) {
    assert.strictEqual(hourInQuietWindow(h, 21, 9), false, `hour ${h} should be active`);
  }
});

test('same-day quiet window (13:00 → 15:00) only blocks that span', () => {
  assert.strictEqual(hourInQuietWindow(14, 13, 15), true);
  assert.strictEqual(hourInQuietWindow(12, 13, 15), false);
  assert.strictEqual(hourInQuietWindow(15, 13, 15), false); // end is exclusive
});

test('recovery/reactivation templates carry only the name param', () => {
  const comp = buildComponents('recovery', { name: 'Asha' });
  assert.strictEqual(comp.length, 1);
  assert.strictEqual(comp[0].type, 'body');
  assert.deepStrictEqual(comp[0].parameters, [{ type: 'text', text: 'Asha' }]);

  const react = buildComponents('reactivation', { name: 'Ravi' });
  assert.strictEqual(react[0].parameters.length, 1);
});

test('collection template carries name + a formatted rupee amount', () => {
  const comp = buildComponents('collection', { name: 'Neha', amountMinor: 500000, currency: 'INR' });
  assert.strictEqual(comp[0].parameters.length, 2);
  assert.strictEqual(comp[0].parameters[0].text, 'Neha');
  assert.match(comp[0].parameters[1].text, /₹5,000/);
});

test('collection amount handles zero / missing gracefully', () => {
  const comp = buildComponents('collection', { name: 'X', amountMinor: 0, currency: 'INR' });
  assert.strictEqual(comp[0].parameters[1].text, '₹0');
});
