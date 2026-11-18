const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../src/db');
const {
  AUTO_RESPONSE_TAG,
  classifyIncomingMessage,
  markAutoResponse,
} = require('../src/services/messageClassification');
const { withMessageClassificationContext, buildToolsForAgent } = require('../src/engine/agentEngine');
const { shouldRouteIncomingRecord } = require('../src/routes/webhook');

function withQuery(handler, fn) {
  const original = pool.query;
  pool.query = handler;
  return Promise.resolve().then(fn).finally(() => { pool.query = original; });
}

test('classifies a clear business auto-response from deterministic signals', () => {
  const result = classifyIncomingMessage({
    messageType: 'text',
    messageBody: 'Thank you for contacting Agro. Please leave your message and our team will get back to you during business hours.',
  });
  assert.equal(result.kind, 'AUTO_RESPONSE');
  assert.ok(result.confidence >= 0.8);
  assert.match(result.reason, /contact_acknowledgement/);
  assert.match(result.reason, /leave_message/);
});

test('does not misclassify normal human acknowledgements as auto-responses', () => {
  for (const messageBody of [
    'Thanks for sending the certificate.',
    'I will check the details and get back to you tomorrow.',
    'Thank you, please send the quotation.',
  ]) {
    const result = classifyIncomingMessage({ messageType: 'text', messageBody });
    assert.equal(result.kind, 'NORMAL_HUMAN');
  }
});

test('classifies a customer question and prioritizes STOP over all other signals', () => {
  assert.equal(classifyIncomingMessage({ messageType: 'text', messageBody: 'Can you share the filing deadline?' }).kind, 'CUSTOMER_QUESTION');
  assert.equal(classifyIncomingMessage({ messageType: 'text', messageBody: 'STOP' }).kind, 'STOP');
});

test('auto-response state creates its tag and persists its deterministic reason', async () => {
  const calls = [];
  await withQuery(async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [] };
  }, async () => {
    const result = await markAutoResponse({
      waNumber: '+91 90000 00000',
      contactNumber: '919111111111',
      classification: { kind: 'AUTO_RESPONSE', reason: 'leave_message,team_will_reply' },
    });
    assert.deepEqual(result.tag, AUTO_RESPONSE_TAG);
  });
  assert.equal(calls.length, 3);
  assert.match(calls[2].sql, /auto_response_detected = TRUE/);
  assert.match(calls[2].sql, /jsonb_array_elements/);
  assert.equal(calls[2].params[4], 'leave_message,team_will_reply');
});

test('auto-response agent context requires one short reply and disables media-group sends', async () => {
  const classification = { kind: 'AUTO_RESPONSE', confidence: 0.95, reason: 'explicit_automation' };
  const prompt = withMessageClassificationContext('Base instructions.', classification);
  assert.match(prompt, /at most ONE short, natural WhatsApp response/);
  assert.match(prompt, /do not use media, links, templates, or multiple messages/i);

  await withQuery(async () => ({ rows: [] }), async () => {
    const { tools } = await buildToolsForAgent(
      { id: 1, media_groups: [{ label: 'Brochure', items: [] }] },
      null,
      { allowMediaGroups: false },
    );
    assert.equal(tools.some(tool => tool.function?.name === 'send_media'), false);
  });
});

test('duplicate webhook records do not enter inbound routing', () => {
  assert.equal(shouldRouteIncomingRecord({ __isNew: false }), false);
  assert.equal(shouldRouteIncomingRecord({ __isNew: true }), true);
});
