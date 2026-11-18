// Unit tests for the built-in agent catalog + the Manager report digest.
// These are pure (no DB) — they validate catalog integrity and the deterministic
// report formatting that management reads.

const { test } = require('node:test');
const assert = require('node:assert');

const { PRESETS, PRESET_BY_KEY, presetPublic } = require('../src/services/builtinAgents');
const { buildDigest, isWeeklyDue } = require('../src/services/managerReport');

test('catalog has all 8 built-in agents with the required shape', () => {
  const keys = PRESETS.map(p => p.key);
  for (const k of ['lead_qualification', 'appointment', 'proposal', 'followup', 'recovery', 'reactivation', 'collection', 'manager']) {
    assert.ok(keys.includes(k), `missing preset: ${k}`);
  }
  assert.strictEqual(PRESETS.length, 8);
  for (const p of PRESETS) {
    assert.ok(p.key && p.name && p.description && p.category && p.icon, `preset ${p.key} missing a required field`);
    assert.ok(['inbound', 'proactive', 'analytics'].includes(p.category), `preset ${p.key} bad category`);
  }
});

test('installable (inbound) presets carry a production system prompt + handover', () => {
  const installable = PRESETS.filter(p => p.installable);
  assert.deepStrictEqual(installable.map(p => p.key).sort(), ['appointment', 'lead_qualification', 'proposal']);
  for (const p of installable) {
    assert.ok(p.defaults?.systemPrompt?.length > 200, `${p.key} prompt too short`);
    assert.ok(/Neubrain/i.test(p.defaults.systemPrompt), `${p.key} prompt not branded`);
    assert.ok(p.defaults.handoverMessage, `${p.key} missing handoverMessage`);
  }
});

test('proactive/analytics presets are NOT installable as engine agents', () => {
  for (const k of ['followup', 'recovery', 'reactivation', 'collection', 'manager']) {
    assert.ok(!PRESET_BY_KEY[k].installable, `${k} should not be installable`);
  }
});

test('money/outbound agents are gated (safe-by-default)', () => {
  // Collection / Reactivation / Recovery message customers or handle money, so
  // they must be template-gated (never auto-live).
  for (const k of ['recovery', 'reactivation', 'collection']) {
    assert.strictEqual(PRESET_BY_KEY[k].status, 'gated', `${k} must ship gated`);
  }
});

test('presetPublic exposes the prompt but nothing sensitive', () => {
  const pub = presetPublic(PRESET_BY_KEY['lead_qualification']);
  assert.ok(pub.systemPrompt, 'should expose the prompt for admin review');
  assert.strictEqual(pub.installable, true);
  assert.strictEqual(pub.defaults, undefined, 'should not leak the raw defaults object');
});

test('manager digest reads in the manager\'s own phrasing', () => {
  const digest = buildDigest({
    windowDays: 7, hasLeadScoreField: true,
    leads: 182, notContacted: 47, highIntent: 18, likelyToClose: 7,
    wonThisWeek: 3, wonValue: 250000, msgsIn: 900, msgsOut: 1200, contactedRate: 74,
  });
  assert.match(digest, /received 182 leads this week/);
  assert.match(digest, /47 haven't been contacted/);
  assert.match(digest, /18 are high intent/);
  assert.match(digest, /7 are likely to close/);
});

test('weekly report is due only on the configured IST day at/after the hour', () => {
  const cfg = { enabled: true, day_of_week: 1, hour: 9 }; // Monday 09:00 IST
  assert.strictEqual(isWeeklyDue(cfg, { istDay: 1, istHour: 9 }), true);
  assert.strictEqual(isWeeklyDue(cfg, { istDay: 1, istHour: 14 }), true);
  assert.strictEqual(isWeeklyDue(cfg, { istDay: 1, istHour: 8 }), false); // too early
  assert.strictEqual(isWeeklyDue(cfg, { istDay: 2, istHour: 10 }), false); // wrong day
  assert.strictEqual(isWeeklyDue({ ...cfg, enabled: false }, { istDay: 1, istHour: 9 }), false);
  assert.strictEqual(isWeeklyDue(null, { istDay: 1, istHour: 9 }), false);
});

test('manager digest degrades gracefully with no Lead Score field and zero leads', () => {
  const digest = buildDigest({
    windowDays: 30, hasLeadScoreField: false,
    leads: 0, notContacted: 0, highIntent: 0, likelyToClose: 0,
    wonThisWeek: 0, wonValue: 0, msgsIn: 0, msgsOut: 0, contactedRate: null,
  });
  assert.match(digest, /last 30 days/);
  assert.match(digest, /Lead Score/); // tip to create the field
  assert.doesNotMatch(digest, /high intent/); // omitted when the field is absent
});
