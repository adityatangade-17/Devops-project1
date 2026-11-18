import { useState, useRef, useEffect } from 'react';
import { Info, LogOut, Settings, AlertTriangle, Users, Sparkles, Rocket, Compass, Network, Menu } from 'lucide-react';
import { C, FONT } from '../constants.js';
import { api } from '../api.js';

const PAGE_TITLES = { home: 'Overview', chats: 'Conversations', contacts: 'Contacts', 'stop-contacts': 'STOP contacts', pipelines: 'Pipelines', bookings: 'Bookings', tasks: 'Tasks', 'template-builder': 'Templates', 'media-library': 'Media library', 'bulk-message': 'Broadcasts', 'chatbot-builder': 'Automations', 'ai-agent-builder': 'AI agents', 'venture-setup': 'Venture setup', about: 'About SpiderChat' };

export default function Topbar({ user, onLogout, onNavigate, onShowWhatsNew, onTakeTour, showBrand = true, currentPage, onOpenNavigation }) {
  const [userOpen, setUserOpen] = useState(false);
  const [presenceOpen, setPresenceOpen] = useState(false);
  const [presence, setPresence] = useState([]);
  const [unhealthyAccounts, setUnhealthyAccounts] = useState([]);
  const ref = useRef(null);
  const presenceRef = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setUserOpen(false);
      if (presenceRef.current && !presenceRef.current.contains(e.target)) setPresenceOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Team presence: poll every 30s so "who's online" stays fresh. Each poll is an
  // authenticated request, which also refreshes this user's own online status.
  useEffect(() => {
    let cancelled = false;
    const check = () => {
      api.users.presence()
        .then(list => { if (!cancelled) setPresence(Array.isArray(list) ? list : []); })
        .catch(() => {});
    };
    check();
    const t = setInterval(check, 30000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // Poll account health every 60s so the banner appears within a minute
  // of Meta rejecting a token. Cleared instantly when token is updated.
  useEffect(() => {
    let cancelled = false;
    const check = () => {
      api.whatsappAccounts.list()
        .then(accs => { if (!cancelled) setUnhealthyAccounts(accs.filter(a => a.healthStatus === 'invalid_token')); })
        .catch(() => {});
    };
    check();
    const t = setInterval(check, 60000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  return (
    <>
    {unhealthyAccounts.length > 0 && (
      <div
        onClick={() => onNavigate('admin-settings')}
        style={{
          background: '#A32D2D', color: '#fff', padding: '8px 16px',
          fontSize: 12, fontFamily: FONT, display: 'flex', alignItems: 'center',
          justifyContent: 'center', gap: 8, cursor: 'pointer', fontWeight: 500,
        }}
      >
        <AlertTriangle size={14} />
        <span>
          Access token expired for {unhealthyAccounts.map(a => a.displayName).join(', ')} — click to update in Settings → WhatsApp Accounts
        </span>
      </div>
    )}
    <div style={{
      height: 64,
      background: C.headerBg,
      display: 'flex',
      alignItems: 'center',
      paddingLeft: showBrand ? 0 : 24,
      paddingRight: 20,
      borderBottom: `1px solid ${C.headerBorder}`,
      flexShrink: 0,
      zIndex: 100,
      position: 'relative',
    }}>
      {/* Show the brand when the main navigation is hidden. */}
      {showBrand ? <button
        onClick={() => onNavigate('chats')}
        style={{
          width: 240,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 20,
          gap: 11,
          borderRight: `1px solid ${C.headerBorder}`,
          height: '100%',
          background: 'transparent',
          border: 'none',
          borderRightWidth: 1,
          borderRightStyle: 'solid',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ width: 29, height: 29, display: 'grid', placeItems: 'center', borderRadius: 9, background: '#4ad2db', color: '#142443' }}><Network size={19} strokeWidth={2.4} /></span>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 20,
            fontWeight: 700,
            color: C.headerText,
            fontFamily: "'Space Grotesk', sans-serif",
            letterSpacing: '-0.06em',
            lineHeight: 1.1,
            whiteSpace: 'nowrap',
          }}>
            spider<span style={{ fontWeight: 400 }}>chat</span><span style={{ color: '#4ad2db' }}>.</span>
          </div>
        </div>
      </button> : <div className="spider-pagebar-left">
        <button type="button" className="spider-mobile-menu" aria-label="Open navigation" onClick={onOpenNavigation}><Menu size={21} /></button>
        <span className="spider-pagebar-kicker">SPIDERCHAT / WORKSPACE</span>
        <span className="spider-pagebar-title">{PAGE_TITLES[currentPage] || 'Workspace'}</span>
      </div>}

      <div style={{ flex: 1 }} />

      {/* Right controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Who's online */}
        <div ref={presenceRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setPresenceOpen(p => !p)}
            title="Who's online"
            style={{
              position: 'relative', width: 36, height: 36, borderRadius: 9,
              background: C.headerSurface, border: `1.5px solid ${C.headerBorder}`,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Users size={16} color={C.headerText} />
            {presence.filter(p => p.online).length > 0 && (
              <span style={{
                position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, padding: '0 4px',
                borderRadius: 999, background: '#059669', color: '#fff', fontSize: 10, fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                border: `2px solid ${C.headerBg}`,
              }}>
                {presence.filter(p => p.online).length}
              </span>
            )}
          </button>

          {presenceOpen && (
            <div style={{
              position: 'absolute', top: 44, right: 0, background: C.cardBg,
              border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: C.shadowMd,
              padding: 6, minWidth: 230, maxHeight: 360, overflowY: 'auto', zIndex: 200,
            }}>
              <div style={{ padding: '8px 12px 6px', fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: '.06em', textTransform: 'uppercase' }}>
                Team · {presence.filter(p => p.online).length} online
              </div>
              {presence.length === 0 ? (
                <div style={{ padding: '10px 12px', fontSize: 12.5, color: C.textMuted }}>No teammates yet.</div>
              ) : presence.map(p => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 12px' }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: p.online ? '#22C55E' : '#CBD5E1' }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.displayName}{String(p.id) === String(user.id) ? ' (you)' : ''}
                    </span>
                    <span style={{ display: 'block', fontSize: 10.5, color: C.textMuted, textTransform: 'capitalize' }}>
                      {p.online ? 'Online' : lastSeenLabel(p.lastActiveAt)} · {String(p.role || '').replace('_', ' ')}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* About Us */}
        <button
          onClick={() => onNavigate('about')}
          title="About Us"
          style={{
            width: 36,
            height: 36,
            borderRadius: 9,
            background: C.headerSurface,
            border: `1.5px solid ${C.headerBorder}`,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Info size={16} color={C.headerText} />
        </button>

        {/* User avatar */}
        <div ref={ref} style={{ position: 'relative' }}>
          <button
            onClick={() => setUserOpen(p => !p)}
            style={{
              width: 36,
              height: 36,
              borderRadius: 9,
              background: 'linear-gradient(135deg, #534AB7, #7B72E0)',
              border: userOpen ? '2px solid #fff' : `1.5px solid ${C.headerBorder}`,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 15,
              fontWeight: 700,
              color: '#fff',
              fontFamily: FONT,
              transition: 'border .15s',
              padding: 0,
              overflow: 'hidden',
            }}
          >
            {(user.displayName || user.username).charAt(0).toUpperCase()}
          </button>

          {userOpen && (
            <div style={{
              position: 'absolute',
              top: 44,
              right: 0,
              background: C.cardBg,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              boxShadow: C.shadowMd,
              padding: 6,
              minWidth: 180,
              zIndex: 200,
            }}>
              <div style={{ padding: '8px 12px', borderBottom: `1px solid ${C.border}`, marginBottom: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                  {user.displayName || user.username}
                </div>
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
                  Owner
                </div>
              </div>
              {user.role === 'admin' && (
                <button
                  onClick={() => { setUserOpen(false); onNavigate('venture-setup'); }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 12px', borderRadius: 6, background: 'transparent',
                    border: 'none', cursor: 'pointer', color: C.text, fontSize: 13,
                    fontWeight: 600, fontFamily: FONT, marginBottom: 4,
                  }}
                >
                  <Rocket size={14} />
                  Venture setup
                </button>
              )}
              {onTakeTour && (
                <button
                  onClick={() => { setUserOpen(false); onTakeTour(); }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 12px', borderRadius: 6, background: 'transparent',
                    border: 'none', cursor: 'pointer', color: C.text, fontSize: 13,
                    fontWeight: 600, fontFamily: FONT, marginBottom: 4,
                  }}
                >
                  <Compass size={14} />
                  Take a tour
                </button>
              )}
              {onShowWhatsNew && (
                <button
                  onClick={() => { setUserOpen(false); onShowWhatsNew(); }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 12px', borderRadius: 6, background: 'transparent',
                    border: 'none', cursor: 'pointer', color: C.text, fontSize: 13,
                    fontWeight: 600, fontFamily: FONT, marginBottom: 4,
                  }}
                >
                  <Sparkles size={14} />
                  What’s new
                </button>
              )}
              <button
                onClick={() => { setUserOpen(false); onNavigate('admin-settings'); }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  borderRadius: 6,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: C.text,
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: FONT,
                  marginBottom: 4,
                }}
              >
                <Settings size={14} />
                Settings
              </button>
              <button
                onClick={() => { setUserOpen(false); onLogout(); }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  borderRadius: 6,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: C.primary,
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: FONT,
                }}
              >
                <LogOut size={14} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  );
}

// "Online" vs a relative last-seen for offline teammates.
function lastSeenLabel(iso) {
  if (!iso) return 'Offline';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 60) return `${Math.max(1, min)}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
