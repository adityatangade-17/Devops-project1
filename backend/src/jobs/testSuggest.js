// One-off test for feature (c) — verifies AI drafts generate end-to-end
// WITHOUT the frontend or auth. Place at: backend/src/jobs/testSuggest.js
// Run: docker exec forgechat-forgecrm-backend-1 node src/jobs/testSuggest.js [contactNumber]
require('../util/instanceSecrets').bootstrapSecrets(); // needed to decrypt the AI key

const pool = require('../db');
const { buildDrafts } = require('../routes/suggestReply');

async function main() {
  const arg = (process.argv[2] || '').replace(/\D/g, '');
  // Find a (wa_number, contact_number) to test: the given contact's latest chat,
  // or the most recent conversation overall.
  const { rows } = await pool.query(`
    SELECT wa_number, contact_number
    FROM coexistence.chat_history
    ${arg ? 'WHERE contact_number = $1' : ''}
    ORDER BY timestamp DESC LIMIT 1
  `, arg ? [arg] : []);
  if (!rows.length) { console.log('No conversations found.'); return; }

  const { wa_number, contact_number } = rows[0];
  console.log(`Testing suggest-reply for wa=${wa_number} contact=${contact_number}`);
  const out = await buildDrafts(wa_number, contact_number);
  console.log(JSON.stringify(out, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
