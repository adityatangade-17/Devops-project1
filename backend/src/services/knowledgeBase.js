const crypto = require('crypto');
const OpenAI = require('openai');
const pool = require('../db');
const { decrypt } = require('../util/crypto');

function cleanText(text) { return String(text || '').replace(/\u0000/g, '').replace(/\s+/g, ' ').trim(); }
function chunkText(text, size = 1200, overlap = 180) {
  const source = cleanText(text); const chunks = [];
  for (let start = 0; start < source.length; start += size - overlap) {
    const part = source.slice(start, start + size); if (part.length >= 80) chunks.push(part);
  }
  return chunks;
}
async function openAiClient() {
  const { rows } = await pool.query("SELECT api_key_encrypted FROM coexistence.ai_models WHERE provider='openai' ORDER BY created_at DESC LIMIT 1");
  const key = rows[0]?.api_key_encrypted ? decrypt(rows[0].api_key_encrypted) : process.env.OPENAI_API_KEY;
  if (!key) throw new Error('An OpenAI model connection is required to index and search the knowledge base.');
  return new OpenAI({ apiKey: key });
}
async function embedding(text) { const client = await openAiClient(); const r = await client.embeddings.create({ model: 'text-embedding-3-small', input: text }); return r.data[0].embedding; }
async function indexDocument({ documentId, text }) {
  const chunks = chunkText(text); if (!chunks.length) throw new Error('No readable text was found in this document.');
  await pool.query('DELETE FROM coexistence.knowledge_chunks WHERE document_id=$1', [documentId]);
  for (let i = 0; i < chunks.length; i += 1) {
    const vector = await embedding(chunks[i]);
    await pool.query('INSERT INTO coexistence.knowledge_chunks (document_id, chunk_index, content, embedding) VALUES ($1,$2,$3,$4::vector)', [documentId, i, chunks[i], `[${vector.join(',')}]`]);
  }
  await pool.query("UPDATE coexistence.knowledge_documents SET status='ready', chunk_count=$2, error_message=NULL, updated_at=NOW() WHERE id=$1", [documentId, chunks.length]);
}
async function retrieve({ knowledgeBaseId, query, minScore = 0.7, maxChunks = 5 }) {
  if (!knowledgeBaseId || !cleanText(query)) return { matched: false, chunks: [] };
  const vector = await embedding(query);
  const { rows } = await pool.query(`SELECT c.content, d.title, d.original_name, 1 - (c.embedding <=> $2::vector) AS score
    FROM coexistence.knowledge_chunks c JOIN coexistence.knowledge_documents d ON d.id=c.document_id
    WHERE d.knowledge_base_id=$1 AND d.status='ready'
    ORDER BY c.embedding <=> $2::vector LIMIT $3`, [knowledgeBaseId, `[${vector.join(',')}]`, Math.max(1, Math.min(10, maxChunks))]);
  const chunks = rows.map(r => ({ ...r, score: Number(r.score) }));
  return { matched: chunks.some(c => c.score >= Number(minScore)), chunks: chunks.filter(c => c.score >= Number(minScore)) };
}
function checksum(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
module.exports = { cleanText, chunkText, indexDocument, retrieve, checksum };
