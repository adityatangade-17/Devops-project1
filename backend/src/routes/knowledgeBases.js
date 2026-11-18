const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const ExcelJS = require('exceljs');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const pool = require('../db');
const storage = require('../util/pgStorage');
const { adminOnly } = require('../middleware/access');
const { cleanText, indexDocument, checksum } = require('../services/knowledgeBase');

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const allowed = new Set(['.pdf', '.docx', '.txt', '.md', '.csv', '.xlsx']);

async function extractText(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (ext === '.txt' || ext === '.md' || ext === '.csv') return file.buffer.toString('utf8');
  if (ext === '.pdf') return (await pdf(file.buffer)).text;
  if (ext === '.docx') return (await mammoth.extractRawText({ buffer: file.buffer })).value;
  if (ext === '.xlsx') {
    const book = new ExcelJS.Workbook(); await book.xlsx.load(file.buffer);
    return book.worksheets.map(ws => ws.getSheetValues().map(r => r.slice(1).join(' | ')).join('\n')).join('\n\n');
  }
  throw new Error('Unsupported document format. Upload PDF, DOCX, TXT, MD, CSV, or XLSX.');
}

router.get('/knowledge-bases', adminOnly, async (_req, res) => {
  const { rows } = await pool.query(`SELECT b.*, COUNT(d.id)::int AS document_count,
    COUNT(d.id) FILTER (WHERE d.status='ready')::int AS ready_document_count
    FROM coexistence.knowledge_bases b LEFT JOIN coexistence.knowledge_documents d ON d.knowledge_base_id=b.id
    GROUP BY b.id ORDER BY b.sector, b.name`);
  res.json(rows.map(r => ({ id:r.id, name:r.name, sector:r.sector, description:r.description, isActive:r.is_active, documentCount:r.document_count, readyDocumentCount:r.ready_document_count })));
});
router.post('/knowledge-bases', adminOnly, async (req, res) => {
  const { name, sector = 'General', description = '' } = req.body || {};
  if (!String(name || '').trim()) return res.status(400).json({ error: 'Knowledge base name is required.' });
  const { rows } = await pool.query(`INSERT INTO coexistence.knowledge_bases(name,sector,description,created_by) VALUES($1,$2,$3,$4) RETURNING *`, [name.trim(), String(sector).trim() || 'General', String(description).trim() || null, req.user.id]);
  res.status(201).json(rows[0]);
});
router.put('/knowledge-bases/:id', adminOnly, async (req, res) => {
  const b=req.body||{}; const { rows } = await pool.query(`UPDATE coexistence.knowledge_bases SET name=COALESCE($1,name), sector=COALESCE($2,sector), description=COALESCE($3,description), is_active=COALESCE($4,is_active), updated_at=NOW() WHERE id=$5 RETURNING *`, [b.name?.trim()||null,b.sector?.trim()||null,b.description?.trim()||null,b.isActive===undefined?null:!!b.isActive,req.params.id]);
  if (!rows[0]) return res.status(404).json({ error:'Knowledge base not found.' }); res.json(rows[0]);
});
router.get('/knowledge-bases/:id/documents', adminOnly, async (req,res) => {
  const { rows } = await pool.query('SELECT id,title,original_name,mime_type,status,error_message,chunk_count,created_at FROM coexistence.knowledge_documents WHERE knowledge_base_id=$1 ORDER BY created_at DESC',[req.params.id]); res.json(rows);
});
router.post('/knowledge-bases/:id/documents', adminOnly, upload.single('file'), async (req,res) => {
  try {
    if (!req.file) return res.status(400).json({error:'Choose a document to upload.'});
    if (!allowed.has(path.extname(req.file.originalname).toLowerCase())) return res.status(400).json({error:'Unsupported document format.'});
    const base = await pool.query('SELECT id FROM coexistence.knowledge_bases WHERE id=$1 AND is_active=TRUE',[req.params.id]);
    if (!base.rows[0]) return res.status(404).json({error:'Active knowledge base not found.'});
    const sha=checksum(req.file.buffer); const key=`knowledge/${req.params.id}/${Date.now()}-${sha.slice(0,12)}-${path.basename(req.file.originalname).replace(/[^a-zA-Z0-9._-]/g,'_')}`;
    await storage.ensureBucket(); await storage.putObject(key,req.file.buffer,req.file.mimetype);
    const { rows }=await pool.query(`INSERT INTO coexistence.knowledge_documents(knowledge_base_id,title,original_name,mime_type,storage_key,sha256,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[req.params.id,req.body?.title?.trim()||req.file.originalname,req.file.originalname,req.file.mimetype,key,sha,req.user.id]);
    const doc=rows[0];
    try { await indexDocument({documentId:doc.id,text:cleanText(await extractText(req.file))}); }
    catch(e){ await pool.query("UPDATE coexistence.knowledge_documents SET status='failed', error_message=$2, updated_at=NOW() WHERE id=$1",[doc.id,String(e.message).slice(0,1000)]); }
    const fresh=await pool.query('SELECT id,title,original_name,mime_type,status,error_message,chunk_count,created_at FROM coexistence.knowledge_documents WHERE id=$1',[doc.id]); res.status(201).json(fresh.rows[0]);
  } catch(e) { console.error('[knowledge-bases] upload:',e.message); res.status(500).json({error:e.message||'Could not process document.'}); }
});
router.delete('/knowledge-bases/:baseId/documents/:documentId', adminOnly, async(req,res)=>{ const { rows }=await pool.query('DELETE FROM coexistence.knowledge_documents WHERE id=$1 AND knowledge_base_id=$2 RETURNING storage_key',[req.params.documentId,req.params.baseId]); if(!rows[0]) return res.status(404).json({error:'Document not found.'}); await storage.removeObject(rows[0].storage_key); res.json({ok:true}); });
module.exports = { router };
