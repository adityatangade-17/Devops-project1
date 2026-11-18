const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../src/db');
const { markContactOptedOut, assertMetaSendAllowed, STOP_TAG } = require('../src/services/optOut');
const { sendText, sendTemplate, sendMedia, sendInteractive, sendLocation, sendContacts, sendReaction } = require('../src/integrations/metaSend');
const { routeIfActive } = require('../src/services/agentRouter');
const { evaluateTriggers } = require('../src/engine/automationEngine');

function withQuery(handler, fn) {
  const original = pool.query;
  pool.query = handler;
  return Promise.resolve().then(fn).finally(() => { pool.query = original; });
}

test('STOP upsert creates a protected contact, preserves tags, and cancels active automation work', async () => {
  const calls = [];
  await withQuery(async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [] };
  }, async () => {
    const result = await markContactOptedOut({ waNumber: '+91 90000 00000', contactNumber: '919111111111' });
    assert.equal(result.optedOut, true);
    assert.deepEqual(result.tag, STOP_TAG);
  });
  assert.equal(calls.length, 4);
  assert.match(calls[2].sql, /marketing_opted_out = TRUE/);
  assert.match(calls[2].sql, /jsonb_array_elements/);
  assert.match(calls[3].sql, /status = 'cancelled'/);
});

test('final Meta guard blocks every customer message type without calling Meta', async () => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => { fetchCalls += 1; return { ok: true, text: async () => JSON.stringify({ messages: [{ id: 'wamid' }] }) }; };
  const sends = [
    () => sendText({ accessToken: 'secret', phoneNumberId: 'phone-id', to: '919111111111', body: 'Hi' }),
    () => sendTemplate({ accessToken: 'secret', phoneNumberId: 'phone-id', to: '919111111111', templateName: 'x' }),
    () => sendMedia({ accessToken: 'secret', phoneNumberId: 'phone-id', to: '919111111111', type: 'image', mediaId: 'm' }),
    () => sendInteractive({ accessToken: 'secret', phoneNumberId: 'phone-id', to: '919111111111', interactive: { type: 'button' } }),
    () => sendLocation({ accessToken: 'secret', phoneNumberId: 'phone-id', to: '919111111111', latitude: 1, longitude: 2 }),
    () => sendContacts({ accessToken: 'secret', phoneNumberId: 'phone-id', to: '919111111111', contacts: [{ name: { formatted_name: 'A' } }] }),
    () => sendReaction({ accessToken: 'secret', phoneNumberId: 'phone-id', to: '919111111111', messageId: 'wamid', emoji: 'X' }),
  ];
  try {
    await withQuery(async () => ({ rows: [{ blocked: true }] }), async () => {
      for (const send of sends) await assert.rejects(send, { code: 'CONTACT_OPTED_OUT' });
    });
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('non-STOP recipient reaches Meta unchanged', async () => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => ({ ok: true, text: async () => { fetchCalls += 1; return JSON.stringify({ messages: [{ id: 'wamid' }] }); } });
  try {
    await withQuery(async () => ({ rows: [] }), async () => {
      const result = await sendText({ accessToken: 'secret', phoneNumberId: 'phone-id', to: '919111111111', body: 'Hi' });
      assert.equal(result.messages[0].id, 'wamid');
    });
    assert.equal(fetchCalls, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('agent and automation routing stop before creating a response for opted-out contacts', async () => {
  await withQuery(async () => ({ rows: [{ opted_out: true }] }), async () => {
    const record = { direction: 'incoming', message_type: 'text', wa_number: '919000000000', contact_number: '919111111111', message_id: 'wamid', message_body: 'Hello' };
    assert.equal(await routeIfActive(record), null);
    assert.deepEqual(await evaluateTriggers(record), []);
  });
});
