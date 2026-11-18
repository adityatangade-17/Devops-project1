const { Router } = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const pool = require('../db');
const { resolveAccount, insertPendingRow, secondsSinceLastIncoming } = require('../services/messageSender');
const { enqueueSend } = require('../queue/sendQueue');
const { uploadMedia } = require('../integrations/metaSend');
const { markAccountHealth, classifyMetaError } = require('../services/accountHealth');
const storage = require('../util/pgStorage');
const { syncMediaToAccount } = require('./mediaLibrary');
const { assertWaAccess, assertContactAccess, effectiveUserIds, effectiveWaNumbers } = require('../middleware/access');
const { isAdmin } = require('../permissions');
const { canonicalizeMime, chatKindFor, CHAT_TYPES_MSG } = require('../util/metaMime');
const ExcelJS = require('exceljs');
const { Readable } = require('stream');

const pexecFile = promisify(execFile);
const MEDIA_DIR = process.env.MEDIA_DIR || '/app/media';
const MAX_CONTACT_IMPORT_ROWS = 10000;

/**
 * A quote-reply's context message id is only valid to Meta if it's a real
 * Meta wamid. Optimistic rows still carry a local-/tmp- id (the message hasn't
 * been accepted by Meta yet) — quoting those would make Meta reject the send,
 * so we drop them and send without the quote rather than fail.
 */
function sanitizeContextId(id) {
  if (!id || typeof id !== 'string') return null;
  if (id.startsWith('local-') || id.startsWith('tmp-')) return null;
  return id;
}
const META_AUDIO_TYPES = new Set(['audio/aac', 'audio/mp4', 'audio/amr', 'audio/mpeg', 'audio/ogg']);

/**
 * Transcode browser audio (typically webm/opus) to Meta-accepted ogg/opus.
 * Returns { buffer, mime, ext }.
 */
async function transcodeAudioForMeta(srcBuffer, srcMime) {
  // Guard against an empty / truncated recording before shelling out to ffmpeg —
  // otherwise ffmpeg fails with a cryptic "End of file" / invalid-EBML error.
  if (!srcBuffer || srcBuffer.length === 0) {
    throw new Error('The recording was empty. Please record again before sending.');
  }
  // Strip any codecs parameter (e.g. "audio/webm;codecs=opus") before matching.
  const baseMime = String(srcMime || '').split(';')[0].trim().toLowerCase();
  if (META_AUDIO_TYPES.has(baseMime)) {
    return { buffer: srcBuffer, mime: baseMime, ext: baseMime === 'audio/mpeg' ? 'mp3' : baseMime.split('/')[1] };
  }
  // Write source to a temp file, transcode to ogg/opus
  const tmpIn = `/tmp/audio-in-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const tmpOut = `${tmpIn}.ogg`;
  fs.writeFileSync(tmpIn, srcBuffer);
  try {
    await pexecFile('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-i', tmpIn,
      '-vn', '-c:a', 'libopus', '-b:a', '64k',
      tmpOut,
    ], { timeout: 30_000 });
    const buf = fs.readFileSync(tmpOut);
    if (!buf || buf.length === 0) throw new Error('Transcoded audio was empty.');
    return { buffer: buf, mime: 'audio/ogg', ext: 'ogg' };
  } finally {
    try { fs.unlinkSync(tmpIn); } catch {}
    try { fs.unlinkSync(tmpOut); } catch {}
  }
}

/**
 * Compress an oversized video down to WhatsApp's 16MB limit with ffmpeg. Targets
 * a total bitrate computed from the clip's duration (so the output lands under
 * ~15MB), caps resolution at 720p, and re-encodes to H.264/AAC MP4 — the most
 * broadly WhatsApp-compatible format. Returns { buffer, mime, ext }.
 */
async function compressVideoForMeta(srcBuffer) {
  if (!srcBuffer || srcBuffer.length === 0) throw new Error('The video was empty.');
  const TARGET_BYTES = 15 * 1024 * 1024; // safety margin under the 16MB cap
  const AUDIO_KBPS = 128;
  const tmpIn = `/tmp/vid-in-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpOut = `${tmpIn}.mp4`;
  fs.writeFileSync(tmpIn, srcBuffer);
  try {
    // Probe duration to size the bitrate; fall back to a safe default if unknown.
    let duration = 0;
    try {
      const { stdout } = await pexecFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', tmpIn]);
      duration = parseFloat(String(stdout).trim()) || 0;
    } catch { /* ffprobe missing / unreadable — use fallback bitrate */ }
    let videoKbps = 1200;
    if (duration > 1) {
      const totalKbps = (TARGET_BYTES * 8) / duration / 1000;
      videoKbps = Math.max(250, Math.floor(totalKbps - AUDIO_KBPS));
    }
    await pexecFile('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', tmpIn,
      '-c:v', 'libx264', '-preset', 'veryfast',
      '-b:v', `${videoKbps}k`, '-maxrate', `${Math.floor(videoKbps * 1.45)}k`, '-bufsize', `${videoKbps * 2}k`,
      // Cap the longest side at ~1280px, keep aspect ratio, keep dimensions even.
      '-vf', "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))'",
      '-c:a', 'aac', '-b:a', `${AUDIO_KBPS}k`,
      '-movflags', '+faststart',
      tmpOut,
    ], { maxBuffer: 64 * 1024 * 1024 });
    const out = fs.readFileSync(tmpOut);
    if (!out || out.length === 0) throw new Error('Video compression produced an empty file.');
    return { buffer: out, mime: 'video/mp4', ext: 'mp4' };
  } finally {
    try { fs.unlinkSync(tmpIn); } catch {}
    try { fs.unlinkSync(tmpOut); } catch {}
  }
}

/**
 * Mirror an outbound media file to /app/media so the chat bubble can render
 * the thumbnail/playback via the existing /api/media/:messageId proxy.
 * Path layout matches inbound: <wa>/<yyyymm>/<msgid>.<ext>
 */
function persistOutboundMedia({ accountPhoneDigits, messageId, buffer, ext }) {
  const ym = `${new Date().getUTCFullYear()}${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`;
  const dir = path.join(MEDIA_DIR, accountPhoneDigits || 'unknown', ym);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filename = `${String(messageId).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200)}.${ext || 'bin'}`;
  const absPath = path.join(dir, filename);
  fs.writeFileSync(absPath, buffer);
  return { absPath, size: buffer.length };
}

const router = Router();
const SERVICE_WINDOW_SECONDS = 24 * 3600;

// Multipart parser for chat media. WhatsApp caps are 5MB image / 16MB video /
// 16MB audio / 100MB document. We accept up to 100MB so an oversized VIDEO can
// be auto-compressed down to the 16MB video limit before sending (see
// compressVideoForMeta); other types over their WhatsApp cap are rejected by Meta.
const WA_VIDEO_LIMIT_BYTES = 16 * 1024 * 1024;
const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

// Multipart parser for the contacts-import sheet (.csv / .xlsx, up to 5MB).
const sheetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Header alias matching for the import sheet — header names are normalised to
// [a-z0-9] (case/punctuation-insensitive) before lookup.
const IMPORT_NAME_ALIASES = new Set(['name', 'fullname', 'contactname', 'customername']);
const IMPORT_PHONE_ALIASES = new Set([
  'phone', 'phonenumber', 'phoneno', 'mobile', 'mobilenumber', 'mobileno',
  'whatsapp', 'whatsappnumber', 'contactnumber', 'number', 'msisdn',
]);
function pickImportColumn(row, aliases) {
  for (const key of Object.keys(row)) {
    const norm = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (aliases.has(norm)) return row[key];
  }
  return undefined;
}

// Read a .csv/.xlsx upload into an array of header-keyed row objects (like the
// old SheetJS sheet_to_json output), using exceljs — which, unlike xlsx@0.18.5,
// has no known prototype-pollution / ReDoS advisories. The first non-empty row
// is treated as the header.
function cellToString(v) {
  if (v == null) return '';
  if (typeof v === 'object') return String(v.text ?? v.result ?? v.hyperlink ?? '').trim();
  return String(v).trim();
}
async function parseSheetRows(file) {
  const wb = new ExcelJS.Workbook();
  const name = (file.originalname || '').toLowerCase();
  const isCsv = name.endsWith('.csv') || file.mimetype === 'text/csv';
  let ws;
  if (isCsv) {
    ws = await wb.csv.read(Readable.from(file.buffer));
  } else {
    await wb.xlsx.load(file.buffer);
    ws = wb.worksheets[0];
  }
  if (!ws) throw new Error('empty workbook');
  const rows = [];
  let headers = null;
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = row.values; // 1-indexed; vals[0] is undefined
    if (!headers) {
      headers = vals.map(cellToString);
      return;
    }
    const obj = {};
    for (let i = 1; i < headers.length; i++) {
      if (!headers[i]) continue;
      obj[headers[i]] = cellToString(vals[i]);
    }
    rows.push(obj);
  });
  return rows;
}

const DEFAULT_DATA_WINDOW = "INTERVAL '14 days'";

function timeRangeToInterval(range) {
  const map = {
    '1h': "INTERVAL '1 hour'",
    '6h': "INTERVAL '6 hours'",
    '24h': "INTERVAL '24 hours'",
    '7d': "INTERVAL '7 days'",
    '14d': "INTERVAL '14 days'",
    '30d': "INTERVAL '30 days'",
    '90d': "INTERVAL '90 days'",
    '180d': "INTERVAL '180 days'",
    '1y': "INTERVAL '365 days'",
  };
  return map[range] || null;
}

// Build a "AND <col> >= NOW() - INTERVAL" fragment from a ?timeRange= value.
//   * 'all'  -> no time filter (show full history).
//   * known range -> that window.
//   * anything else -> `fallback` (a SQL interval literal, or null for none).
// Returns '' when there should be no time filter.
function timeWindowClause(range, col, fallback = DEFAULT_DATA_WINDOW) {
  if (range === 'all') return '';
  const interval = timeRangeToInterval(range) || fallback;
  return interval ? `AND ${col} >= NOW() - ${interval}` : '';
}

// GET /api/numbers
router.get('/numbers', async (req, res) => {
  try {
    // BDA visibility: a wa_number is visible only if the user has at least
    // one contact assigned to them on that number. Admin sees everything.
    // Default to the full history so a connected number with only older activity
    // still appears in the picker; the connected-accounts filter below is the
    // real gate. Callers may narrow with ?timeRange=.
    const timeRange = req.query.timeRange || 'all';
    // Numbers this user (and, for a team lead, their members) can see. Empty for
    // admins (they see all).
    const granted = isAdmin(req.user) ? [] : await effectiveWaNumbers(req.user);
    const effIds = isAdmin(req.user) ? [] : await effectiveUserIds(req.user);
    let extraFilter = '';
    const params = [];
    if (!isAdmin(req.user)) {
      // A non-admin sees numbers granted to them (office model) plus any number
      // where they/their team own an assigned or shared contact.
      params.push(granted);
      const gParam = params.length;
      params.push(effIds);
      const uParam = params.length;
      extraFilter = `AND (
        wa_number = ANY($${gParam}::text[])
        OR wa_number IN (SELECT DISTINCT wa_number FROM coexistence.contacts WHERE assigned_user_id = ANY($${uParam}::bigint[]))
        OR wa_number IN (SELECT DISTINCT wa_number FROM coexistence.contact_user_access WHERE user_id = ANY($${uParam}::bigint[]))
      )`;
    }
    const { rows } = await pool.query(`
      SELECT
        wa_number,
        MAX(timestamp) AS last_message_time,
        COUNT(*) AS message_count
      FROM coexistence.chat_history
      WHERE 1=1 ${timeWindowClause(timeRange, 'timestamp')} ${extraFilter}
        -- Only surface numbers that are still connected WhatsApp accounts, so
        -- data from a previously-connected number (after the account is edited
        -- to a new number or removed) stops showing. The rows stay in the DB —
        -- this just hides orphaned numbers from the picker. Digits-only match
        -- tolerates '+'/spaces in stored display_phone_number.
        AND regexp_replace(wa_number, '[^0-9]', '', 'g') IN (
          SELECT regexp_replace(display_phone_number, '[^0-9]', '', 'g')
          FROM coexistence.whatsapp_accounts
          WHERE display_phone_number IS NOT NULL
        )
      GROUP BY wa_number
      ORDER BY last_message_time DESC
    `, params);

    // Unread chats per wa_number = conversations with >=1 incoming message newer
    // than last_read_at. Respects the same BDA visibility scoping as above.
    const unreadParams = [];
    let unreadJoin = '';
    let unreadAssign = '';
    if (!isAdmin(req.user)) {
      unreadParams.push(granted);
      const gp = unreadParams.length;
      unreadParams.push(effIds);
      const up = unreadParams.length;
      // LEFT JOIN so granted-number chats without an assigned contact still count.
      unreadJoin = `LEFT JOIN coexistence.contacts c
        ON c.wa_number = ch.wa_number AND c.contact_number = ch.contact_number`;
      unreadAssign = `AND (
        ch.wa_number = ANY($${gp}::text[])
        OR c.assigned_user_id = ANY($${up}::bigint[])
        OR EXISTS (SELECT 1 FROM coexistence.contact_user_access cua
                    WHERE cua.wa_number = ch.wa_number AND cua.contact_number = ch.contact_number
                      AND cua.user_id = ANY($${up}::bigint[]))
      )`;
    }
    const unreadRes = await pool.query(`
      SELECT ch.wa_number, COUNT(DISTINCT ch.contact_number) AS unread_chats
      FROM coexistence.chat_history ch
      LEFT JOIN coexistence.conversation_reads cr
        ON cr.wa_number = ch.wa_number AND cr.contact_number = ch.contact_number
      ${unreadJoin}
      WHERE ch.direction = 'incoming'
        ${timeWindowClause(timeRange, 'ch.timestamp')}
        AND ch.timestamp > COALESCE(cr.last_read_at, 'epoch'::timestamptz)
        ${unreadAssign}
      GROUP BY ch.wa_number
    `, unreadParams);
    const unreadMap = {};
    for (const r of unreadRes.rows) unreadMap[r.wa_number] = Number(r.unread_chats) || 0;

    // Enrich with display name + team-member data. Two bulk queries for the
    // whole set instead of two per row (was an N+1: 2*N round-trips).
    const waNumbers = rows.map(r => r.wa_number);
    const nameMap = {};
    const teamMap = {};
    if (waNumbers.length > 0) {
      const normWa = waNumbers.map(w => String(w).replace(/\D/g, ''));
      const [nameRes, teamRes] = await Promise.all([
        // The "self" contact (contact_number == wa_number) carries the number's
        // display name.
        pool.query(
          `SELECT wa_number, COALESCE(name, profile_name) AS name
             FROM coexistence.contacts
            WHERE contact_number = wa_number AND wa_number = ANY($1::text[])`,
          [waNumbers]
        ),
        // Match team members by digits-only phone number (covers '+'/exact/raw).
        pool.query(
          `SELECT name, profile_picture_url,
                  regexp_replace(phone_number, '[^0-9]', '', 'g') AS norm
             FROM coexistence.team_members
            WHERE regexp_replace(phone_number, '[^0-9]', '', 'g') = ANY($1::text[])`,
          [normWa]
        ),
      ]);
      for (const r of nameRes.rows) nameMap[r.wa_number] = r.name;
      // Keep the first match per normalized number (preserves prior LIMIT 1 behaviour).
      for (const r of teamRes.rows) if (!(r.norm in teamMap)) teamMap[r.norm] = r;
    }
    const enriched = rows.map((row) => {
      const teamMember = teamMap[String(row.wa_number).replace(/\D/g, '')];
      return {
        ...row,
        display_name: teamMember?.name || nameMap[row.wa_number] || null,
        profile_picture_url: teamMember?.profile_picture_url || null,
        unread_chats: unreadMap[row.wa_number] || 0,
      };
    });

    res.json(enriched);
  } catch (err) {
    console.error('[messages] /numbers error:', err.message);
    res.status(500).json({ error: 'Failed to fetch numbers' });
  }
});

// GET /api/contacts?waNumber=xxx&timeRange=24h
router.get('/contacts', async (req, res) => {
  try {
    const { waNumber, timeRange = '30d' } = req.query;
    if (!waNumber) return res.status(400).json({ error: 'waNumber required' });
    if (!(await assertWaAccess(req, res, waNumber))) return;

    // timeRange='all' shows every contact that ever messaged this number (so a
    // full broadcast audience is visible, not just the recently-active slice);
    // a known range narrows it; anything else falls back to the default window.
    const timeFilter = timeWindowClause(timeRange, 'ch.timestamp');

    // Visibility. Admin sees everyone. A non-admin who is GRANTED this number
    // (office model) sees ALL contacts on it. Otherwise they see only contacts
    // assigned to them/their team, or explicitly shared with them (e.g. a
    // consultant booked with that customer).
    const params = [waNumber];
    let joinKind = 'LEFT JOIN';
    let assignFilter = '';
    if (!isAdmin(req.user)) {
      const granted = await effectiveWaNumbers(req.user);
      if (!granted.includes(String(waNumber).replace(/\D/g, '')) && !granted.includes(waNumber)) {
        const effIds = await effectiveUserIds(req.user);
        params.push(effIds);
        assignFilter = `AND (
          c.assigned_user_id = ANY($${params.length}::bigint[])
          OR EXISTS (SELECT 1 FROM coexistence.contact_user_access cua
                      WHERE cua.wa_number = ch.wa_number AND cua.contact_number = ch.contact_number
                        AND cua.user_id = ANY($${params.length}::bigint[]))
        )`;
      }
    }
    const { rows } = await pool.query(`
      SELECT
        ch.contact_number,
        MAX(ch.timestamp) AS last_message_time,
        COUNT(*) AS message_count,
        COUNT(*) FILTER (
          WHERE ch.direction = 'incoming'
            AND ch.timestamp > COALESCE(cr.last_read_at, 'epoch'::timestamptz)
        ) AS unread_count,
        (SELECT CASE
                  WHEN NULLIF(ch2.message_body, '') IS NOT NULL THEN ch2.message_body
                  WHEN ch2.message_type IN ('audio','voice') THEN '🎵 Audio'
                  WHEN ch2.message_type = 'image'   THEN '📷 Photo'
                  WHEN ch2.message_type = 'video'   THEN '🎥 Video'
                  WHEN ch2.message_type = 'document' THEN '📄 Document'
                  WHEN ch2.message_type = 'location' THEN '📍 Location'
                  WHEN ch2.message_type = 'contacts' THEN '👤 Contact'
                  WHEN ch2.message_type = 'sticker'  THEN 'Sticker'
                  WHEN ch2.message_type = 'template' THEN 'Template message'
                  WHEN ch2.message_type = 'interactive' THEN 'Interactive message'
                  WHEN ch2.message_type IN ('unsupported','unknown') THEN 'Unsupported message'
                  ELSE NULL
                END
         FROM coexistence.chat_history ch2
         WHERE ch2.wa_number = $1 AND ch2.contact_number = ch.contact_number
           AND ch2.message_type NOT IN ('reaction','status')
         ORDER BY ch2.timestamp DESC LIMIT 1) AS last_message,
        COALESCE(c.name, c.profile_name) AS name,
         c.tags,
         c.custom_fields,
         COALESCE(c.marketing_opted_out, FALSE) AS marketing_opted_out,
         COALESCE(c.auto_response_detected, FALSE) AS auto_response_detected,
        c.assigned_user_id,
        u.display_name AS assigned_user_name,
        u.role        AS assigned_user_role
      FROM coexistence.chat_history ch
      ${joinKind} coexistence.contacts c
        ON c.wa_number = ch.wa_number AND c.contact_number = ch.contact_number
      LEFT JOIN coexistence.forgecrm_users u ON u.id = c.assigned_user_id
      LEFT JOIN coexistence.conversation_reads cr
        ON cr.wa_number = ch.wa_number AND cr.contact_number = ch.contact_number
      WHERE ch.wa_number = $1 ${timeFilter} ${assignFilter}
      GROUP BY ch.contact_number, c.name, c.profile_name, c.tags, c.custom_fields, c.marketing_opted_out, c.auto_response_detected, c.assigned_user_id, u.display_name, u.role, cr.last_read_at
      ORDER BY last_message_time DESC
    `, params);

    res.json(rows.map(r => ({ ...r, tags: r.tags || [], unread_count: Number(r.unread_count) || 0 })));
  } catch (err) {
    console.error('[messages] /contacts error:', err.message);
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

// POST /api/contacts/save
router.post('/contacts/save', async (req, res) => {
  try {
    const { waNumber, contactNumber, name, tags, customFields, assignedUserId } = req.body;
    if (!waNumber || !contactNumber) {
      return res.status(400).json({ error: 'waNumber and contactNumber required' });
    }
    if (name != null && String(name).length > 255) {
      return res.status(400).json({ error: 'Name too long (max 255 characters)' });
    }
    if (tags != null && (!Array.isArray(tags) || tags.length > 50)) {
      return res.status(400).json({ error: 'tags must be an array of at most 50 items' });
    }
    if (customFields != null && JSON.stringify(customFields).length > 10000) {
      return res.status(400).json({ error: 'customFields payload too large' });
    }
    const admin = isAdmin(req.user);

    // Sales users may only edit a contact already assigned to them.
    if (!admin && !(await assertContactAccess(req, res, waNumber, contactNumber))) return;

    // name is optional: a blank name means "don't touch the name" (used by the
    // chat-header quick-actions that only change tags/assignment). When blank we
    // store NULL and preserve any existing name via COALESCE on conflict, so a
    // tag/assign change can never overwrite the contact's name or promote a
    // WhatsApp profile_name into the CRM name column.
    const cleanName = (name && name.trim()) ? name.trim() : null;

    // custom_fields is an object keyed by field id ({fieldId: value}); when
    // omitted ($5 = NULL) existing values are preserved (new rows fall back to
    // an empty object) so a save can't accidentally wipe them.
    const cf = customFields !== undefined && customFields !== null
      ? JSON.stringify(customFields)
      : null;

    // assigned_user_id (who owns this chat):
    //   - sales user  → forced to themselves (can't reassign)
    //   - admin + assignedUserId given (incl. null) → set / clear it
    //   - admin + omitted → preserve existing (or NULL on a brand-new row)
    let setAssign = false;
    let assignVal = null;
    if (!admin) {
      setAssign = true;
      assignVal = req.user.id;
    } else if (assignedUserId !== undefined) {
      setAssign = true;
      assignVal = (assignedUserId === null || assignedUserId === '') ? null : parseInt(assignedUserId, 10);
    }

    await pool.query(`
      INSERT INTO coexistence.contacts
        (wa_number, contact_number, name, tags, custom_fields, assigned_user_id, updated_at)
      VALUES ($1, $2, $3, $4, COALESCE($5::jsonb, '{}'::jsonb), $6, NOW())
      ON CONFLICT (wa_number, contact_number)
      DO UPDATE SET
        name = COALESCE(EXCLUDED.name, coexistence.contacts.name),
        tags = CASE
          WHEN COALESCE(coexistence.contacts.marketing_opted_out, FALSE) = FALSE THEN EXCLUDED.tags
          WHEN EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(EXCLUDED.tags, '[]'::jsonb)) tag_ref
             WHERE tag_ref->>'id' = 'system-stop' OR LOWER(COALESCE(tag_ref->>'name', '')) = 'stop'
          ) THEN EXCLUDED.tags
          ELSE COALESCE(EXCLUDED.tags, '[]'::jsonb) || '[{"id":"system-stop","name":"STOP","color":"#DC2626","category_id":"system-compliance"}]'::jsonb
        END,
        custom_fields = COALESCE($5::jsonb, coexistence.contacts.custom_fields),
        assigned_user_id = CASE WHEN $7::boolean THEN $6 ELSE coexistence.contacts.assigned_user_id END,
        updated_at = NOW()
    `, [waNumber, contactNumber, cleanName, JSON.stringify(tags || []), cf, assignVal, setAssign]);

    res.json({ ok: true });
  } catch (err) {
    console.error('[messages] /contacts/save error:', err.message);
    res.status(500).json({ error: 'Failed to save contact' });
  }
});

// POST /api/contacts/bulk-assign — admin-only. Assign (or unassign) many contacts
// to one user in a single call. assignedUserId null/'' clears the assignment.
router.post('/contacts/bulk-assign', async (req, res) => {
  try {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only' });
    const { waNumber, contactNumbers, assignedUserId } = req.body || {};
    const wa = String(waNumber || '').replace(/\D/g, '');
    if (!wa) return res.status(400).json({ error: 'waNumber required' });
    if (!Array.isArray(contactNumbers) || contactNumbers.length === 0) {
      return res.status(400).json({ error: 'contactNumbers must be a non-empty array' });
    }
    if (contactNumbers.length > 5000) {
      return res.status(400).json({ error: 'Too many contacts (max 5000 per request)' });
    }
    const userId = (assignedUserId === null || assignedUserId === undefined || assignedUserId === '')
      ? null : parseInt(assignedUserId, 10);
    const nums = contactNumbers.map(n => String(n).replace(/\D/g, '')).filter(Boolean);
    const { rowCount } = await pool.query(
      `UPDATE coexistence.contacts
          SET assigned_user_id = $1, updated_at = NOW()
        WHERE wa_number = $2 AND contact_number = ANY($3::text[])`,
      [userId, wa, nums]
    );
    res.json({ ok: true, updated: rowCount });
  } catch (err) {
    console.error('[messages] /contacts/bulk-assign error:', err.message);
    res.status(500).json({ error: 'Failed to assign contacts' });
  }
});

// GET /api/contacts/import/template — download a sample .xlsx (Name, Phone Number).
// Generated on the fly; the auth cookie rides along on a plain anchor download.
router.get('/contacts/import/template', async (req, res) => {
  try {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Contacts');
    ws.columns = [
      { header: 'Name', key: 'name', width: 24 },
      { header: 'Phone Number', key: 'phone', width: 20 },
    ];
    ws.addRow({ name: 'John Doe', phone: '919876543210' });
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="contacts-import-template.xlsx"');
    res.send(Buffer.from(buf));
  } catch (err) {
    console.error('[messages] /contacts/import/template error:', err.message);
    res.status(500).json({ error: 'Failed to build template' });
  }
});

// POST /api/contacts/import — bulk-import contacts (Name + Phone) from a .csv/.xlsx
// sheet onto a WhatsApp number. Parsed server-side with exceljs; row-by-row upsert
// keyed on UNIQUE(wa_number, contact_number). Returns counts + skipped rows.
router.post('/contacts/import', sheetUpload.single('file'), async (req, res) => {
  try {
    const waNumber = String(req.body.waNumber || '').replace(/\D/g, '');
    if (!waNumber) return res.status(400).json({ error: 'waNumber required' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const admin = isAdmin(req.user);
    // Non-admins may only import onto a WhatsApp number they have access to.
    if (!admin && !(await assertWaAccess(req, res, waNumber))) return;

    // Optional tags to apply to every imported contact. Sent as a JSON array of
    // full tag objects ({id,name,color,...}) so they match how contacts.tags is
    // stored. New contacts get these tags; existing contacts have them merged in
    // (deduped by id) so an import never drops a contact's existing tags.
    let importTags = [];
    try {
      const parsed = JSON.parse(req.body.tags || '[]');
      if (Array.isArray(parsed)) importTags = parsed.filter(t => t && t.id != null);
    } catch { /* ignore malformed tags */ }
    const tagsJson = JSON.stringify(importTags);

    let rows;
    try {
      // exceljs returns cell values as text/number; cellToString normalises them
      // so phone numbers don't arrive as floats / scientific notation.
      rows = await parseSheetRows(req.file);
    } catch {
      return res.status(400).json({ error: 'Could not read the file. Upload a valid .csv or .xlsx sheet.' });
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'The sheet has no data rows.' });
    }
    if (rows.length > MAX_CONTACT_IMPORT_ROWS) {
      return res.status(400).json({ error: `Too many rows (${rows.length}). The limit is ${MAX_CONTACT_IMPORT_ROWS} per import.` });
    }

    let imported = 0, updated = 0;
    const skipped = [];
    const seen = new Set();

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 2; // +1 header, +1 for 1-based display
      const rawName = pickImportColumn(rows[i], IMPORT_NAME_ALIASES);
      const rawPhone = pickImportColumn(rows[i], IMPORT_PHONE_ALIASES);
      const name = (rawName === undefined || rawName === null) ? '' : String(rawName).trim();
      const phone = String(rawPhone ?? '').replace(/\D/g, '');

      if (!phone) { skipped.push({ row: rowNum, reason: 'Missing phone number' }); continue; }
      if (phone.length < 7) { skipped.push({ row: rowNum, reason: `Invalid phone "${String(rawPhone).trim()}"` }); continue; }
      if (!name) { skipped.push({ row: rowNum, reason: 'Missing name' }); continue; }
      if (seen.has(phone)) { skipped.push({ row: rowNum, reason: 'Duplicate phone in sheet' }); continue; }
      seen.add(phone);

      let result;
      // Merge expression: union the contact's existing tags with the import tags,
      // deduped by tag id, so re-importing or tagging never wipes existing tags.
      const mergedTags = `COALESCE((
        SELECT jsonb_agg(elem)
        FROM (
          SELECT DISTINCT ON (e->>'id') e AS elem
          FROM jsonb_array_elements(
                 COALESCE(coexistence.contacts.tags, '[]'::jsonb) || COALESCE(EXCLUDED.tags, '[]'::jsonb)
               ) e
          ORDER BY e->>'id'
        ) d
      ), coexistence.contacts.tags)`;
      if (admin) {
        result = await pool.query(`
          INSERT INTO coexistence.contacts (wa_number, contact_number, name, tags, custom_fields, updated_at)
          VALUES ($1, $2, $3, $4::jsonb, '{}'::jsonb, NOW())
          ON CONFLICT (wa_number, contact_number)
          DO UPDATE SET name = COALESCE(EXCLUDED.name, coexistence.contacts.name),
                        tags = ${mergedTags},
                        updated_at = NOW()
          RETURNING (xmax = 0) AS inserted
        `, [waNumber, phone, name, tagsJson]);
      } else {
        // New rows assign to the importing user; existing rows keep their current
        // owner (COALESCE) so an import can't silently steal another user's contact.
        result = await pool.query(`
          INSERT INTO coexistence.contacts (wa_number, contact_number, name, tags, custom_fields, assigned_user_id, updated_at)
          VALUES ($1, $2, $3, $5::jsonb, '{}'::jsonb, $4, NOW())
          ON CONFLICT (wa_number, contact_number)
          DO UPDATE SET name = COALESCE(EXCLUDED.name, coexistence.contacts.name),
                        tags = ${mergedTags},
                        assigned_user_id = COALESCE(coexistence.contacts.assigned_user_id, EXCLUDED.assigned_user_id),
                        updated_at = NOW()
          RETURNING (xmax = 0) AS inserted
        `, [waNumber, phone, name, req.user.id, tagsJson]);
      }
      if (result.rows[0]?.inserted) imported++; else updated++;
    }

    res.json({ ok: true, imported, updated, skipped, total: rows.length });
  } catch (err) {
    console.error('[messages] /contacts/import error:', err.message);
    res.status(500).json({ error: 'Failed to import contacts' });
  }
});

// POST /api/contacts/change-number — change a contact's phone number, migrating
// the whole conversation + history to the new number atomically. contact_number
// is part of the composite key joined by many tables, so every coexistence table
// keyed on (wa_number, contact_number) is updated in one transaction.
router.post('/contacts/change-number', async (req, res) => {
  const { waNumber, oldNumber } = req.body || {};
  let { newNumber } = req.body || {};
  if (!waNumber || !oldNumber || !newNumber) {
    return res.status(400).json({ error: 'waNumber, oldNumber and newNumber required' });
  }
  // Store digits-only, matching how the webhook/import paths persist numbers.
  newNumber = String(newNumber).replace(/\D/g, '');
  if (newNumber.length < 7) {
    return res.status(400).json({ error: 'Enter a valid phone number (digits only, at least 7 digits)' });
  }
  // BDAs may only edit a contact assigned to them; admins may edit any.
  if (!(await assertContactAccess(req, res, waNumber, oldNumber))) return;

  if (newNumber === String(oldNumber)) {
    return res.json({ ok: true, contactNumber: newNumber, unchanged: true });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const src = await client.query(
      'SELECT 1 FROM coexistence.contacts WHERE wa_number = $1 AND contact_number = $2',
      [waNumber, oldNumber]
    );
    if (src.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Contact not found' });
    }
    const clash = await client.query(
      'SELECT 1 FROM coexistence.contacts WHERE wa_number = $1 AND contact_number = $2',
      [waNumber, newNumber]
    );
    if (clash.rowCount > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'A contact with that number already exists for this WhatsApp number' });
    }
    // Migrate every table keyed on (wa_number, contact_number).
    await client.query('UPDATE coexistence.contacts SET contact_number = $3, updated_at = NOW() WHERE wa_number = $1 AND contact_number = $2', [waNumber, oldNumber, newNumber]);
    await client.query('UPDATE coexistence.chat_history SET contact_number = $3 WHERE wa_number = $1 AND contact_number = $2', [waNumber, oldNumber, newNumber]);
    await client.query('UPDATE coexistence.conversation_reads SET contact_number = $3 WHERE wa_number = $1 AND contact_number = $2', [waNumber, oldNumber, newNumber]);
    await client.query('UPDATE coexistence.message_reactions SET contact_number = $3 WHERE wa_number = $1 AND contact_number = $2', [waNumber, oldNumber, newNumber]);
    await client.query('UPDATE coexistence.automation_executions SET contact_number = $3 WHERE wa_number = $1 AND contact_number = $2', [waNumber, oldNumber, newNumber]);
    await client.query('UPDATE coexistence.deals SET contact_number = $3 WHERE contact_wa_number = $1 AND contact_number = $2', [waNumber, oldNumber, newNumber]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[messages] /contacts/change-number error:', err.message);
    return res.status(500).json({ error: 'Failed to change contact number' });
  } finally {
    client.release();
  }
  res.json({ ok: true, contactNumber: newNumber });
});

// DELETE /api/contact?waNumber=xxx&contactNumber=xxx — remove the saved contact
// record (name/profile_name/tags/custom_fields/assignment). Chat history lives in
// a separate table and is left intact; a future inbound message will recreate a
// bare row from the WhatsApp profile name.
router.delete('/contact', async (req, res) => {
  try {
    const waNumber = req.query.waNumber || req.body?.waNumber;
    const contactNumber = req.query.contactNumber || req.body?.contactNumber;
    if (!waNumber || !contactNumber) {
      return res.status(400).json({ error: 'waNumber and contactNumber required' });
    }
    // BDAs can only delete a contact they have access to; admins can delete any.
    if (!(await assertContactAccess(req, res, waNumber, contactNumber))) return;
    const { rowCount } = await pool.query(
      `DELETE FROM coexistence.contacts WHERE wa_number = $1 AND contact_number = $2`,
      [waNumber, contactNumber]
    );
    res.json({ ok: true, deleted: rowCount });
  } catch (err) {
    console.error('[messages] DELETE /contact error:', err.message);
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

// GET /api/saved-contacts?waNumber=xxx
router.get('/saved-contacts', async (req, res) => {
  try {
    const { waNumber } = req.query;
    if (!waNumber) return res.status(400).json({ error: 'waNumber required' });
    if (!(await assertWaAccess(req, res, waNumber))) return;

    const params = [waNumber];
    let assignFilter = '';
    if (!isAdmin(req.user)) {
      params.push(req.user.id);
      assignFilter = `AND assigned_user_id = $${params.length}`;
    }
    const { rows } = await pool.query(`
       SELECT c.contact_number, COALESCE(c.name, c.profile_name) AS name, c.tags, c.custom_fields, COALESCE(c.marketing_opted_out, FALSE) AS marketing_opted_out, COALESCE(c.auto_response_detected, FALSE) AS auto_response_detected, c.created_at, c.updated_at,
             c.assigned_user_id, u.display_name AS assigned_user_name, u.role AS assigned_user_role
      FROM coexistence.contacts c
      LEFT JOIN coexistence.forgecrm_users u ON u.id = c.assigned_user_id
      WHERE c.wa_number = $1 AND COALESCE(c.name, c.profile_name) IS NOT NULL AND COALESCE(c.name, c.profile_name) <> '' ${assignFilter.replace(/assigned_user_id/g, 'c.assigned_user_id')}
      ORDER BY COALESCE(c.name, c.profile_name) ASC
    `, params);

    res.json(rows.map(r => ({ ...r, tags: r.tags || [] })));
  } catch (err) {
    console.error('[messages] /saved-contacts error:', err.message);
    res.status(500).json({ error: 'Failed to fetch saved contacts' });
  }
});

// GET /api/stop-contacts?waNumber=xxx
// Uses the canonical marketing_opted_out field and includes nameless contacts
// so an unknown sender's STOP event is still visible to operators.
router.get('/stop-contacts', async (req, res) => {
  try {
    const { waNumber } = req.query;
    if (!waNumber) return res.status(400).json({ error: 'waNumber required' });
    if (!(await assertWaAccess(req, res, waNumber))) return;
    const { rows } = await pool.query(
      `SELECT c.contact_number, COALESCE(c.name, c.profile_name) AS name, c.tags, c.custom_fields,
              c.marketing_opted_out, c.marketing_opted_out_at, c.created_at, c.updated_at,
              c.assigned_user_id, u.display_name AS assigned_user_name, u.role AS assigned_user_role
         FROM coexistence.contacts c
         LEFT JOIN coexistence.forgecrm_users u ON u.id = c.assigned_user_id
        WHERE c.wa_number = $1 AND COALESCE(c.marketing_opted_out, FALSE) = TRUE
        ORDER BY c.marketing_opted_out_at DESC NULLS LAST, c.updated_at DESC`,
      [waNumber],
    );
    res.json(rows.map(r => ({ ...r, tags: r.tags || [], marketing_opted_out: true })));
  } catch (err) {
    console.error('[messages] /stop-contacts error:', err.message);
    res.status(500).json({ error: 'Failed to fetch STOP contacts' });
  }
});

// GET /api/contact?waNumber=xxx&contactNumber=xxx
router.get('/contact', async (req, res) => {
  try {
    const { waNumber, contactNumber } = req.query;
    if (!waNumber || !contactNumber) {
      return res.status(400).json({ error: 'waNumber and contactNumber required' });
    }
    if (!(await assertContactAccess(req, res, waNumber, contactNumber))) return;

    const { rows } = await pool.query(`
       SELECT c.contact_number, COALESCE(c.name, c.profile_name) AS name, c.tags, c.custom_fields, c.created_at, c.updated_at,
              c.assigned_user_id, c.ai_paused, COALESCE(c.marketing_opted_out, FALSE) AS marketing_opted_out, c.marketing_opted_out_at,
              COALESCE(c.auto_response_detected, FALSE) AS auto_response_detected, c.auto_response_detected_at, c.auto_response_reason,
             u.display_name AS assigned_user_name,
             u.role AS assigned_user_role
      FROM coexistence.contacts c
      LEFT JOIN coexistence.forgecrm_users u ON u.id = c.assigned_user_id
      WHERE c.wa_number = $1 AND c.contact_number = $2
      LIMIT 1
    `, [waNumber, contactNumber]);

    if (rows.length === 0) {
      return res.json({ contact_number: contactNumber, name: null, tags: [], ai_paused: false, marketing_opted_out: false, auto_response_detected: false });
    }

    res.json({ ...rows[0], tags: rows[0].tags || [], ai_paused: !!rows[0].ai_paused });
  } catch (err) {
    console.error('[messages] /contact error:', err.message);
    res.status(500).json({ error: 'Failed to fetch contact' });
  }
});

// POST /api/messages/mark-read — stamp a conversation as read (agent opened it).
// Clears the unread badge for this (wa_number, contact_number).
router.post('/messages/mark-read', async (req, res) => {
  try {
    const { waNumber, contactNumber } = req.body;
    if (!waNumber || !contactNumber) {
      return res.status(400).json({ error: 'waNumber and contactNumber required' });
    }
    if (!(await assertContactAccess(req, res, waNumber, contactNumber))) return;

    await pool.query(`
      INSERT INTO coexistence.conversation_reads (wa_number, contact_number, last_read_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (wa_number, contact_number)
      DO UPDATE SET last_read_at = NOW()
    `, [waNumber, contactNumber]);

    res.json({ ok: true });
  } catch (err) {
    console.error('[messages] /messages/mark-read error:', err.message);
    res.status(500).json({ error: 'Failed to mark read' });
  }
});

// GET /api/messages?waNumber=xxx&contactNumber=xxx&page=1&limit=50
router.get('/messages', async (req, res) => {
  try {
    const {
      waNumber, contactNumber,
      page = '1', limit = '50',
      search = '', direction = 'all',
      timeRange = 'all',
    } = req.query;

    if (!waNumber || !contactNumber) {
      return res.status(400).json({ error: 'waNumber and contactNumber required' });
    }
    if (!(await assertContactAccess(req, res, waNumber, contactNumber))) return;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    // A single conversation is a small, indexed slice (wa_number + contact_number),
    // so default to the FULL history — otherwise messages older than the rolling
    // window silently disappear from an open chat. Callers may still pass
    // ?timeRange= to narrow it.
    const timeWindow = timeWindowClause(timeRange, 'timestamp');

    const params = [waNumber, contactNumber];
    let paramIdx = 3;
    const conditions = [
      'wa_number = $1',
      'contact_number = $2',
      // Defensive: never render status-receipt rows as chat bubbles (legacy
      // phantom "Status: delivered" rows; the webhook no longer creates these).
      `message_type <> 'status'`,
    ];
    // timeWindow is 'AND <col> >= …' or '' — normalise to a bare predicate so it
    // slots into the conditions array joined by ' AND '.
    if (timeWindow) conditions.push(timeWindow.replace(/^\s*AND\s+/i, ''));

    const trimmedSearch = (typeof search === 'string' ? search : '').trim().slice(0, 200);
    if (trimmedSearch) {
      conditions.push(`COALESCE(message_body, '') ILIKE $${paramIdx}`);
      params.push(`%${trimmedSearch}%`);
      paramIdx++;
    }

    if (direction === 'incoming') {
      conditions.push(`direction = $${paramIdx}`);
      params.push('incoming');
      paramIdx++;
    } else if (direction === 'outgoing') {
      conditions.push(`direction = $${paramIdx}`);
      params.push('outgoing');
      paramIdx++;
    }

    const whereClause = conditions.join(' AND ');

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM coexistence.chat_history WHERE ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const { rows } = await pool.query(
      `SELECT * FROM coexistence.chat_history
       WHERE ${whereClause}
       ORDER BY timestamp DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limitNum, offset]
    );

    // Attach reactions (emoji badges) to each message by its wamid.
    const ids = rows.map(r => r.message_id).filter(Boolean);
    const reactionsByMsg = {};
    if (ids.length > 0) {
      const { rows: rx } = await pool.query(
        `SELECT target_message_id, direction, emoji
           FROM coexistence.message_reactions
          WHERE target_message_id = ANY($1)`,
        [ids]
      );
      for (const r of rx) {
        (reactionsByMsg[r.target_message_id] ||= []).push({ emoji: r.emoji, direction: r.direction });
      }
    }

    res.json({
      messages: rows
        // Strip raw_payload (the full Meta webhook JSON) — it's internal-only,
        // never read by the client, and can carry extra PII / metadata.
        .map(({ raw_payload, ...m }) => ({ ...m, reactions: reactionsByMsg[m.message_id] || [] }))
        .reverse(), // oldest first for chat display
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    console.error('[messages] /messages error:', err.message);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// GET /api/contact-names?waNumber=xxx
router.get('/contact-names', async (req, res) => {
  try {
    const { waNumber } = req.query;
    if (!waNumber) return res.status(400).json({ error: 'waNumber required' });
    if (!(await assertWaAccess(req, res, waNumber))) return;

    const params = [waNumber];
    let assignFilter = '';
    if (!isAdmin(req.user)) {
      params.push(req.user.id);
      assignFilter = `AND assigned_user_id = $${params.length}`;
    }
    const { rows } = await pool.query(
      `SELECT contact_number, COALESCE(name, profile_name) AS name FROM coexistence.contacts WHERE wa_number = $1 ${assignFilter}`,
      params
    );

    const nameMap = {};
    rows.forEach(r => { nameMap[r.contact_number] = r.name; });
    res.json(nameMap);
  } catch (err) {
    console.error('[messages] /contact-names error:', err.message);
    res.status(500).json({ error: 'Failed to fetch contact names' });
  }
});

/**
 * GET /messages/window-status?waNumber=&contactNumber=
 * Returns { canSendFreeForm: boolean, lastIncomingSecondsAgo: number|null, windowSeconds: 86400 }
 * The frontend uses this to grey out the chat input when outside the 24h
 * customer service window.
 */
router.get('/messages/window-status', async (req, res) => {
  try {
    const { waNumber, contactNumber } = req.query;
    if (!waNumber || !contactNumber) return res.status(400).json({ error: 'waNumber and contactNumber required' });
    const { account, error } = await resolveAccount({ fromPhoneNumber: waNumber });
    if (error) return res.json({ canSendFreeForm: false, reason: error, windowSeconds: SERVICE_WINDOW_SECONDS });
    const secs = await secondsSinceLastIncoming({ accountPhoneNumberId: account.phoneNumberId, contactNumber });
    res.json({
      canSendFreeForm: secs != null && secs <= SERVICE_WINDOW_SECONDS,
      lastIncomingSecondsAgo: secs,
      windowSeconds: SERVICE_WINDOW_SECONDS,
      accountId: account.id,
      accountName: account.displayName,
    });
  } catch (err) {
    console.error('[messages] window-status error:', err.message);
    res.status(500).json({ error: 'Failed to compute window status' });
  }
});

/**
 * POST /messages/react
 * Body: { fromNumber, toNumber, messageId, emoji }
 * Sends an emoji reaction to a message (empty emoji removes it). Requires the
 * 24-hour customer service window to be open. Records our reaction locally.
 */
router.post('/messages/react', async (req, res) => {
  try {
    const { fromNumber, toNumber, messageId, emoji } = req.body || {};
    if (!fromNumber || !toNumber || !messageId) {
      return res.status(400).json({ error: 'fromNumber, toNumber and messageId required' });
    }
    if (!(await assertContactAccess(req, res, fromNumber, toNumber))) return;

    const { account, error } = await resolveAccount({ fromPhoneNumber: fromNumber });
    if (error) return res.status(409).json({ error });

    const secs = await secondsSinceLastIncoming({ accountPhoneNumberId: account.phoneNumberId, contactNumber: toNumber });
    if (secs == null || secs > SERVICE_WINDOW_SECONDS) {
      return res.status(409).json({ error: 'Outside 24-hour customer service window.', code: 'OUTSIDE_WINDOW' });
    }

    const cleanEmoji = typeof emoji === 'string' ? emoji : '';
    const wa = String(fromNumber).replace(/\D/g, '');
    const contact = String(toNumber).replace(/\D/g, '');

    // Record our reaction (outgoing). Empty emoji removes it.
    if (cleanEmoji) {
      await pool.query(
        `INSERT INTO coexistence.message_reactions
           (wa_number, contact_number, target_message_id, direction, emoji, updated_at)
         VALUES ($1,$2,$3,'outgoing',$4,NOW())
         ON CONFLICT (target_message_id, direction)
         DO UPDATE SET emoji = EXCLUDED.emoji, updated_at = NOW()`,
        [wa, contact, messageId, cleanEmoji]
      );
    } else {
      await pool.query(
        `DELETE FROM coexistence.message_reactions
           WHERE target_message_id = $1 AND direction = 'outgoing'
             AND wa_number = $2 AND contact_number = $3`,
        [messageId, wa, contact]
      );
    }

    await enqueueSend({
      kind: 'reaction',
      accountId: account.id,
      to: contact,
      payload: { messageId, emoji: cleanEmoji },
    });

    res.json({ ok: true, messageId, emoji: cleanEmoji, direction: 'outgoing' });
  } catch (err) {
    console.error('[messages] /react error:', err.message);
    res.status(500).json({ error: 'Failed to send reaction' });
  }
});

/**
 * POST /messages/star
 * Body: { waNumber, contactNumber, messageId, starred }
 * Toggles the local "starred" flag on a message (CRM-only bookmark).
 */
router.post('/messages/star', async (req, res) => {
  try {
    const { waNumber, contactNumber, messageId, starred } = req.body || {};
    if (!waNumber || !contactNumber || !messageId) {
      return res.status(400).json({ error: 'waNumber, contactNumber and messageId required' });
    }
    if (!(await assertContactAccess(req, res, waNumber, contactNumber))) return;
    // Scope to the validated (wa_number, contact_number) so a pair the user owns
    // can't be used to star a message_id from another conversation (IDOR).
    const waDigits = String(waNumber).replace(/\D/g, '');
    const contactDigits = String(contactNumber).replace(/\D/g, '');
    const { rowCount } = await pool.query(
      `UPDATE coexistence.chat_history SET starred = $1
         WHERE message_id = $2 AND wa_number = $3 AND contact_number = $4`,
      [!!starred, messageId, waDigits, contactDigits]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Message not found' });
    res.json({ ok: true, messageId, starred: !!starred });
  } catch (err) {
    console.error('[messages] /star error:', err.message);
    res.status(500).json({ error: 'Failed to update star' });
  }
});

/**
 * POST /messages/send
 * Body: { fromNumber, toNumber, text }
 * Inserts an optimistic chat_history row (status='sending') and enqueues a
 * BullMQ job. Returns the row immediately so the UI can render the bubble.
 */
router.post('/messages/send', async (req, res) => {
  try {
    const { fromNumber, toNumber, text, contextMessageId } = req.body || {};
    if (!fromNumber || !toNumber || !text || !String(text).trim()) {
      return res.status(400).json({ error: 'fromNumber, toNumber, text required' });
    }
    if (String(text).length > 4096) {
      return res.status(400).json({ error: 'Message too long (max 4096 characters)' });
    }
    // Ownership: the (wa_number, contact_number) pair must belong to the
    // requester (admins bypass). This ties fromNumber to the user and gates
    // toNumber — a non-admin can't send from a WABA or to a contact they don't own.
    if (!(await assertContactAccess(req, res, fromNumber, toNumber))) return;

    const { account, error } = await resolveAccount({ fromPhoneNumber: fromNumber });
    if (error) return res.status(400).json({ error });

    // Enforce Meta's 24h customer service window for free-form text
    const secs = await secondsSinceLastIncoming({ accountPhoneNumberId: account.phoneNumberId, contactNumber: toNumber });
    if (secs == null || secs > SERVICE_WINDOW_SECONDS) {
      return res.status(409).json({
        error: 'Outside 24-hour customer service window. Send an approved template instead.',
        code: 'OUTSIDE_WINDOW',
      });
    }

    const ctxId = sanitizeContextId(contextMessageId);
    const localId = await insertPendingRow({
      account, toNumber, messageType: 'text', messageBody: String(text).trim(),
      contextMessageId: ctxId,
    });

    const trimmedText = String(text).trim();
    await enqueueSend({
      kind: 'text',
      accountId: account.id,
      to: String(toNumber).replace(/\D/g, ''),
      localMessageId: localId,
      // Enable WhatsApp link preview when the message contains a URL
      payload: { body: trimmedText, previewUrl: /https?:\/\/\S+/i.test(trimmedText), contextMessageId: ctxId },
    });

    res.status(202).json({ ok: true, messageId: localId, status: 'sending' });
  } catch (err) {
    console.error('[messages] send error:', err.message);
    res.status(500).json({ error: 'Failed to enqueue send' });
  }
});

/**
 * POST /messages/send-media (multipart)
 * Fields: fromNumber, toNumber, caption?, file (binary)
 * Uploads the binary to Meta to get a media_id, then enqueues a send job.
 * Subject to the 24h customer service window same as text.
 */
router.post('/messages/send-media', mediaUpload.single('file'), async (req, res) => {
  try {
    const { fromNumber, toNumber, caption = '', contextMessageId } = req.body || {};
    if (!fromNumber || !toNumber) return res.status(400).json({ error: 'fromNumber and toNumber required' });
    if (!req.file) return res.status(400).json({ error: 'file required' });
    if (!(await assertContactAccess(req, res, fromNumber, toNumber))) return;

    const { account, error } = await resolveAccount({ fromPhoneNumber: fromNumber });
    if (error) return res.status(400).json({ error });

    const secs = await secondsSinceLastIncoming({ accountPhoneNumberId: account.phoneNumberId, contactNumber: toNumber });
    if (secs == null || secs > SERVICE_WINDOW_SECONDS) {
      return res.status(409).json({ error: 'Outside 24-hour customer service window.', code: 'OUTSIDE_WINDOW' });
    }

    let mime = canonicalizeMime(req.file.mimetype, req.file.originalname);
    const kind = chatKindFor(mime);
    if (!kind) return res.status(400).json({ error: `Unsupported file type "${req.file.mimetype || 'unknown'}". ${CHAT_TYPES_MSG}` });

    // Auto-compress an oversized video down to WhatsApp's 16MB cap. Other types
    // over their cap are left to Meta to reject with a clear error.
    let fileBuffer = req.file.buffer;
    let fileName = req.file.originalname;
    if (kind === 'video' && fileBuffer.length > WA_VIDEO_LIMIT_BYTES) {
      try {
        const c = await compressVideoForMeta(fileBuffer);
        fileBuffer = c.buffer;
        mime = c.mime;
        fileName = fileName.replace(/\.[^.]+$/, '') + '.mp4';
        if (fileBuffer.length > WA_VIDEO_LIMIT_BYTES) {
          return res.status(413).json({ error: 'This video is still over WhatsApp’s 16MB limit after compression. Please trim it or lower its resolution.' });
        }
      } catch (err) {
        console.error('[messages] video compress failed:', err.message);
        return res.status(400).json({ error: 'Could not compress this video for WhatsApp. Try a shorter or lower-resolution clip.' });
      }
    }

    // Step 1: upload binary to Meta to get media_id
    let mediaId;
    try {
      const uploaded = await uploadMedia({
        accessToken: account.accessToken,
        phoneNumberId: account.phoneNumberId,
        buffer: fileBuffer,
        mimeType: mime,
        filename: fileName,
      });
      mediaId = uploaded?.id;
      if (!mediaId) throw new Error('Meta upload returned no id');
      await markAccountHealth(account.id, 'healthy');
    } catch (err) {
      const cls = classifyMetaError(err);
      await markAccountHealth(account.id, cls, err.message);
      return res.status(err.status === 401 ? 401 : 400).json({ error: err.message, metaCode: err.metaError?.code });
    }

    // Step 2: insert optimistic row + mirror file locally so the bubble
    // renders the actual thumbnail / playback via /api/media/:messageId
    const ctxId = sanitizeContextId(contextMessageId);
    const localId = await insertPendingRow({
      account, toNumber, messageType: kind,
      messageBody: caption || fileName,
      mediaMime: mime,
      contextMessageId: ctxId,
    });
    const ext = fileName.split('.').pop()?.toLowerCase() || mime.split('/')[1] || 'bin';
    const accountDigits = (account.displayPhoneNumber || '').replace(/\D/g, '');
    const { absPath, size } = persistOutboundMedia({
      accountPhoneDigits: accountDigits, messageId: localId,
      buffer: fileBuffer, ext,
    });
    await pool.query(
      `UPDATE coexistence.chat_history
          SET media_storage_path = $1, media_status = 'stored',
              media_size_bytes = $2, media_filename = $3,
              media_downloaded_at = NOW()
        WHERE message_id = $4`,
      [absPath, size, fileName, localId]
    );

    // Step 3: enqueue send to Meta
    await enqueueSend({
      kind: 'media',
      accountId: account.id,
      to: String(toNumber).replace(/\D/g, ''),
      localMessageId: localId,
      payload: {
        type: kind, mediaId, caption: caption || undefined,
        filename: kind === 'document' ? req.file.originalname : undefined,
        contextMessageId: ctxId,
      },
    });

    res.status(202).json({ ok: true, messageId: localId, status: 'sending', mediaId });
  } catch (err) {
    console.error('[messages] send-media error:', err.message);
    res.status(500).json({ error: 'Failed to send media' });
  }
});

/**
 * POST /messages/send-audio (multipart)
 * Fields: fromNumber, toNumber, file (browser-recorded audio blob)
 * Transcodes the browser's webm/opus output to ogg/opus (Meta-accepted),
 * uploads to Meta, mirrors locally, and enqueues send.
 */
router.post('/messages/send-audio', mediaUpload.single('file'), async (req, res) => {
  try {
    const { fromNumber, toNumber, contextMessageId } = req.body || {};
    if (!fromNumber || !toNumber) return res.status(400).json({ error: 'fromNumber and toNumber required' });
    if (!req.file) return res.status(400).json({ error: 'audio file required' });
    if (!req.file.buffer || req.file.buffer.length === 0) {
      return res.status(400).json({ error: 'The recording was empty. Please record again before sending.' });
    }
    if (!(await assertContactAccess(req, res, fromNumber, toNumber))) return;

    const { account, error } = await resolveAccount({ fromPhoneNumber: fromNumber });
    if (error) return res.status(400).json({ error });

    const secs = await secondsSinceLastIncoming({ accountPhoneNumberId: account.phoneNumberId, contactNumber: toNumber });
    if (secs == null || secs > SERVICE_WINDOW_SECONDS) {
      return res.status(409).json({ error: 'Outside 24-hour customer service window.', code: 'OUTSIDE_WINDOW' });
    }

    // Transcode to Meta-accepted format if needed
    let audioBuffer, audioMime, audioExt;
    try {
      const transcoded = await transcodeAudioForMeta(req.file.buffer, req.file.mimetype);
      audioBuffer = transcoded.buffer;
      audioMime = transcoded.mime;
      audioExt = transcoded.ext;
    } catch (err) {
      return res.status(400).json({ error: 'Audio processing failed. Please try a different recording.' });
    }

    // Upload to Meta
    let mediaId;
    try {
      const uploaded = await uploadMedia({
        accessToken: account.accessToken, phoneNumberId: account.phoneNumberId,
        buffer: audioBuffer, mimeType: audioMime, filename: `voice.${audioExt}`,
      });
      mediaId = uploaded?.id;
      if (!mediaId) throw new Error('Meta upload returned no id');
      await markAccountHealth(account.id, 'healthy');
    } catch (err) {
      const cls = classifyMetaError(err);
      await markAccountHealth(account.id, cls, err.message);
      return res.status(err.status === 401 ? 401 : 400).json({ error: err.message, metaCode: err.metaError?.code });
    }

    // Insert optimistic row + mirror locally
    const ctxId = sanitizeContextId(contextMessageId);
    const localId = await insertPendingRow({
      account, toNumber, messageType: 'audio',
      messageBody: 'Voice message', mediaMime: audioMime,
      contextMessageId: ctxId,
    });
    const accountDigits = (account.displayPhoneNumber || '').replace(/\D/g, '');
    const { absPath, size } = persistOutboundMedia({
      accountPhoneDigits: accountDigits, messageId: localId,
      buffer: audioBuffer, ext: audioExt,
    });
    await pool.query(
      `UPDATE coexistence.chat_history
          SET media_storage_path = $1, media_status = 'stored',
              media_size_bytes = $2, media_downloaded_at = NOW()
        WHERE message_id = $3`,
      [absPath, size, localId]
    );

    await enqueueSend({
      kind: 'media',
      accountId: account.id,
      to: String(toNumber).replace(/\D/g, ''),
      localMessageId: localId,
      payload: { type: 'audio', mediaId, contextMessageId: ctxId },
    });

    res.status(202).json({ ok: true, messageId: localId, status: 'sending', mediaId });
  } catch (err) {
    console.error('[messages] send-audio error:', err.message);
    res.status(500).json({ error: 'Failed to send audio' });
  }
});

/**
 * POST /messages/send-library-media
 * Body: { fromNumber, toNumber, mediaLibraryId, caption? }
 *
 * Sends an existing Media Library item to a contact. Resolves the WABA from
 * `fromNumber`, finds (or refreshes) the per-WABA Meta media_id for that
 * library item, mirrors the file from storage into /app/media so the chat
 * bubble renders, and enqueues the send.
 *
 * Auto-resyncs if no sync row exists for this WABA, or if the existing
 * meta_media_id is expired/failed — the caller never has to worry about
 * Meta's 28-day TTL.
 */
router.post('/messages/send-library-media', async (req, res) => {
  try {
    const { fromNumber, toNumber, mediaLibraryId, caption = '', contextMessageId } = req.body || {};
    if (!fromNumber || !toNumber || !mediaLibraryId) {
      return res.status(400).json({ error: 'fromNumber, toNumber, mediaLibraryId required' });
    }
    if (!(await assertContactAccess(req, res, fromNumber, toNumber))) return;

    const { account, error } = await resolveAccount({ fromPhoneNumber: fromNumber });
    if (error) return res.status(400).json({ error });

    const secs = await secondsSinceLastIncoming({
      accountPhoneNumberId: account.phoneNumberId, contactNumber: toNumber,
    });
    if (secs == null || secs > SERVICE_WINDOW_SECONDS) {
      return res.status(409).json({ error: 'Outside 24-hour customer service window.', code: 'OUTSIDE_WINDOW' });
    }

    const { rows: mRows } = await pool.query(
      `SELECT * FROM coexistence.media_library
        WHERE id = $1 AND deleted_at IS NULL`,
      [mediaLibraryId]
    );
    if (!mRows.length) return res.status(404).json({ error: 'Media not found in library' });
    const media = mRows[0];

    // Resolve per-WABA meta_media_id; auto-(re)sync if missing/expired/failed
    const { rows: sRows } = await pool.query(
      `SELECT * FROM coexistence.media_meta_sync WHERE media_id = $1 AND account_id = $2`,
      [media.id, account.id]
    );
    let sync = sRows[0];
    const needsSync = !sync
      || sync.status !== 'synced'
      || !sync.meta_media_id
      || (sync.expires_at && new Date(sync.expires_at) <= new Date());
    if (needsSync) {
      try {
        sync = await syncMediaToAccount(media.id, account.id);
        // syncMediaToAccount returns a `rowToSync`-shaped object — adapt keys
        sync = {
          meta_media_id: sync.metaMediaId,
          expires_at: sync.expiresAt,
          status: sync.status,
        };
      } catch (err) {
        return res.status(502).json({ error: 'Auto-sync to Meta failed' });
      }
    }

    const mediaMimeCanon = canonicalizeMime(media.mime_type, media.original_name);
    const kind = chatKindFor(mediaMimeCanon);
    if (!kind) return res.status(400).json({ error: `Unsupported library media type for chat send. ${CHAT_TYPES_MSG}` });

    // Fetch bytes from storage so we can mirror locally for bubble rendering
    let buf;
    try {
      buf = await storage.getObjectBuffer(media.storage_key);
    } catch (err) {
      return res.status(502).json({ error: 'Failed to read media from storage' });
    }

    const ctxId = sanitizeContextId(contextMessageId);
    const localId = await insertPendingRow({
      account, toNumber, messageType: kind,
      messageBody: caption || media.original_name,
      mediaMime: mediaMimeCanon,
      contextMessageId: ctxId,
    });
    const ext = media.original_name.split('.').pop()?.toLowerCase() || mediaMimeCanon.split('/')[1] || 'bin';
    const accountDigits = (account.displayPhoneNumber || '').replace(/\D/g, '');
    const { absPath, size } = persistOutboundMedia({
      accountPhoneDigits: accountDigits, messageId: localId, buffer: buf, ext,
    });
    await pool.query(
      `UPDATE coexistence.chat_history
          SET media_storage_path = $1, media_status = 'stored',
              media_size_bytes = $2, media_filename = $3,
              media_downloaded_at = NOW()
        WHERE message_id = $4`,
      [absPath, size, media.original_name, localId]
    );

    await enqueueSend({
      kind: 'media',
      accountId: account.id,
      to: String(toNumber).replace(/\D/g, ''),
      localMessageId: localId,
      payload: {
        type: kind,
        mediaId: sync.meta_media_id,
        caption: caption || undefined,
        filename: kind === 'document' ? media.original_name : undefined,
        contextMessageId: ctxId,
      },
    });

    res.status(202).json({
      ok: true, messageId: localId, status: 'sending',
      mediaId: sync.meta_media_id, mediaLibraryId: Number(media.id),
    });
  } catch (err) {
    console.error('[messages] send-library-media error:', err.message);
    res.status(500).json({ error: 'Failed to send library media' });
  }
});

/**
 * POST /contacts/pause-ai
 * Body: { waNumber, contactNumber, reason? }
 */
router.post('/contacts/pause-ai', async (req, res) => {
  try {
    const { waNumber, contactNumber, reason } = req.body || {};
    if (!waNumber || !contactNumber) return res.status(400).json({ error: 'waNumber and contactNumber are required' });
    const contactMutations = require('../engine/contactMutations');
    const result = await contactMutations.triggerHandoff({ waNumber, contactNumber, reason: reason || 'Manual pause by team' });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[messages] pause-ai error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to pause AI' });
  }
});

/**
 * POST /contacts/resume-ai
 * Body: { waNumber, contactNumber }
 */
router.post('/contacts/resume-ai', async (req, res) => {
  try {
    const { waNumber, contactNumber } = req.body || {};
    if (!waNumber || !contactNumber) return res.status(400).json({ error: 'waNumber and contactNumber are required' });
    const contactMutations = require('../engine/contactMutations');
    const result = await contactMutations.resumeAi({ waNumber, contactNumber });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[messages] resume-ai error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to resume AI' });
  }
});

// DELETE /conversations — admin-only. Permanently removes an entire conversation
// (its messages, reactions, read state and the contact row) for a wa_number +
// contact_number, to clear irrelevant/spam chats. Irreversible.
router.delete('/conversations', async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Only admins can delete conversations' });
  const waNumber = req.body?.waNumber || req.query.waNumber;
  const contactNumber = req.body?.contactNumber || req.query.contactNumber;
  if (!waNumber || !contactNumber) return res.status(400).json({ error: 'waNumber and contactNumber required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM coexistence.message_reactions
        WHERE target_message_id IN (
          SELECT message_id FROM coexistence.chat_history
           WHERE wa_number = $1 AND contact_number = $2
        )`,
      [waNumber, contactNumber]
    );
    await client.query('DELETE FROM coexistence.conversation_reads WHERE wa_number = $1 AND contact_number = $2', [waNumber, contactNumber]);
    const { rowCount } = await client.query('DELETE FROM coexistence.chat_history WHERE wa_number = $1 AND contact_number = $2', [waNumber, contactNumber]);
    await client.query('DELETE FROM coexistence.contacts WHERE wa_number = $1 AND contact_number = $2', [waNumber, contactNumber]);
    await client.query('COMMIT');
    res.json({ ok: true, deletedMessages: rowCount });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    console.error('[messages] delete conversation error:', err.message);
    res.status(500).json({ error: 'Failed to delete conversation' });
  } finally {
    client.release();
  }
});

module.exports = { router, MAX_CONTACT_IMPORT_ROWS };

