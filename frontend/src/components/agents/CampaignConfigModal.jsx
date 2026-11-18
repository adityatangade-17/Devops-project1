import { useState, useEffect, useCallback } from 'react';
import { X, Loader2, ShieldCheck, Users, AlertTriangle } from 'lucide-react';
import { api } from '../../api.js';
import { C, FONT, MONO } from '../../constants.js';

// Copy per campaign kind — what the agent does + what the template should say.
const KIND_INFO = {
  recovery: {
    title: 'Recovery Agent',
    blurb: 'Re-engages leads who chatted with you and then went quiet.',
    templateHint: 'A gentle "still interested?" nudge. Body uses {{1}} = contact name.',
    showTag: false,
  },
  reactivation: {
    title: 'Reactivation Agent',
    blurb: 'Wakes up an aged contact database with a compliant re-introduction.',
    templateHint: 'A re-introduction / offer. Body uses {{1}} = contact name. Optionally target one tag.',
    showTag: true,
  },
  collection: {
    title: 'Collection Agent',
    blurb: 'Reminds customers with a pending booking payment. Uses real payment records.',
    templateHint: 'A payment reminder. Body uses {{1}} = name, {{2}} = amount (e.g. ₹5,000).',
    showTag: false,
  },
};

const NUM = (v) => (v === '' || v == null ? '' : Number(v));

export default function CampaignConfigModal({ kind, onClose }) {
  const info = KIND_INFO[kind] || { title: kind, blurb: '', templateHint: '', showTag: false };
  const [form, setForm] = useState(null);
  const [waAccounts, setWaAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [campaigns, accts] = await Promise.all([
        api.agents.campaigns(),
        api.whatsappAccounts.list().catch(() => []),
      ]);
      const c = campaigns.find(x => x.kind === kind);
      setForm(c || null);
      setWaAccounts(accts);
    } catch (e) {
      setError(e?.message || 'Failed to load configuration');
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => { load(); }, [load]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const runPreview = async () => {
    setPreviewing(true);
    try { setPreview(await api.agents.previewCampaign(kind)); }
    catch { setPreview(null); }
    finally { setPreviewing(false); }
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.agents.updateCampaign(kind, {
        enabled: form.enabled,
        waAccountId: form.waAccountId || null,
        templateName: form.templateName || '',
        templateLanguage: form.templateLanguage || 'en',
        staleDays: NUM(form.staleDays),
        audienceTag: info.showTag ? (form.audienceTag || '') : '',
        maxPerRun: NUM(form.maxPerRun),
        maxPerDay: NUM(form.maxPerDay),
        minGapDays: NUM(form.minGapDays),
        quietStartHour: NUM(form.quietStartHour),
        quietEndHour: NUM(form.quietEndHour),
      });
      onClose(true);
    } catch (e) {
      setError(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={() => onClose(false)}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 560, maxHeight: '88vh', overflowY: 'auto', background: C.cardBg, borderRadius: 16, border: `1px solid ${C.border}`, boxShadow: C.shadowMd, fontFamily: FONT }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${C.border}` }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>{info.title}</div>
            <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>{info.blurb}</div>
          </div>
          <button onClick={() => onClose(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, display: 'flex' }}><X size={18} /></button>
        </div>

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 50, gap: 8, color: C.textMuted, fontSize: 13 }}>
            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading…
          </div>
        ) : !form ? (
          <div style={{ padding: 24, fontSize: 13, color: '#A32D2D' }}>Campaign not found. Deploy the latest migration and retry.</div>
        ) : (
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {error && (
              <div style={{ padding: '10px 14px', borderRadius: 8, background: '#FCEBEB', color: '#A32D2D', border: '1px solid #FBC8C8', fontSize: 13 }}>{error}</div>
            )}

            {/* Safety banner */}
            <div style={{ display: 'flex', gap: 10, padding: '11px 13px', borderRadius: 10, background: '#FFFBEB', border: '1px solid #FDE68A' }}>
              <ShieldCheck size={16} color="#92400E" style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 12, color: '#78350F', lineHeight: 1.5 }}>
                This agent messages customers with a <strong>Meta-approved template</strong>. It respects opt-out,
                quiet hours, a per-contact gap, and daily limits. It stays off until you enable it below.
              </div>
            </div>

            {/* Enable */}
            <Toggle
              checked={form.enabled}
              onChange={v => set('enabled', v)}
              label="Enable this agent"
              sub={form.enabled ? 'Live — sending on the schedule below.' : 'Paused — nothing is sent.'}
            />

            {/* Template */}
            <Field label="Approved template name" hint={info.templateHint}>
              <input
                value={form.templateName || ''}
                onChange={e => set('templateName', e.target.value)}
                placeholder="e.g. recovery_nudge_v1"
                style={inputStyle}
              />
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Template language">
                <input value={form.templateLanguage || 'en'} onChange={e => set('templateLanguage', e.target.value)} placeholder="en" style={inputStyle} />
              </Field>
              <Field label={kind === 'collection' ? 'Sending number (required)' : 'Sending number'}>
                <select value={form.waAccountId || ''} onChange={e => set('waAccountId', e.target.value)} style={inputStyle}>
                  <option value="">{kind === 'collection' ? 'Select a number…' : 'Contact’s own number'}</option>
                  {waAccounts.map(a => <option key={a.id} value={a.id}>{a.displayName || a.displayPhoneNumber}</option>)}
                </select>
              </Field>
            </div>

            {/* Audience shaping */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label={kind === 'collection' ? 'Days payment overdue' : 'Inactive for (days)'} hint={kind === 'collection' ? 'Chase after N days pending' : 'Contact went quiet ≥ N days'}>
                <input type="number" value={form.staleDays} onChange={e => set('staleDays', e.target.value)} style={inputStyle} />
              </Field>
              {info.showTag && (
                <Field label="Target tag (optional)" hint="Limit to one segment">
                  <input value={form.audienceTag || ''} onChange={e => set('audienceTag', e.target.value)} placeholder="e.g. Importers" style={inputStyle} />
                </Field>
              )}
            </div>

            {/* Rate limits */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <Field label="Max / run"><input type="number" value={form.maxPerRun} onChange={e => set('maxPerRun', e.target.value)} style={inputStyle} /></Field>
              <Field label="Max / day"><input type="number" value={form.maxPerDay} onChange={e => set('maxPerDay', e.target.value)} style={inputStyle} /></Field>
              <Field label="Min gap (days)" hint="Per contact"><input type="number" value={form.minGapDays} onChange={e => set('minGapDays', e.target.value)} style={inputStyle} /></Field>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Quiet start (IST hour)" hint="No sends after"><input type="number" value={form.quietStartHour} onChange={e => set('quietStartHour', e.target.value)} style={inputStyle} /></Field>
              <Field label="Quiet end (IST hour)" hint="Resume at"><input type="number" value={form.quietEndHour} onChange={e => set('quietEndHour', e.target.value)} style={inputStyle} /></Field>
            </div>

            {/* Audience preview */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 13px', borderRadius: 10, background: '#F7F7F2', border: `1px solid ${C.border}` }}>
              <button onClick={runPreview} disabled={previewing} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.cardBg, color: C.text, cursor: 'pointer', fontSize: 12, fontFamily: FONT, fontWeight: 600 }}>
                {previewing ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Users size={13} />} Preview audience
              </button>
              {preview && (
                <span style={{ fontSize: 12.5, color: C.textSecondary }}>
                  ~<strong style={{ color: C.text }}>{preview.audienceCount}</strong> customer{preview.audienceCount === 1 ? '' : 's'} match right now
                  {!preview.templateConfigured && <span style={{ color: '#B45309' }}> · add a template to send</span>}
                </span>
              )}
              <span style={{ marginLeft: 'auto', fontSize: 11, color: C.textMuted, fontFamily: MONO }}>{form.sent24h || 0} sent / 24h</span>
            </div>

            {!preview?.templateConfigured && form.enabled && (
              <div style={{ display: 'flex', gap: 8, fontSize: 12, color: '#B45309', alignItems: 'center' }}>
                <AlertTriangle size={14} /> A template name is required to enable this agent.
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
              <button onClick={() => onClose(false)} style={{ padding: '9px 16px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.cardBg, color: C.text, cursor: 'pointer', fontSize: 13, fontFamily: FONT, fontWeight: 600 }}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 8, border: 'none', background: C.primary, color: '#fff', cursor: saving ? 'wait' : 'pointer', fontSize: 13, fontFamily: FONT, fontWeight: 700, opacity: saving ? 0.7 : 1 }}>
                {saving && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />} Save
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '9px 11px', borderRadius: 8, border: `1.5px solid ${C.border}`,
  fontSize: 13, fontFamily: FONT, outline: 'none', background: C.cardBg, color: C.text, boxSizing: 'border-box',
};

function Field({ label, hint, children }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 5 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4, lineHeight: 1.4 }}>{hint}</div>}
    </label>
  );
}

function Toggle({ checked, onChange, label, sub }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderRadius: 10, background: checked ? '#ECFDF5' : '#F7F7F2', border: `1px solid ${checked ? '#A7F3D0' : C.border}` }}>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>{label}</div>
        <div style={{ fontSize: 11.5, color: C.textSecondary, marginTop: 2 }}>{sub}</div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        style={{ width: 44, height: 26, borderRadius: 999, border: 'none', cursor: 'pointer', background: checked ? '#059669' : '#CBD5E1', position: 'relative', transition: 'background .15s', flexShrink: 0 }}
      >
        <span style={{ position: 'absolute', top: 3, left: checked ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
      </button>
    </div>
  );
}
