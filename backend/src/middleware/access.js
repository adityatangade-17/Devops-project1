// Role / permission enforcement and audit logging.
//
// The JWT only carries { id, username, displayName, role } — for permission
// checks against the optional per-user overrides we re-load the row.

const pool = require('../db');
const { isAdmin, hasPermission } = require('../permissions');

// adminOnly: simple gate on req.user.role
function adminOnly(req, res, next) {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// requirePermission(page): gates a route on whether the current user can
// reach `page`. Loads the user row fresh so per-user overrides are honoured.
function requirePermission(page) {
  return async (req, res, next) => {
    try {
      if (isAdmin(req.user)) return next();
      const { rows } = await pool.query(
        `SELECT role, permissions FROM coexistence.forgecrm_users WHERE id = $1`,
        [req.user.id]
      );
      const u = rows[0];
      if (!u) return res.status(401).json({ error: 'User not found' });
      if (!hasPermission({ role: u.role, permissions: u.permissions }, page)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      next();
    } catch (err) {
      console.error('[access] requirePermission error:', err.message);
      res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

// Look up the WA numbers a user is allowed to see. Admin gets null
// (meaning "no scoping needed"). Non-admins get the array — may be empty.
async function userWaNumbers(userId) {
  const { rows } = await pool.query(
    `SELECT wa_number FROM coexistence.user_wa_assignments WHERE user_id = $1`,
    [userId]
  );
  return rows.map(r => r.wa_number);
}

// The set of users whose visibility `user` inherits: themselves, plus — for a
// team lead — every member assigned under them (team_lead_members). This is how
// a team lead automatically sees all of their team's chats/contacts.
async function effectiveUserIds(user) {
  const self = user?.id;
  if (!self) return [];
  if (user.role !== 'team_lead') return [Number(self)];
  const { rows } = await pool.query(
    `SELECT member_id FROM coexistence.team_lead_members WHERE lead_id = $1`, [self]
  );
  return [Number(self), ...rows.map(r => Number(r.member_id))];
}

// Union of WhatsApp numbers (user_wa_assignments) granted to any effective user.
// Digits-only, so it compares cleanly against stored numbers.
async function effectiveWaNumbers(user) {
  const ids = await effectiveUserIds(user);
  if (ids.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT DISTINCT wa_number FROM coexistence.user_wa_assignments WHERE user_id = ANY($1::bigint[])`, [ids]
  );
  return rows.map(r => String(r.wa_number).replace(/\D/g, ''));
}

// Build a SQL fragment + params to scope a query to "rows visible to req.user".
// Used by read endpoints (messages, contacts, numbers). The fragment is a
// boolean expression; the caller injects it into their WHERE.
//
//   const scope = await buildWaScope(req, '{table_alias}', paramIndex);
//   if (scope.sql) { whereClauses.push(scope.sql); params.push(...scope.params); }
//
// `tableAlias.wa_number` and `tableAlias.contact_number` must exist on the
// table being scoped (true for chat_history, contacts, and the derived
// messages/numbers/contact-names queries).
//
// Returns { sql, params }. `sql` is empty string when scoping is unnecessary
// (admin, or non-scopable route).
async function buildWaScope(req, tableAlias, startParamIndex) {
  if (isAdmin(req.user)) return { sql: '', params: [] };
  const waNumbers = await userWaNumbers(req.user.id);
  if (waNumbers.length === 0) {
    // BDA with no assignments → see nothing
    return { sql: 'FALSE', params: [] };
  }
  // Scope: row's wa_number is in the user's list,
  //   OR the contact has an explicit assigned_user_id matching this user
  //      (handled via subquery against the contacts table).
  const waParam = `$${startParamIndex}`;
  const userParam = `$${startParamIndex + 1}`;
  const sql = `(
    ${tableAlias}.wa_number = ANY(${waParam}::text[])
    OR EXISTS (
      SELECT 1 FROM coexistence.contacts c
       WHERE c.wa_number = ${tableAlias}.wa_number
         AND c.contact_number = ${tableAlias}.contact_number
         AND c.assigned_user_id = ${userParam}
    )
  )`;
  return { sql, params: [waNumbers, req.user.id] };
}

// Convenience: assert the current user has access to a specific wa_number.
// Admin always passes. A non-admin passes if EITHER:
//   * the wa_number is granted to them via user_wa_assignments (franchise /
//     office model — the whole number's inbox is theirs), OR
//   * they have at least one contact assigned to them on this number (legacy
//     per-rep assignment, for users with no explicit number grants).
async function assertWaAccess(req, res, waNumber) {
  if (isAdmin(req.user)) return true;
  const clean = String(waNumber || '').replace(/\D/g, '');
  const ids = await effectiveUserIds(req.user);
  const nums = await effectiveWaNumbers(req.user);
  if (nums.includes(clean)) return true;
  const { rows } = await pool.query(
    `SELECT 1 FROM coexistence.contacts
      WHERE wa_number = $1 AND assigned_user_id = ANY($2::bigint[]) LIMIT 1`,
    [clean, ids]
  );
  if (rows.length) return true;
  const { rows: shared } = await pool.query(
    `SELECT 1 FROM coexistence.contact_user_access
      WHERE wa_number = $1 AND user_id = ANY($2::bigint[]) LIMIT 1`,
    [clean, ids]
  );
  if (shared.length) return true;
  res.status(403).json({ error: 'You do not have access to this WhatsApp number' });
  return false;
}

// Per-conversation access. Admin bypasses. A non-admin passes if the
// conversation's wa_number is granted to them (office model → every conversation
// on that number is visible), OR the specific contact is assigned to them
// (legacy per-rep model).
async function assertContactAccess(req, res, waNumber, contactNumber) {
  if (isAdmin(req.user)) return true;
  const cleanWa = String(waNumber || '').replace(/\D/g, '');
  const cleanContact = String(contactNumber || '').replace(/\D/g, '');
  const ids = await effectiveUserIds(req.user);
  const nums = await effectiveWaNumbers(req.user);
  if (nums.includes(cleanWa)) return true; // office access → every chat on the number
  const { rows } = await pool.query(
    `SELECT 1 FROM coexistence.contacts
      WHERE wa_number = $1 AND contact_number = $2 AND assigned_user_id = ANY($3::bigint[]) LIMIT 1`,
    [cleanWa, cleanContact, ids]
  );
  if (rows.length) return true;
  // Shared access (e.g. a consultant booked with this customer).
  const { rows: shared } = await pool.query(
    `SELECT 1 FROM coexistence.contact_user_access
      WHERE wa_number = $1 AND contact_number = $2 AND user_id = ANY($3::bigint[]) LIMIT 1`,
    [cleanWa, cleanContact, ids]
  );
  if (shared.length) return true;
  res.status(403).json({ error: 'You do not have access to this conversation' });
  return false;
}

// Append-only audit log of admin-sensitive actions.
async function auditLog({ actor, action, targetType = null, targetId = null, payload = null }) {
  try {
    await pool.query(
      `INSERT INTO coexistence.user_audit_log
         (actor_user_id, actor_username, action, target_type, target_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        actor?.id || null,
        actor?.username || null,
        action,
        targetType,
        targetId != null ? String(targetId) : null,
        payload ? JSON.stringify(payload) : null,
      ]
    );
  } catch (err) {
    // Audit logging must never break the calling request
    console.error('[audit] write failed:', err.message);
  }
}

module.exports = {
  adminOnly,
  requirePermission,
  userWaNumbers,
  effectiveUserIds,
  effectiveWaNumbers,
  buildWaScope,
  assertWaAccess,
  assertContactAccess,
  auditLog,
};
