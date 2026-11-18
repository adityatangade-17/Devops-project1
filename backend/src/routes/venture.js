// Venture (company) setup — profile, offices and products/services collected by
// the New Venture Setup wizard. The profile also carries the wizard's progress
// (setup_step / setup_completed) so it can be resumed, and is later read by AI
// onboarding to generate business-specific agents.

const { Router } = require('express');
const pool = require('../db');
const { adminOnly } = require('../middleware/access');

const router = Router();

function profileShape(r) {
  return {
    companyName: r.company_name || '',
    legalName: r.legal_name || '',
    gstNumber: r.gst_number || '',
    businessType: r.business_type || '',
    sector: r.sector || '',
    description: r.description || '',
    website: r.website || '',
    teamSize: r.team_size || '',
    contactEmail: r.contact_email || '',
    contactPhone: r.contact_phone || '',
    setupCompleted: !!r.setup_completed,
    setupStep: r.setup_step || 0,
    updatedAt: r.updated_at,
  };
}
const officeShape = r => ({ id: r.id, name: r.name, city: r.city || '', address: r.address || '', phone: r.phone || '', waAccountId: r.wa_account_id || null });
const productShape = r => ({ id: r.id, name: r.name, kind: r.kind, description: r.description || '', priceText: r.price_text || '' });

const str = (v, n = 500) => (v == null ? null : String(v).trim().slice(0, n) || null);

/* ------------------------------- profile --------------------------------- */
// Readable by any authenticated user (the header/AI use the company name).
router.get('/venture/profile', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM coexistence.venture_profile WHERE id = 1');
    res.json(rows[0] ? profileShape(rows[0]) : profileShape({}));
  } catch (err) {
    console.error('[venture] profile get error:', err.message);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

router.put('/venture/profile', adminOnly, async (req, res) => {
  try {
    const b = req.body || {};
    const { rows } = await pool.query(
      `UPDATE coexistence.venture_profile SET
         company_name = COALESCE($1, company_name),
         legal_name   = COALESCE($2, legal_name),
         gst_number   = COALESCE($3, gst_number),
         business_type= COALESCE($4, business_type),
         sector       = COALESCE($5, sector),
         description  = COALESCE($6, description),
         website      = COALESCE($7, website),
         team_size    = COALESCE($8, team_size),
         contact_email= COALESCE($9, contact_email),
         contact_phone= COALESCE($10, contact_phone),
         setup_step   = GREATEST(setup_step, COALESCE($11, setup_step)),
         setup_completed = COALESCE($12, setup_completed),
         updated_at = NOW()
       WHERE id = 1
       RETURNING *`,
      [
        b.companyName !== undefined ? str(b.companyName, 200) : null,
        b.legalName !== undefined ? str(b.legalName, 200) : null,
        b.gstNumber !== undefined ? str(b.gstNumber, 40) : null,
        b.businessType !== undefined ? str(b.businessType, 80) : null,
        b.sector !== undefined ? str(b.sector, 120) : null,
        b.description !== undefined ? str(b.description, 4000) : null,
        b.website !== undefined ? str(b.website, 300) : null,
        b.teamSize !== undefined ? str(b.teamSize, 40) : null,
        b.contactEmail !== undefined ? str(b.contactEmail, 200) : null,
        b.contactPhone !== undefined ? str(b.contactPhone, 40) : null,
        b.setupStep !== undefined ? parseInt(b.setupStep, 10) || 0 : null,
        b.setupCompleted !== undefined ? !!b.setupCompleted : null,
      ],
    );
    res.json(profileShape(rows[0]));
  } catch (err) {
    console.error('[venture] profile update error:', err.message);
    res.status(500).json({ error: 'Failed to save profile' });
  }
});

/* ------------------------------- offices --------------------------------- */
router.get('/venture/offices', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM coexistence.venture_offices ORDER BY id');
    res.json(rows.map(officeShape));
  } catch (err) {
    console.error('[venture] offices get error:', err.message);
    res.status(500).json({ error: 'Failed to load offices' });
  }
});

router.post('/venture/offices', adminOnly, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Office name is required' });
    const { rows } = await pool.query(
      `INSERT INTO coexistence.venture_offices (name, city, address, phone, wa_account_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [str(b.name, 200), str(b.city, 120), str(b.address, 400), str(b.phone, 40), b.waAccountId ? parseInt(b.waAccountId, 10) : null],
    );
    res.status(201).json(officeShape(rows[0]));
  } catch (err) {
    console.error('[venture] office create error:', err.message);
    res.status(500).json({ error: 'Failed to add office' });
  }
});

router.delete('/venture/offices/:id', adminOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM coexistence.venture_offices WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[venture] office delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete office' });
  }
});

/* ------------------------------ products --------------------------------- */
router.get('/venture/products', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM coexistence.venture_products ORDER BY id');
    res.json(rows.map(productShape));
  } catch (err) {
    console.error('[venture] products get error:', err.message);
    res.status(500).json({ error: 'Failed to load products' });
  }
});

router.post('/venture/products', adminOnly, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Name is required' });
    const { rows } = await pool.query(
      `INSERT INTO coexistence.venture_products (name, kind, description, price_text)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [str(b.name, 200), b.kind === 'product' ? 'product' : 'service', str(b.description, 1000), str(b.priceText, 120)],
    );
    res.status(201).json(productShape(rows[0]));
  } catch (err) {
    console.error('[venture] product create error:', err.message);
    res.status(500).json({ error: 'Failed to add item' });
  }
});

router.delete('/venture/products/:id', adminOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM coexistence.venture_products WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[venture] product delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

module.exports = { router };
