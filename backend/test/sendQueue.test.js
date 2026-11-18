const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../src/db');
const { encrypt } = require('../src/util/crypto');
const { enqueueSend } = require('../src/queue/sendQueue');
const { normalizeBroadcastRecipient } = require('../src/routes/broadcasts');

test('broadcast tests normalize local Indian mobile numbers for Meta', () => {
  assert.equal(normalizeBroadcastRecipient('9960967250'), '919960967250');
  assert.equal(normalizeBroadcastRecipient('+91 99609 67250'), '919960967250');
  assert.equal(normalizeBroadcastRecipient('123'), null);
});

test('waitForCompletion resolves only after Meta accepts a test send', async () => {
  const originalQuery = pool.query;
  const originalFetch = global.fetch;
  let resolveFetch;
  let settled = false;

  pool.query = async (sql) => {
    if (sql.includes('FROM coexistence.whatsapp_accounts WHERE id')) {
      return {
        rows: [{
          id: 1,
          display_name: 'EPR Seva',
          display_phone_number: '919999999999',
          phone_number_id: 'phone-id',
          access_token_encrypted: encrypt('test-token'),
          is_active: true,
        }],
      };
    }
    return { rows: [] };
  };
  global.fetch = () => new Promise((resolve) => { resolveFetch = resolve; });

  try {
    const send = enqueueSend({
      kind: 'text', accountId: 1, to: '919111111111',
      localMessageId: null, payload: { body: 'Test' },
    }, { waitForCompletion: true });
    send.then(() => { settled = true; });

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);

    resolveFetch({ ok: true, text: async () => JSON.stringify({ messages: [{ id: 'wamid.test' }] }) });
    assert.deepEqual(await send, { wamid: 'wamid.test' });
  } finally {
    pool.query = originalQuery;
    global.fetch = originalFetch;
  }
});
