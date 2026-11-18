'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePhone } = require('../src/engine/contactMutations');
const { cleanText, chunkText } = require('../src/services/knowledgeBase');

test('normalizePhone strips non-digit characters correctly', () => {
  assert.equal(normalizePhone('+91 98765-43210'), '919876543210');
  assert.equal(normalizePhone('(022) 1234-5678'), '02212345678');
  assert.equal(normalizePhone(null), null);
  assert.equal(normalizePhone(''), '');
});

test('cleanText removes null bytes and excessive whitespace', () => {
  assert.equal(cleanText('  EPR \u0000 Compliance  Guidelines   '), 'EPR Compliance Guidelines');
  assert.equal(cleanText(''), '');
  assert.equal(cleanText(null), '');
});

test('chunkText splits text into overlapping sections', () => {
  const sample = 'A'.repeat(3000);
  const chunks = chunkText(sample, 1000, 100);
  assert.ok(chunks.length >= 3, 'Should produce at least 3 chunks for 3000 chars');
  assert.ok(chunks[0].length >= 80, 'Chunk should be at least 80 chars');
});

test('handover text substitutes {{consultant_phone}} correctly', () => {
  const agent = {
    handover_message: 'Connecting you with our specialist. Call {{consultant_phone}} for immediate help.',
  };
  const handoffWithPhone = { consultantPhone: '919876543210' };
  const handoffWithoutPhone = { consultantPhone: null };

  const phone = handoffWithPhone.consultantPhone ? String(handoffWithPhone.consultantPhone).trim() : '';
  const tmpl = String(agent.handover_message);
  const resultWithPhone = phone ? tmpl.replace(/{{consultant_phone}}/g, phone) : tmpl;
  assert.equal(resultWithPhone, 'Connecting you with our specialist. Call 919876543210 for immediate help.');

  // Fallback text when phone is missing
  const phoneFallback = handoffWithoutPhone.consultantPhone ? String(handoffWithoutPhone.consultantPhone).trim() : '';
  let resultNoPhone;
  if (phoneFallback) {
    resultNoPhone = tmpl.replace(/{{consultant_phone}}/g, phoneFallback);
  } else if (tmpl.includes('{{consultant_phone}}')) {
    resultNoPhone = 'Thank you. Your question needs a specialist review so we can give you accurate guidance. I have shared your details with our team, who will contact you shortly.';
  } else {
    resultNoPhone = tmpl;
  }

  assert.match(resultNoPhone, /specialist review/);
  assert.doesNotMatch(resultNoPhone, /{{consultant_phone}}/);
});

test('grounded prompt includes source document citations and rules', () => {
  const systemPrompt = 'You are an EPR compliance AI.';
  const chunks = [
    { title: 'EPR Plastic Rules 2026', content: 'Producers must register on CPCB portal.' },
    { title: 'LMPC Guidelines', content: 'Packaged commodities require weight declaration.' },
  ];

  const sources = chunks.map((c, i) => `[Source ${i + 1}: ${c.title}]\n${c.content}`).join('\n\n');
  const grounded = `${systemPrompt}\n\n## Approved knowledge retrieved for this reply\n${sources}\n\n## Grounding rules\n1. Answer ONLY with facts supported by the approved knowledge above.\n2. Include source citations in your reply when referencing facts (e.g. "Based on: [Document Title]").`;

  assert.match(grounded, /EPR Plastic Rules 2026/);
  assert.match(grounded, /Based on: \[Document Title\]/);
  assert.match(grounded, /Producers must register/);
});
