// Centralised role → page-access map.
//
// Two roles ship today:
//   - admin     : full access (every page + Settings tabs, user management).
//   - bda_sales : "Sales" user — sees only their assigned chats/contacts.
// 'viewer' is kept as a legacy fallback.
//
// Page keys are stable strings used in three places:
//   - this map
//   - the frontend Sidebar / page guard
//   - server-side requirePermission(page) middleware
//
// "admin-settings:<tab>" entries gate individual tabs within Admin Settings.

const PAGES = [
  'home', 'chats', 'contacts', 'pipelines', 'bookings', 'tasks', 'bulk-message', 'template-builder',
  'chatbot-builder', 'media-library', 'about', 'venture-setup',
  'admin-settings:general', 'admin-settings:tags', 'admin-settings:category',
  'admin-settings:fields', 'admin-settings:whatsapp-accounts',
  'admin-settings:users',
];

const ROLE_PAGE_DEFAULTS = {
  admin: PAGES.slice(),           // everything
  bda_sales: [
    // Office sales team: everything needed to work their office's leads
    // end-to-end. Chats/contacts/pipelines are scoped to their granted
    // WhatsApp number(s); broadcasts are scoped by from-number (see broadcasts.js).
    'home', 'chats', 'contacts', 'pipelines', 'tasks',
    'bulk-message',      // send broadcasts (from their own number only)
    'bookings',          // book meetings / see appointments
    'template-builder',  // message templates for broadcasts
    'media-library',     // share images / video / documents
    'about',
    'admin-settings:general',     // only the General tab in user settings
  ],
  // Consultant: takes booked meetings and updates those customers in chat. Gets
  // chats/contacts, the bookings calendar, tasks, the media library (to share
  // brochures/documents on a call) and pipelines (to move a deal after a
  // consultation).
  consultant: [
    'home', 'chats', 'contacts', 'bookings', 'tasks',
    'media-library', 'pipelines', 'about',
    'admin-settings:general',
  ],
  // Team lead: a manager. Gets the full sales toolkit PLUS Automations, and (via
  // team_lead_members) sees every chat/contact visible to the users under them.
  // (AI Agents stays admin-only — its backend is adminOnly, so granting the page
  // would only show 403s; unlock it separately if a lead should manage agents.)
  team_lead: [
    'home', 'chats', 'contacts', 'pipelines', 'tasks',
    'bulk-message', 'bookings', 'template-builder', 'media-library',
    'chatbot-builder',            // Automations — set up auto-replies for the team
    'about',
    'admin-settings:general',
  ],
  viewer: ['home', 'about'],      // legacy fallback
};

// Returns the set of pages a user can access given their role plus any
// per-user grant/revoke overrides stored in users.permissions JSONB.
//   permissions = { grant: ["template-builder"], revoke: ["admin-settings:general"] }
function effectivePages(user) {
  const base = ROLE_PAGE_DEFAULTS[user?.role] || [];
  const overrides = user?.permissions || {};
  const grant = Array.isArray(overrides.grant) ? overrides.grant : [];
  const revoke = new Set(Array.isArray(overrides.revoke) ? overrides.revoke : []);
  const out = new Set(base);
  grant.forEach(p => out.add(p));
  revoke.forEach(p => out.delete(p));
  return out;
}

function hasPermission(user, page) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return effectivePages(user).has(page);
}

function isAdmin(user) {
  return user?.role === 'admin';
}

module.exports = {
  PAGES,
  ROLE_PAGE_DEFAULTS,
  effectivePages,
  hasPermission,
  isAdmin,
};
