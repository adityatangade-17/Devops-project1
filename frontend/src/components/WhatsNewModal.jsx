import { Sparkles, X, Plus, ArrowUpCircle, Wrench, PartyPopper } from 'lucide-react';
import { C, FONT } from '../constants.js';

// "What's New" pop-up. Shows either a first-time welcome (isNewUser) or the list
// of updates a returning user hasn't seen yet. Driven by src/changelog.js.

const TYPE_META = {
  new: { label: 'New', color: '#166534', bg: '#DCFCE7', Icon: Plus },
  improved: { label: 'Improved', color: '#1E3A8A', bg: '#DBEAFE', Icon: ArrowUpCircle },
  fixed: { label: 'Fixed', color: '#9A3412', bg: '#FFEDD5', Icon: Wrench },
};

export default function WhatsNewModal({ entries, isNewUser, onClose }) {
  const items = entries.flatMap(e => e.items.map(it => ({ ...it, _label: e.label })));

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 520, maxHeight: '85vh', display: 'flex', flexDirection: 'column', background: C.cardBg, borderRadius: 18, border: `1px solid ${C.border}`, boxShadow: C.shadowMd, fontFamily: FONT, overflow: 'hidden' }}
      >
        {/* Header */}
        <div style={{ position: 'relative', padding: '26px 26px 22px', background: C.headerBg, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: '-40%', right: '-10%', width: '55%', height: '150%', background: 'radial-gradient(circle, rgba(74,210,219,0.22) 0%, transparent 70%)', pointerEvents: 'none' }} />
          <button onClick={onClose} title="Close" style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', color: '#fff', display: 'grid', placeItems: 'center' }}>
            <X size={16} />
          </button>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 11 }}>
            <span style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,0.1)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              {isNewUser ? <PartyPopper size={22} color="#fff" /> : <Sparkles size={22} color="#fff" />}
            </span>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', letterSpacing: '-.01em' }}>
                {isNewUser ? 'Welcome to SpiderChat' : 'What’s new'}
              </div>
              <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>
                {isNewUser ? 'Here’s what you can do with your new workspace' : 'Updates added since you were last here'}
              </div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '18px 22px', overflowY: 'auto' }}>
          {['new', 'improved', 'fixed'].map(type => {
            const group = items.filter(it => it.type === type);
            if (group.length === 0) return null;
            const meta = TYPE_META[type];
            const Icon = meta.Icon;
            return (
              <div key={type} style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 11 }}>
                  <span style={{ width: 24, height: 24, borderRadius: 7, background: meta.bg, color: meta.color, display: 'grid', placeItems: 'center' }}><Icon size={13} /></span>
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: C.text }}>{meta.label}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 800, color: meta.color, background: meta.bg, borderRadius: 999, padding: '2px 8px' }}>{group.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9, paddingLeft: 4 }}>
                  {group.map((it, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10, fontSize: 13.5, color: C.text, lineHeight: 1.5 }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: meta.color, marginTop: 7, flexShrink: 0 }} />
                      <span>{it.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {isNewUser && (
            <div style={{ marginTop: 16, padding: '11px 13px', borderRadius: 10, background: '#FFFBEB', border: '1px solid #FDE68A', fontSize: 12.5, color: '#78350F', lineHeight: 1.5 }}>
              Tip: use the sidebar to explore your workspace, or choose Take a tour from the account menu.
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 22px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '10px 22px', borderRadius: 9, border: 'none', background: C.primary, color: '#fff', cursor: 'pointer', fontSize: 13.5, fontWeight: 700, fontFamily: FONT }}>
            {isNewUser ? 'Let’s go' : 'Got it'}
          </button>
        </div>
      </div>
    </div>
  );
}
