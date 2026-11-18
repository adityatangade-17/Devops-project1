// Tasks — action items that can be created manually, from a chat, automatically
// by an AI agent during a conversation (source='ai'), or when a chat is handed
// to a human (source='handoff').
//
// Visibility follows the same access model as the rest of the app:
//   * admin      → every task
//   * team_lead  → tasks owned/created by them or their members
//   * everyone   → tasks assigned to or created by them
//
// createTask() is exported so the agent engine and the handoff flow can drop
// tasks without going through HTTP.

const { Router } = require('express');
const pool = require('../db');
const { effectiveUserIds } = require('../middleware/access');

const router = Router();

const STATUSES = new Set(['open', 'done', 'cancelled']);
const PRIORITIES = new Set(['low', 'normal', 'high']);
const SOURCES = new Set(['manual', 'ai', 'handoff', 'system']);

function taskShape(r) {
  return {
    id: r.id,
    title: r.title,
    description: r.description || '',
    status: r.status,
    priority: r.priority,
    assignedUserId: r.assigned_user_id,
    assignedUserName: r.assigned_user_name || null,
    createdBy: r.created_by,
    createdByName: r.created_by_name || null,
    waNumber: r.wa_number || null,
    contactNumber: r.contact_number || null,
    contactName: r.contact_name || null,
    dueAt: r.due_at,
    source: r.source,
    agentId: r.agent_id || null,
    completedAt: r.completed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const norm = (s) => (s == null ? null : String(s).replace(/\D/g, '') || null);

// Shared creator. Best-effort fills contact_name from the CRM when omitted.
// Never throws to the caller's critical path — returns the row or null.
async function createTask({
  title, description = null, assignedUserId = null, createdBy = null,
  waNumber = null, contactNumber = null, contactName = null, dueAt = null,
  priority = 'normal', source = 'manual', agentId = null,
}) {
  const t = String(title || '').trim();
  if (!t) throw new Error('Task title is required');
  const wa = norm(waNumber);
  const contact = norm(contactNumber);
  let name = contactName;
  if (!name && wa && contact) {
    try {
      const { rows } = await pool.query(
        `SELECT COALESCE(NULLIF(name,''), profile_name) AS n
           FROM coexistence.contacts WHERE wa_number = $1 AND contact_number = $2`,
        [wa, contact],
      );
      name = rows[0]?.n || null;
    } catch { /* non-fatal */ }
  }
  const { rows } = await pool.query(
    `INSERT INTO coexistence.tasks
       (title, description, status, priority, assigned_user_id, created_by,
        wa_number, contact_number, contact_name, due_at, source, agent_id)
     VALUES ($1,$2,'open',$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      t.slice(0, 300), description ? String(description).slice(0, 4000) : null,
      PRIORITIES.has(priority) ? priority : 'normal',
      assignedUserId || null, createdBy || null,
      wa, contact, name ? String(name).slice(0, 200) : null,
      dueAt || null, SOURCES.has(source) ? source : 'manual', agentId || null,
    ],
  );
  return rows[0];
}

// SELECT with joined assignee/creator display names.
const SELECT_WITH_NAMES = `
  SELECT t.*, au.display_name AS assigned_user_name, cu.display_name AS created_by_name
    FROM coexistence.tasks t
    LEFT JOIN coexistence.forgecrm_users au ON au.id = t.assigned_user_id
    LEFT JOIN coexistence.forgecrm_users cu ON cu.id = t.created_by`;

// GET /tasks?status=open&scope=mine|team&contactNumber=&waNumber=
router.get('/tasks', async (req, res) => {
  try {
    const isAdmin = req.user?.role === 'admin';
    const where = [];
    const params = [];
    let i = 1;

    if (!isAdmin) {
      const ids = await effectiveUserIds(req.user);
      const idList = ids.length ? ids : [-1];
      where.push(`(t.assigned_user_id = ANY($${i}::bigint[]) OR t.created_by = ANY($${i}::bigint[]))`);
      params.push(idList); i++;
    }
    // "mine" narrows an admin/team_lead view to just their own assigned tasks.
    if (req.query.scope === 'mine' && req.user?.id) {
      where.push(`t.assigned_user_id = $${i}`); params.push(req.user.id); i++;
    }
    if (req.query.status && STATUSES.has(req.query.status)) {
      where.push(`t.status = $${i}`); params.push(req.query.status); i++;
    }
    if (req.query.contactNumber) {
      where.push(`t.contact_number = $${i}`); params.push(norm(req.query.contactNumber)); i++;
    }
    if (req.query.waNumber) {
      where.push(`t.wa_number = $${i}`); params.push(norm(req.query.waNumber)); i++;
    }

    const sql = `${SELECT_WITH_NAMES}
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY (t.status = 'open') DESC,
               CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
               t.due_at ASC NULLS LAST, t.created_at DESC
      LIMIT 500`;
    const { rows } = await pool.query(sql, params);
    res.json(rows.map(taskShape));
  } catch (err) {
    console.error('[tasks] list error:', err.message);
    res.status(500).json({ error: 'Failed to list tasks' });
  }
});

// POST /tasks — manual creation (any authenticated user).
router.post('/tasks', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.title || !String(b.title).trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    const row = await createTask({
      title: b.title,
      description: b.description,
      assignedUserId: b.assignedUserId || req.user?.id || null,
      createdBy: req.user?.id || null,
      waNumber: b.waNumber,
      contactNumber: b.contactNumber,
      contactName: b.contactName,
      dueAt: b.dueAt || null,
      priority: b.priority,
      source: 'manual',
    });
    const { rows } = await pool.query(`${SELECT_WITH_NAMES} WHERE t.id = $1`, [row.id]);
    res.status(201).json(taskShape(rows[0]));
  } catch (err) {
    console.error('[tasks] create error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to create task' });
  }
});

// Can req.user modify this task? admin, creator, assignee, or team_lead over them.
async function canModify(user, task) {
  if (user?.role === 'admin') return true;
  const ids = await effectiveUserIds(user);
  return ids.includes(Number(task.assigned_user_id)) || ids.includes(Number(task.created_by));
}

// PATCH /tasks/:id — update status / fields / reassign.
router.patch('/tasks/:id', async (req, res) => {
  try {
    const { rows: existing } = await pool.query('SELECT * FROM coexistence.tasks WHERE id = $1', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Not found' });
    if (!(await canModify(req.user, existing[0]))) return res.status(403).json({ error: 'Not allowed' });

    const b = req.body || {};
    const sets = ['updated_at = NOW()'];
    const params = [];
    let i = 1;
    const push = (col, val) => { sets.push(`${col} = $${i++}`); params.push(val); };

    if (b.title !== undefined) push('title', String(b.title).trim().slice(0, 300));
    if (b.description !== undefined) push('description', b.description ? String(b.description).slice(0, 4000) : null);
    if (b.priority !== undefined && PRIORITIES.has(b.priority)) push('priority', b.priority);
    if (b.assignedUserId !== undefined) push('assigned_user_id', b.assignedUserId || null);
    if (b.dueAt !== undefined) push('due_at', b.dueAt || null);
    if (b.status !== undefined && STATUSES.has(b.status)) {
      push('status', b.status);
      push('completed_at', b.status === 'done' ? new Date().toISOString() : null);
    }
    params.push(req.params.id);
    await pool.query(`UPDATE coexistence.tasks SET ${sets.join(', ')} WHERE id = $${i}`, params);
    const { rows } = await pool.query(`${SELECT_WITH_NAMES} WHERE t.id = $1`, [req.params.id]);
    res.json(taskShape(rows[0]));
  } catch (err) {
    console.error('[tasks] update error:', err.message);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// DELETE /tasks/:id
router.delete('/tasks/:id', async (req, res) => {
  try {
    const { rows: existing } = await pool.query('SELECT * FROM coexistence.tasks WHERE id = $1', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Not found' });
    if (!(await canModify(req.user, existing[0]))) return res.status(403).json({ error: 'Not allowed' });
    await pool.query('DELETE FROM coexistence.tasks WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[tasks] delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

// Lightweight count for a badge (open tasks visible to the user).
router.get('/tasks/count', async (req, res) => {
  try {
    const isAdmin = req.user?.role === 'admin';
    let sql = `SELECT COUNT(*)::int AS c FROM coexistence.tasks t WHERE t.status = 'open'`;
    const params = [];
    if (!isAdmin) {
      const ids = await effectiveUserIds(req.user);
      sql += ` AND (t.assigned_user_id = ANY($1::bigint[]) OR t.created_by = ANY($1::bigint[]))`;
      params.push(ids.length ? ids : [-1]);
    }
    const { rows } = await pool.query(sql, params);
    res.json({ open: rows[0]?.c || 0 });
  } catch (err) {
    console.error('[tasks] count error:', err.message);
    res.status(500).json({ error: 'Failed to count tasks' });
  }
});

module.exports = { router, createTask };
