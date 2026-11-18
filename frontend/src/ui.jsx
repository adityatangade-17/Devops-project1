// Shared UI primitives — the app's reusable building blocks. Import from here
// instead of re-declaring buttons/cards/badges inline in every file:
//   import { Button, Card, Badge, EmptyState, Skeleton, PageHeader, Modal, Stepper } from '../ui.jsx';
//
// Everything is theme-token driven (C / RADIUS / SPACE / motion) and dependency-free.

import { useEffect } from 'react';
import { Loader2, X } from 'lucide-react';
import { C, FONT, RADIUS, EASE, DUR } from './constants.js';

/* --------------------------------- Button -------------------------------- */
const BTN_VARIANTS = {
  primary: { bg: C.primary, color: '#fff', border: 'none', hoverBg: C.primaryHover },
  danger:  { bg: C.danger, color: '#fff', border: 'none', hoverBg: '#98332A' },
  subtle:  { bg: C.surfaceAlt, color: C.text, border: `1px solid ${C.border}`, hoverBg: C.hover },
  ghost:   { bg: 'transparent', color: C.textSecondary, border: 'none', hoverBg: C.hover },
  outline: { bg: C.cardBg, color: C.text, border: `1px solid ${C.border}`, hoverBg: C.hover },
};
const BTN_SIZES = {
  sm: { pad: '7px 12px', fs: 12.5, gap: 6, r: RADIUS.sm },
  md: { pad: '9px 16px', fs: 13.5, gap: 7, r: RADIUS.md },
  lg: { pad: '12px 22px', fs: 15, gap: 8, r: RADIUS.md },
};
export function Button({ variant = 'primary', size = 'md', loading, disabled, icon: Icon, iconRight: IconR, children, style, ...rest }) {
  const v = BTN_VARIANTS[variant] || BTN_VARIANTS.primary;
  const s = BTN_SIZES[size] || BTN_SIZES.md;
  const off = disabled || loading;
  return (
    <button
      disabled={off}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: s.gap,
        padding: s.pad, fontSize: s.fs, fontWeight: 700, fontFamily: FONT, borderRadius: s.r,
        background: v.bg, color: v.color, border: v.border, cursor: off ? 'not-allowed' : 'pointer',
        opacity: off ? 0.6 : 1, transition: `background ${DUR.base}, transform ${DUR.fast}, box-shadow ${DUR.base}`,
        whiteSpace: 'nowrap', ...style,
      }}
      onMouseEnter={e => { if (!off) e.currentTarget.style.background = v.hoverBg; }}
      onMouseLeave={e => { e.currentTarget.style.background = v.bg; }}
      {...rest}
    >
      {loading ? <Loader2 size={s.fs} style={{ animation: 'ui-spin 1s linear infinite' }} /> : (Icon && <Icon size={s.fs + 1} />)}
      {children}
      {IconR && !loading && <IconR size={s.fs + 1} />}
    </button>
  );
}

export function IconButton({ icon: Icon, label, size = 34, style, ...rest }) {
  return (
    <button title={label} aria-label={label} style={{
      width: size, height: size, borderRadius: RADIUS.md, display: 'grid', placeItems: 'center',
      background: C.surfaceAlt, border: `1px solid ${C.border}`, color: C.textSecondary, cursor: 'pointer',
      transition: `background ${DUR.base}, color ${DUR.base}`, ...style,
    }}
      onMouseEnter={e => { e.currentTarget.style.background = C.hover; e.currentTarget.style.color = C.text; }}
      onMouseLeave={e => { e.currentTarget.style.background = C.surfaceAlt; e.currentTarget.style.color = C.textSecondary; }}
      {...rest}
    ><Icon size={16} /></button>
  );
}

/* ---------------------------------- Card --------------------------------- */
export function Card({ children, pad = 18, hover, style, ...rest }) {
  return (
    <div style={{
      background: C.cardBg, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: pad,
      boxShadow: C.shadowSm, transition: `box-shadow ${DUR.base}, transform ${DUR.base}, border-color ${DUR.base}`,
      ...style,
    }}
      onMouseEnter={hover ? (e => { e.currentTarget.style.boxShadow = C.shadowMd; e.currentTarget.style.transform = 'translateY(-2px)'; }) : undefined}
      onMouseLeave={hover ? (e => { e.currentTarget.style.boxShadow = C.shadowSm; e.currentTarget.style.transform = 'none'; }) : undefined}
      {...rest}
    >{children}</div>
  );
}

/* --------------------------------- Badge --------------------------------- */
const BADGE_TONES = {
  neutral: { bg: C.surfaceAlt, color: C.textSecondary },
  success: { bg: C.successBg, color: C.success },
  warning: { bg: C.warningBg, color: C.warning },
  danger:  { bg: C.dangerBg, color: C.danger },
  ai:      { bg: C.aiBg, color: C.ai },
  primary: { bg: C.primaryLight, color: C.primary },
};
export function Badge({ tone = 'neutral', icon: Icon, children, style }) {
  const t = BADGE_TONES[tone] || BADGE_TONES.neutral;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700,
      letterSpacing: '.02em', padding: '4px 9px', borderRadius: RADIUS.pill, background: t.bg, color: t.color,
      fontFamily: FONT, ...style,
    }}>{Icon && <Icon size={11} />}{children}</span>
  );
}

export function StatusDot({ tone = 'success', size = 8 }) {
  const color = { success: C.success, warning: C.warning, danger: C.danger, neutral: C.textMuted, ai: C.ai }[tone] || C.success;
  return <span style={{ width: size, height: size, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />;
}

/* ------------------------------- EmptyState ------------------------------ */
export function EmptyState({ icon: Icon, title, body, action, style }) {
  return (
    <div style={{
      textAlign: 'center', padding: '52px 24px', background: C.cardBg, border: `1px dashed ${C.border}`,
      borderRadius: RADIUS.lg, maxWidth: 460, margin: '0 auto', fontFamily: FONT, ...style,
    }}>
      {Icon && (
        <span style={{ width: 52, height: 52, borderRadius: 14, background: C.primaryLight, display: 'grid', placeItems: 'center', margin: '0 auto 16px' }}>
          <Icon size={24} color={C.primary} />
        </span>
      )}
      <div style={{ fontSize: 15.5, fontWeight: 800, color: C.text, letterSpacing: '-.01em' }}>{title}</div>
      {body && <div style={{ fontSize: 13.5, color: C.textSecondary, margin: '7px auto 0', maxWidth: 360, lineHeight: 1.55 }}>{body}</div>}
      {action && <div style={{ marginTop: 20 }}>{action}</div>}
    </div>
  );
}

/* -------------------------------- Skeleton ------------------------------- */
export function Skeleton({ w = '100%', h = 14, r = RADIUS.sm, style }) {
  return <div style={{ width: w, height: h, borderRadius: r, background: `linear-gradient(90deg, ${C.surfaceAlt} 25%, ${C.hover} 37%, ${C.surfaceAlt} 63%)`, backgroundSize: '400% 100%', animation: 'ui-shimmer 1.4s ease infinite', ...style }} />;
}

export function Spinner({ size = 16, color = C.primary }) {
  return <Loader2 size={size} style={{ animation: 'ui-spin 1s linear infinite', color }} />;
}

/* ------------------------------- PageHeader ------------------------------ */
export function PageHeader({ icon: Icon, title, subtitle, actions, style }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18, fontFamily: FONT, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
        {Icon && <Icon size={20} color={C.primary} style={{ flexShrink: 0 }} />}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.text, letterSpacing: '-.02em', lineHeight: 1.1 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 3 }}>{subtitle}</div>}
        </div>
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>{actions}</div>}
    </div>
  );
}

export function SectionHeader({ title, right, style }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, fontFamily: FONT, ...style }}>
      <span style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>{title}</span>
      {right}
    </div>
  );
}

/* --------------------------------- Modal --------------------------------- */
export function Modal({ title, onClose, children, footer, width = 480, style }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(12,12,16,.42)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: FONT }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: width, maxHeight: '88vh', display: 'flex', flexDirection: 'column',
        background: C.cardBg, borderRadius: RADIUS.xl, border: `1px solid ${C.border}`, boxShadow: C.shadowLg,
        animation: `ui-modalIn ${DUR.base} ${EASE}`, overflow: 'hidden', ...style,
      }}>
        {title && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 20px', borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>{title}</div>
            <IconButton icon={X} label="Close" size={30} onClick={onClose} />
          </div>
        )}
        <div style={{ padding: 20, overflowY: 'auto' }}>{children}</div>
        {footer && <div style={{ padding: '14px 20px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>{footer}</div>}
      </div>
    </div>
  );
}

/* -------------------------------- Stepper -------------------------------- */
export function Stepper({ steps, current, onGo, style }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontFamily: FONT, ...style }}>
      {steps.map((s, i) => {
        const done = i < current, active = i === current;
        return (
          <button key={s.key || i} onClick={() => (i <= current && onGo) && onGo(i)} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: RADIUS.md,
            border: 'none', cursor: i <= current && onGo ? 'pointer' : 'default', textAlign: 'left', width: '100%',
            background: active ? C.primary : 'transparent', color: active ? '#fff' : done ? C.text : C.textMuted,
            fontFamily: FONT, fontSize: 13, fontWeight: 600,
          }}>
            <span style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800, background: active ? 'rgba(255,255,255,.22)' : done ? C.successBg : C.surfaceAlt, color: active ? '#fff' : done ? C.success : C.textMuted, border: active ? 'none' : `1px solid ${C.border}` }}>
              {done ? '✓' : i + 1}
            </span>
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------- one-time keyframes -------------------------- */
export function UIKeyframes() {
  return <style>{`
    @keyframes ui-spin{to{transform:rotate(360deg)}}
    @keyframes ui-shimmer{0%{background-position:100% 0}100%{background-position:0 0}}
    @keyframes ui-modalIn{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:none}}
  `}</style>;
}
