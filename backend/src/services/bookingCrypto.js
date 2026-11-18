// Encryption of visitor PII on booking rows (spec §13: encrypt customer phone,
// email and intake answers at rest). Uses the app's AES-256-GCM helper. Columns
// stay TEXT — they just hold ciphertext now, so no migration/backfill is needed
// for a fresh module (there is no legacy plaintext to convert).
//
// Encrypted fields: visitor_email, visitor_phone, notes. visitor_name is left
// in clear as the human-facing label (calendar summary, dashboard row title).

const { encrypt, decrypt } = require('../util/crypto');

const PII_FIELDS = ['visitor_email', 'visitor_phone', 'notes'];

// Return a shallow copy of a booking row with its PII fields decrypted. Safe on
// null/absent fields (decrypt returns null). Call this before displaying a
// booking or handing it to the notifier/calendar adapter.
function decryptContacts(row) {
  if (!row) return row;
  const out = { ...row };
  for (const f of PII_FIELDS) {
    if (f in out) out[f] = decrypt(out[f]);
  }
  return out;
}

module.exports = { encrypt, decrypt, decryptContacts, PII_FIELDS };
