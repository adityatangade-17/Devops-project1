// Color tokens map to CSS variables (defined per-theme in index.css) so the
// whole app re-themes when <html data-theme> flips. Fallbacks = light values,
// so colors still render even if the stylesheet hasn't loaded.
export const C = {
  pageBg: 'var(--c-pageBg, #eef3fa)',
  sidebarBg: 'var(--c-sidebarBg, #f8faff)',
  sidebarBorder: 'var(--c-sidebarBorder, #dce5f3)',
  headerBg: 'var(--c-headerBg, #142443)',
  headerText: 'var(--c-headerText, #f5f9ff)',
  headerMuted: 'var(--c-headerMuted, #a8bbdc)',
  headerBorder: 'var(--c-headerBorder, rgba(255,255,255,.12))',
  headerSurface: 'var(--c-headerSurface, rgba(255,255,255,.06))',
  cardBg: 'var(--c-cardBg, #ffffff)',
  border: 'var(--c-border, #dce5f3)',
  borderDark: 'var(--c-borderDark, #c3d1e6)',
  text: 'var(--c-text, #172644)',
  textSecondary: 'var(--c-textSecondary, #526480)',
  textMuted: 'var(--c-textMuted, #7b8aa5)',
  primary: 'var(--c-primary, #315ed6)',
  primaryHover: 'var(--c-primaryHover, #244bb3)',
  primaryLight: 'var(--c-primaryLight, #e8efff)',
  primaryText: 'var(--c-primaryText, #172644)',
  purple: 'var(--c-purple, #7457c5)',
  green: 'var(--c-green, #087f79)',
  amber: 'var(--c-amber, #bb7b23)',
  shadowSm: 'var(--c-shadowSm, 0 1px 2px rgba(0,0,0,.08))',
  shadowMd: 'var(--c-shadowMd, 0 8px 24px rgba(0,0,0,.06))',
  shadowLg: 'var(--c-shadowLg, 0 20px 60px rgba(0,0,0,.15))',
  waBg: 'var(--c-waBg, #eaf0f9)',
  // neutral surface aliases (used when migrating literal-heavy views)
  surface: 'var(--c-surface, #ffffff)',
  surfaceAlt: 'var(--c-surfaceAlt, #f4f7fc)',
  hover: 'var(--c-hover, #e8efff)',
  // semantic status tokens (foreground + soft background pairs)
  success: 'var(--c-success, #0F6E56)',
  successBg: 'var(--c-successBg, #E7F4EC)',
  warning: 'var(--c-warning, #B45309)',
  warningBg: 'var(--c-warningBg, #FEF3C7)',
  danger: 'var(--c-danger, #B23B2E)',
  dangerBg: 'var(--c-dangerBg, #FCEBEB)',
  ai: 'var(--c-ai, #534AB7)',
  aiBg: 'var(--c-aiBg, #EEF0FB)',
  waBgPattern: 'radial-gradient(circle at center, rgba(49,94,214,.08) 1px, transparent 1px)',
};

export const CHAT = {
  incomingBg: 'var(--c-incomingBg, #ffffff)',
  incomingText: 'var(--c-incomingText, #111b21)',
  outgoingBg: 'var(--c-outgoingBg, #dceaff)',
  outgoingText: 'var(--c-outgoingText, #111b21)',
  chatBg: 'var(--c-chatBg, #edf3fb)',
  bubbleRadius: '16px',
  bubblePadding: '10px 12px',
  statusDelivered: 'var(--c-statusDelivered, #315ed6)',
  statusRead: 'var(--c-statusRead, #315ed6)',
  statusSent: 'var(--c-statusSent, #8696a0)',
};

export const FONT = "'Manrope', system-ui, sans-serif";
export const MONO = "'IBM Plex Mono', monospace";

// Design-system scales — reuse these instead of ad-hoc literals.
export const RADIUS = { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 };
export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 40 };
export const EASE = 'cubic-bezier(.2,.7,.2,1)';       // standard
export const EASE_OUT = 'cubic-bezier(.16,1,.3,1)';   // entrance
export const DUR = { fast: '.15s', base: '.25s', slow: '.4s' };

export function relativeTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

// Mask a phone number for display — keep the first 2 and last 3 digits, star the
// rest (e.g. "919487722330" -> "91*******330", "93xxxxx678" -> "93*****678").
// Used directly for non-interactive contexts (<option>, strings); the
// MaskedNumber component wraps this with click-to-reveal for JSX.
export function maskPhone(raw) {
  const s = String(raw ?? '');
  const digits = s.replace(/\D/g, '');
  if (digits.length <= 5) return s; // too short to meaningfully mask
  return digits.slice(0, 2) + '*'.repeat(digits.length - 5) + digits.slice(-3);
}

// Tag colors are stored as pale pastels (good as light fills, unreadable with
// the white chip text). Darken a hex color so a white label reads clearly while
// the tag keeps its own hue. Falls back to a dark slate for missing/invalid.
export function darkenColor(hex, factor = 0.5) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex || '');
  if (!m) return '#374151';
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return `rgb(${r}, ${g}, ${b})`;
}

export function formatDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}
