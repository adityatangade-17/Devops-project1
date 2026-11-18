const { Router } = require('express');
const pool = require('../db');
const { requirePermission } = require('../middleware/access');

const router = Router();

// Custom contact field definitions. The owner defines fields here (Settings →
// Fields); contacts can then carry a value per field (stored in
// coexistence.contacts.custom_fields JSONB, keyed by field id).

const FIELD_TYPES = ['text', 'number', 'phone', 'email', 'date', 'url', 'textarea', 'select'];

function genId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function normType(t) {
  return FIELD_TYPES.includes(t) ? t : 'text';
}

// Sanitise the dropdown options list: array of non-empty trimmed strings,
// de-duplicated, capped at 50. Anything else collapses to an empty list.
function normOptions(opts) {
  if (!Array.isArray(opts)) return [];
  const seen = new Set();
  const out = [];
  for (const o of opts) {
    const s = String(o ?? '').trim();
    if (s && !seen.has(s)) { seen.add(s); out.push(s.slice(0, 100)); }
    if (out.length >= 50) break;
  }
  return out;
}

// GET /api/contact-fields — list all field definitions (sorted)
router.get('/contact-fields', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, description, field_type, options, sort_order, created_at, updated_at
       FROM coexistence.contact_field_definitions
       ORDER BY sort_order ASC, name ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error('[contactFields] GET error:', err.message);
    res.status(500).json({ error: 'Failed to fetch contact fields' });
  }
});

// POST /api/contact-fields — create a field definition
router.post('/contact-fields', requirePermission('admin-settings:fields'), async (req, res) => {
  try {
    const { name, description, fieldType, sortOrder, options } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Field name is required' });
    }
    const type = normType(fieldType);
    const opts = type === 'select' ? normOptions(options) : [];
    if (type === 'select' && opts.length === 0) {
      return res.status(400).json({ error: 'A dropdown field needs at least one option' });
    }
    const id = genId('fld');
    const { rows } = await pool.query(
      `INSERT INTO coexistence.contact_field_definitions
         (id, name, description, field_type, options, sort_order)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       RETURNING id, name, description, field_type, options, sort_order, created_at, updated_at`,
      [id, name.trim(), (description || '').trim() || null, type, JSON.stringify(opts), Number.isFinite(+sortOrder) ? +sortOrder : 0]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[contactFields] POST error:', err.message);
    res.status(500).json({ error: 'Failed to create contact field' });
  }
});

// PUT /api/contact-fields/:id — update a field definition
router.put('/contact-fields/:id', requirePermission('admin-settings:fields'), async (req, res) => {
  try {
    const { name, description, fieldType, sortOrder, options } = req.body || {};
    if (name !== undefined && (!name || !name.trim())) {
      return res.status(400).json({ error: 'Field name cannot be empty' });
    }
    // options: only touch when provided. Pass NULL to leave existing untouched.
    const optsJson = options !== undefined ? JSON.stringify(normOptions(options)) : null;
    const { rows } = await pool.query(
      `UPDATE coexistence.contact_field_definitions SET
         name        = COALESCE($2, name),
         description  = $3,
         field_type   = COALESCE($4, field_type),
         options      = COALESCE($5::jsonb, options),
         sort_order   = COALESCE($6, sort_order),
         updated_at   = NOW()
       WHERE id = $1
       RETURNING id, name, description, field_type, options, sort_order, created_at, updated_at`,
      [
        req.params.id,
        name !== undefined ? name.trim() : null,
        description !== undefined ? ((description || '').trim() || null) : null,
        fieldType !== undefined ? normType(fieldType) : null,
        optsJson,
        sortOrder !== undefined && Number.isFinite(+sortOrder) ? +sortOrder : null,
      ]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Field not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[contactFields] PUT error:', err.message);
    res.status(500).json({ error: 'Failed to update contact field' });
  }
});

// DELETE /api/contact-fields/:id — remove a field definition
router.delete('/contact-fields/:id', requirePermission('admin-settings:fields'), async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM coexistence.contact_field_definitions WHERE id = $1`,
      [req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Field not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[contactFields] DELETE error:', err.message);
    res.status(500).json({ error: 'Failed to delete contact field' });
  }
});

module.exports = { router };
