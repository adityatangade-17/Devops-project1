import {
  Home, Zap, LayoutTemplate, MessageCircle, Users, ShieldBan,
  Megaphone, Image as ImageIcon, Info, KanbanSquare, Bot,
  CalendarClock, ChevronLeft, ChevronRight, ListChecks, Network,
} from 'lucide-react';
import { C, FONT } from '../constants.js';

// Grouped navigation. Sections give the sidebar a clear hierarchy; a section is
// hidden entirely when a role can see none of its items.
const SECTIONS = [
  { title: 'Workspace', items: [
    { id: 'home', label: 'Home', Icon: Home },
    { id: 'chats', label: 'Chats', Icon: MessageCircle },
    { id: 'contacts', label: 'Contacts', Icon: Users },
    { id: 'stop-contacts', label: 'STOP Contacts', Icon: ShieldBan },
    { id: 'pipelines', label: 'Pipelines', Icon: KanbanSquare },
  ] },
  { title: 'AI & Automation', items: [
    { id: 'ai-agent-builder', label: 'AI Agents', Icon: Bot },
    { id: 'chatbot-builder', label: 'Automations', Icon: Zap },
    { id: 'tasks', label: 'Tasks', Icon: ListChecks },
  ] },
  { title: 'Operations', items: [
    { id: 'bookings', label: 'Bookings', Icon: CalendarClock },
    { id: 'template-builder', label: 'Templates', Icon: LayoutTemplate },
    { id: 'media-library', label: 'Media', Icon: ImageIcon },
    { id: 'bulk-message', label: 'Broadcasts', Icon: Megaphone },
  ] },
  { title: null, items: [
    { id: 'about', label: 'About Us', Icon: Info },
  ] },
];

export default function Sidebar({ activePage, onPageChange, collapsed, setCollapsed, mobileOpen, user }) {
  // Admins see every nav item; other roles see only the pages granted to them
  // (user.pages from the session). Empty sections are dropped.
  const admin = user?.role === 'admin' || !Array.isArray(user?.pages);
  const canSee = (id) => admin || user.pages.includes(id) || (id === 'stop-contacts' && user.pages.includes('contacts'));
  const sections = SECTIONS
    .map(s => ({ ...s, items: s.items.filter(it => canSee(it.id)) }))
    .filter(s => s.items.length > 0);
  return (
    <div className={`spider-sidebar${mobileOpen ? ' spider-sidebar-open' : ''}`} style={{
      width: collapsed ? 68 : 240,
      minHeight: '100%',
      background: C.sidebarBg,
      borderRight: `1px solid ${C.sidebarBorder}`,
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      transition: 'width .25s ease',
      overflow: 'hidden',
      position: 'relative',
    }}>
      <button type="button" onClick={() => onPageChange('home')} className="spider-sidebar-brand" title="SpiderChat home">
        <span className="spider-mark"><Network size={20} strokeWidth={2.3} /></span>
        {!collapsed && <span className="spider-wordmark">spider<span>chat</span><span className="spider-wordmark-dot">.</span></span>}
      </button>
      {/* Nav items — grouped into sections */}
      <div style={{ padding: collapsed ? '10px 8px' : '14px 10px', flex: 1, overflowY: 'auto' }}>
        {sections.map((section, si) => (
          <div key={si} style={{ marginBottom: si < sections.length - 1 ? 12 : 0 }}>
            {section.title && (collapsed
              ? (si > 0 && <div style={{ height: 1, background: C.sidebarBorder, margin: '8px 14px' }} />)
              : <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: C.textMuted, padding: '2px 12px 6px' }}>{section.title}</div>
            )}
            {section.items.map(item => (
              <NavItem key={item.id} item={item} active={activePage === item.id} collapsed={collapsed} onClick={() => onPageChange(item.id)} />
            ))}
          </div>
        ))}
      </div>

      {/* Collapse button + watermark */}
      <div style={{ borderTop: `1px solid ${C.sidebarBorder}` }}>
        <div
          onClick={() => setCollapsed(p => !p)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: collapsed ? '12px 0' : '11px 14px',
            cursor: 'pointer',
            justifyContent: collapsed ? 'center' : 'flex-start',
            transition: 'background .15s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = C.hover}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <span style={{ display: 'flex', alignItems: 'center', color: '#888', lineHeight: 1 }}>
            {collapsed ? <ChevronRight size={22} strokeWidth={2.5} /> : <ChevronLeft size={22} strokeWidth={2.5} />}
          </span>
          {!collapsed && (
            <span style={{ fontSize: 15, fontWeight: 600, color: '#888', fontFamily: FONT, lineHeight: 1 }}>
              Collapse
            </span>
          )}
        </div>
        {!collapsed && (
          <div style={{ padding: '0 14px 10px' }}>
            <span style={{
              fontSize: 9,
              fontWeight: 600,
              color: '#ccc',
              fontFamily: FONT,
              letterSpacing: '.06em',
              textTransform: 'uppercase',
            }}>
              SPIDERCHAT WORKSPACE
            </span>
          </div>
        )}
        {collapsed && (
          <div style={{ padding: '0 0 8px', textAlign: 'center' }}>
            <span style={{
              fontSize: 7,
              fontWeight: 600,
              color: '#ddd',
              fontFamily: FONT,
              letterSpacing: '.04em',
              textTransform: 'uppercase',
            }}>
              SC
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function NavItem({ item, active, collapsed, onClick }) {
  return (
    <div
      data-tour={item.id}
      onClick={onClick}
      title={collapsed ? item.label : ''}
      style={{
        display: 'flex', alignItems: 'center', gap: collapsed ? 0 : 11,
        padding: collapsed ? '11px 0' : '11px 13px', borderRadius: 12, cursor: 'pointer',
        transition: 'all .15s', marginBottom: 4, background: active ? C.primaryLight : 'transparent',
        color: active ? C.primary : C.textSecondary, justifyContent: collapsed ? 'center' : 'flex-start',
        fontFamily: FONT, fontSize: 13, fontWeight: active ? 700 : 500, whiteSpace: 'nowrap',
        overflow: 'hidden', userSelect: 'none',
      }}
      onMouseEnter={e => { if (!active) { e.currentTarget.style.background = C.hover; e.currentTarget.style.color = C.text; } }}
      onMouseLeave={e => { e.currentTarget.style.background = active ? C.primaryLight : 'transparent'; e.currentTarget.style.color = active ? C.primary : C.textSecondary; }}
    >
      <span style={{ width: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: active ? 1 : 0.75 }}>
        <item.Icon size={16} />
      </span>
      {!collapsed && <span style={{ letterSpacing: '-.01em' }}>{item.label}</span>}
    </div>
  );
}
