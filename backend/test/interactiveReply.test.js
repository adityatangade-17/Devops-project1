const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractInteractiveReply,
  getInteractiveCandidateTexts,
  formatInteractiveInboundText,
} = require('../src/util/interactiveReply');
const { matchesMessageRecord } = require('../src/engine/automationEngine');
const { matchesIncomingRecord } = require('../src/services/agentRouter');

test('extractInteractiveReply preserves button id and title', () => {
  const reply = extractInteractiveReply({
    type: 'button',
    button_reply: {
      id: 'CHECK_ANNUAL_RETURN',
      title: 'Check Now',
    },
  });

  assert.deepEqual(reply, {
    kind: 'button_reply',
    id: 'CHECK_ANNUAL_RETURN',
    title: 'Check Now',
    description: null,
    label: 'Check Now',
  });
});

test('interactive candidate texts prefer id but keep title fallback', () => {
  const values = getInteractiveCandidateTexts(
    { id: 'NOT_NOW', title: 'Not now', description: 'Skip for now' },
    'Not now',
  );

  assert.deepEqual(values, ['NOT_NOW', 'Not now', 'Skip for now']);
});

test('agent text formatter includes both id and title for interactive replies', () => {
  assert.equal(
    formatInteractiveInboundText({ kind: 'button_reply', id: 'CHECK_ANNUAL_RETURN', title: 'Check Now' }),
    'User selected button: CHECK_ANNUAL_RETURN (Check Now)',
  );
});

test('automation keyword matching accepts interactive reply id', () => {
  const record = {
    message_body: 'Check Now',
    interactive_reply: { id: 'CHECK_ANNUAL_RETURN', title: 'Check Now' },
  };

  assert.equal(matchesMessageRecord(record, 'CHECK_ANNUAL_RETURN', 'exact', true), true);
  assert.equal(matchesMessageRecord(record, 'Check Now', 'exact', true), true);
});

test('agent keyword matching accepts interactive reply title and id', () => {
  const record = {
    message_body: 'Not now',
    interactive_reply: { id: 'NOT_NOW', title: 'Not now' },
  };

  assert.equal(matchesIncomingRecord(record, 'NOT_NOW', 'exact', true), true);
  assert.equal(matchesIncomingRecord(record, 'not now', 'exact', false), true);
});
