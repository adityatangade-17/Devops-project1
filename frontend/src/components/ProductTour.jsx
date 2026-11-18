import { useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { ArrowRight, ArrowLeft, X, Compass } from 'lucide-react';
import { C, FONT } from '../constants.js';

// Guided product tour — spotlights each sidebar area with a premium coach-mark.
// Role-aware for free: any step whose target isn't in the DOM (because the role
// can't see that page) is skipped, so consultants/viewers get a shorter tour.

const STEPS = [
  { sel: '[data-tour="home"]', title: 'Your command center', body: 'Home shows what needs attention right now — unanswered chats, unassigned leads, tasks due and today’s bookings.' },
  { sel: '[data-tour="chats"]', title: 'Shared inbox', body: 'Every WhatsApp conversation in one place. Reply, assign to a teammate, and hand over — as a team, not from a personal phone.' },
  { sel: '[data-tour="contacts"]', title: 'Contacts & CRM', body: 'Every customer with tags, custom fields and a lead score, so no one slips through the cracks.' },
  { sel: '[data-tour="pipelines"]', title: 'Pipelines', body: 'Track each opportunity from new lead to won on a simple drag-and-drop board.' },
  { sel: '[data-tour="ai-agent-builder"]', title: 'AI Agents', body: 'Install AI assistants that qualify leads, book meetings and follow up — or let AI draft agents tuned to exactly what your business does.' },
  { sel: '[data-tour="chatbot-builder"]', title: 'Automations', body: 'Auto-reply to common questions and route people instantly, 24/7.' },
  { sel: '[data-tour="tasks"]', title: 'Tasks', body: 'Follow-ups captured from your chats — added by you, your team, or automatically by AI when a customer needs a callback.' },
  { sel: '[data-tour="bookings"]', title: 'Bookings', body: 'Let customers book meetings themselves, with automatic Google Meet links and reminders.' },
  { sel: '[data-tour="template-builder"]', title: 'Templates', body: 'Approved messages for starting conversations and running broadcasts.' },
  { sel: '[data-tour="media-library"]', title: 'Media', body: 'Keep brochures and documents ready to share in any chat.' },
  { sel: '[data-tour="bulk-message"]', title: 'Broadcasts', body: 'Send an approved template to a whole segment at once — safely, with opt-out respected.' },
];

const TOOLTIP_W = 328;

function computePlacement(rect) {
  if (!rect) return null;
  const vw = window.innerWidth, vh = window.innerHeight;
  // Prefer to the right of the (left) sidebar item.
  if (rect.right + TOOLTIP_W + 24 <= vw) {
    return { left: rect.right + 16, top: clamp(rect.top - 8, 14, vh - 220), arrow: 'left' };
  }
  // Else below.
  if (rect.bottom + 200 <= vh) {
    return { left: clamp(rect.left, 14, vw - TOOLTIP_W - 14), top: rect.bottom + 14, arrow: 'top' };
  }
  // Else centered.
  return { left: (vw - TOOLTIP_W) / 2, top: vh - 240, arrow: 'none' };
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export default function ProductTour({ user, onClose }) {
  // Only the steps whose target currently exists (role-visible).
  const [steps] = useState(() => STEPS.filter(s => document.querySelector(s.sel)));
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);
  const total = steps.length;
  const step = steps[i];

  const measure = useCallback(() => {
    if (!step) return;
    const el = document.querySelector(step.sel);
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height, right: r.right, bottom: r.bottom });
  }, [step]);

  useLayoutEffect(() => { measure(); }, [measure]);
  useEffect(() => {
    const on = () => measure();
    window.addEventListener('resize', on);
    window.addEventListener('scroll', on, true);
    return () => { window.removeEventListener('resize', on); window.removeEventListener('scroll', on, true); };
  }, [measure]);

  const next = useCallback(() => { if (i < total - 1) setI(i + 1); else onClose(); }, [i, total, onClose]);
  const back = useCallback(() => setI(v => Math.max(0, v - 1)), []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, back, onClose]);

  if (total === 0) return null; // nothing visible to tour

  const place = computePlacement(rect);
  const pad = 6;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000, fontFamily: FONT }}>
      <style>{`
        @keyframes tourRing{0%{box-shadow:0 0 0 0 rgba(229,72,77,.45);}70%{box-shadow:0 0 0 8px rgba(229,72,77,0);}100%{box-shadow:0 0 0 0 rgba(229,72,77,0);}}
        @keyframes tourCardIn{from{opacity:0;transform:translateY(8px) scale(.98);}to{opacity:1;transform:none;}}
        @media (prefers-reduced-motion: reduce){ .tour-card{animation:none!important;} .tour-spot{transition:none!important;} }
      `}</style>

      {/* Spotlight cutout (falls back to a dimmed backdrop if target is missing) */}
      {rect ? (
        <div className="tour-spot" style={{
          position: 'fixed', top: rect.top - pad, left: rect.left - pad,
          width: rect.width + pad * 2, height: rect.height + pad * 2, borderRadius: 12,
          boxShadow: '0 0 0 9999px rgba(12,12,16,.62)', pointerEvents: 'none',
          transition: 'top .35s cubic-bezier(.4,0,.2,1),left .35s cubic-bezier(.4,0,.2,1),width .35s,height .35s',
        }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: 12, border: `2px solid ${C.primary}`, animation: 'tourRing 2.2s infinite' }} />
        </div>
      ) : (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(12,12,16,.62)' }} />
      )}

      {/* Coach-mark card */}
      <div className="tour-card" key={i} style={{
        position: 'fixed',
        left: place ? place.left : (window.innerWidth - TOOLTIP_W) / 2,
        top: place ? place.top : 120,
        width: TOOLTIP_W, maxWidth: '92vw',
        background: C.cardBg, borderRadius: 16, border: `1px solid ${C.border}`,
        boxShadow: '0 24px 60px -18px rgba(0,0,0,.4)', padding: 18,
        animation: 'tourCardIn .32s cubic-bezier(.16,1,.3,1)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: C.primary }}>
            <Compass size={13} /> Tour · {i + 1} of {total}
          </span>
          <button onClick={onClose} title="Skip tour" style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, display: 'flex', padding: 2 }}><X size={16} /></button>
        </div>

        <div style={{ fontSize: 16, fontWeight: 800, color: C.text, letterSpacing: '-.01em', marginBottom: 6 }}>{step.title}</div>
        <p style={{ margin: 0, fontSize: 13.5, color: C.textSecondary, lineHeight: 1.55 }}>{step.body}</p>

        {/* Progress dots */}
        <div style={{ display: 'flex', gap: 5, margin: '16px 0 14px' }}>
          {steps.map((_, k) => (
            <span key={k} style={{ height: 4, flex: k === i ? 2 : 1, borderRadius: 999, background: k <= i ? C.primary : C.border, transition: 'flex .3s, background .3s' }} />
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={onClose} style={ghost}>Skip</button>
          <div style={{ display: 'flex', gap: 8 }}>
            {i > 0 && <button onClick={back} style={ghost}><ArrowLeft size={14} /> Back</button>}
            <button onClick={next} style={primary}>{i === total - 1 ? 'Finish' : 'Next'} {i < total - 1 && <ArrowRight size={14} />}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const primary = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 9, border: 'none', background: C.primary, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: FONT };
const ghost = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 12px', borderRadius: 9, border: 'none', background: 'transparent', color: C.textSecondary, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: FONT };
